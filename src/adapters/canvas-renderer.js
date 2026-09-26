import { GAME_PHASE } from '../domain/game.js';
import { BallTrail } from './canvas/ball-trail.js';
import { GlowSprites, paintCourt, paintGrid } from './canvas/court.js';
import { playEvents } from './canvas/event-effects.js';
import { drawLabels, drawRally, drawServeCountdown } from './canvas/hud.js';
import { drawBall, drawGhostFog, drawPaddle, drawPickups, drawTrail } from './canvas/scene.js';
import { THEME } from './canvas/theme.js';
import { Effects } from './effects.js';

/**
 * @import { GameConfig, GameEvent, GameState } from '../domain/types.js'
 * @import { FeedbackPort, FrameScheduler, RendererPort } from '../application/ports.js'
 */

// Rendering above twice the CSS size costs battery on phones without visibly sharper glow.
const MAX_PIXEL_RATIO = 2;
const MAX_SHAKE = 9;
const MAX_FRAME_SECONDS = 0.05;

/**
 * Draws the game as a neon arcade board and plays the visual side of game events. This
 * class owns the canvas, its size and its frames; what each frame contains lives in
 * ./canvas: the court layers, the scene, the heads-up display and the event effects.
 * Static layers and glows are pre-rendered, so a frame is mostly cheap image copies.
 *
 * @implements {RendererPort}
 * @implements {FeedbackPort}
 */
export class CanvasRenderer {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {Window & typeof globalThis} options.window
   * @param {FrameScheduler} options.scheduler runs effects after a match ends, when the game loop is idle
   * @param {GameConfig} options.config the court geometry; the match config arrives with each frame
   * @param {() => number} [options.random]
   */
  constructor({ canvas, window, scheduler, config, random = Math.random }) {
    const context = canvas.getContext('2d', { alpha: false });

    if (!context) {
      throw new Error('Ping Pong needs Canvas 2D support.');
    }

    this.canvas = canvas;
    this.window = window;
    this.scheduler = scheduler;
    this.config = config;
    this.context = context;
    this.random = random;
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.effects = new Effects({ random, reducedMotion: this.reducedMotionQuery.matches });
    this.trail = new BallTrail();
    this.glows = new GlowSprites(() => this.createLayer());
    this.scale = 1;
    /** @type {GameState | null} */
    this.lastState = null;
    /** @type {number | null} */
    this.lastFrameTime = null;
    /** @type {number | null} */
    this.effectsFrame = null;
    this.background = this.createLayer();
    this.gridLayer = this.createLayer();
    /** @type {ResizeObserver | null} */
    this.resizeObserver = null;
    this.stopWatchingPixelRatio = () => {};
    this.handleMotionPreference = () => {
      this.effects.reducedMotion = this.reducedMotionQuery.matches;
    };
    this.resize();
  }

  connect() {
    const observer = new this.window.ResizeObserver(() => this.resize());
    observer.observe(this.canvas);
    this.resizeObserver = observer;
    this.watchPixelRatio();
    this.reducedMotionQuery.addEventListener('change', this.handleMotionPreference);
  }

  disconnect() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stopWatchingPixelRatio();
    this.reducedMotionQuery.removeEventListener('change', this.handleMotionPreference);

    if (this.effectsFrame !== null) {
      this.scheduler.cancel(this.effectsFrame);
      this.effectsFrame = null;
    }
  }

  // Browser zoom or a move to another display changes the pixel ratio without resizing the canvas.
  watchPixelRatio() {
    const query = this.window.matchMedia(`(resolution: ${this.window.devicePixelRatio}dppx)`);
    const handleChange = () => {
      this.resize();
      this.watchPixelRatio();
    };

    query.addEventListener('change', handleChange, { once: true });
    this.stopWatchingPixelRatio = () => query.removeEventListener('change', handleChange);
  }

  // Match the backing store to the displayed size in device pixels so the board stays sharp.
  // Drawing code keeps using board coordinates through the context transform.
  resize() {
    const { width, height } = this.config;
    const displayWidth = this.canvas.clientWidth || width;
    const pixelRatio = Math.min(this.window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const backingWidth = Math.round(displayWidth * pixelRatio);
    const backingHeight = Math.round(backingWidth * (height / width));

    if (this.canvas.width === backingWidth && this.canvas.height === backingHeight) {
      return;
    }

    this.canvas.width = backingWidth;
    this.canvas.height = backingHeight;
    this.scale = backingWidth / width;
    this.paintLayers();

    if (this.lastState) {
      this.draw();
    }
  }

  createLayer() {
    return this.canvas.ownerDocument.createElement('canvas');
  }

  /**
   * @param {HTMLCanvasElement} layer
   * @returns {CanvasRenderingContext2D}
   */
  prepareLayer(layer) {
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const context = /** @type {CanvasRenderingContext2D} */ (layer.getContext('2d'));
    context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    return context;
  }

  paintLayers() {
    paintCourt(this.prepareLayer(this.background), this.config);
    paintGrid(this.prepareLayer(this.gridLayer), this.config, THEME.gridPulse, THEME.gridPulse);
  }

  /** @param {readonly GameEvent[]} events */
  handle(events) {
    if (events.some((event) => event.type === 'match-start')) {
      this.trail.clear();
    }

    playEvents(this.effects, events, { config: this.config, random: this.random });
    this.ensureEffectsLoop();
  }

  /**
   * @param {GameState} state
   * @param {GameConfig} config the match's tuning, which sets speeds and paddle widths
   */
  render(state, config) {
    this.config = config;
    this.lastState = state;

    if (state.phase === GAME_PHASE.READY) {
      this.effects.clear();
      this.trail.clear();
    }

    this.draw();
    this.ensureEffectsLoop();
  }

  // While a match runs the game loop draws every frame. After it ends, effects such as the
  // victory fireworks still need frames, so the renderer requests them until they settle.
  ensureEffectsLoop() {
    const phase = this.lastState?.phase;

    if (
      this.effectsFrame !== null
      || !this.effects.active
      || phase === GAME_PHASE.RUNNING
      || phase === GAME_PHASE.PAUSED
    ) {
      return;
    }

    this.effectsFrame = this.scheduler.request(() => {
      this.effectsFrame = null;
      this.draw();
      this.ensureEffectsLoop();
    });
  }

  draw() {
    const state = this.lastState;

    if (!state) {
      return;
    }

    const now = this.window.performance.now();
    const deltaSeconds = this.lastFrameTime === null ? 0 : Math.min(MAX_FRAME_SECONDS, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (state.phase !== GAME_PHASE.PAUSED) {
      this.effects.update(deltaSeconds);
      this.trail.update(state);
    }

    const { context: ctx, config, effects, glows } = this;
    const { width, height } = config;
    const shake = effects.shakeOffset(MAX_SHAKE);

    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = THEME.background;
    ctx.fillRect(0, 0, width, height);
    ctx.translate(shake.x, shake.y);
    ctx.drawImage(this.background, 0, 0, width, height);

    if (effects.pulseAmount > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = effects.pulseAmount * 0.55;
      ctx.drawImage(this.gridLayer, 0, 0, width, height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    drawGhostFog(ctx, state, config);
    drawRally(ctx, state, config, effects.popAmount);
    drawPickups(ctx, state, config, now, glows);
    drawTrail(ctx, this.trail.points, state, config);
    effects.draw(ctx);
    drawBall(ctx, state, config, now, glows);
    drawPaddle(ctx, state, 'opponent', config, effects.squash.opponent, glows);
    drawPaddle(ctx, state, 'player', config, effects.squash.player, glows);
    drawServeCountdown(ctx, state, config);
    drawLabels(ctx, effects.labels);

    if (effects.flashAlpha > 0) {
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.globalAlpha = effects.flashAlpha;
      ctx.fillStyle = effects.flashColor;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  }
}
