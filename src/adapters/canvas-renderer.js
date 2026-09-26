import { GAME_PHASE } from '../domain/game.js';
import { Effects } from './effects.js';

/**
 * @import { GameConfig, GameEvent, GameState, Side } from '../domain/types.js'
 * @import { FeedbackPort, FrameScheduler, RendererPort } from '../application/ports.js'
 */

// Pure white (#ffffff) is reserved for the ball core, and each paddle has a unique core
// stripe color, so tests and tools can locate them in the pixels.
const THEME = Object.freeze({
  background: '#05060f',
  topTint: 'rgba(190, 24, 93, 0.16)',
  bottomTint: 'rgba(8, 145, 178, 0.16)',
  grid: 'rgba(129, 140, 248, 0.07)',
  gridMajor: 'rgba(129, 140, 248, 0.13)',
  gridPulse: 'rgba(165, 180, 252, 0.5)',
  line: 'rgba(196, 181, 253, 0.6)',
  ballCore: '#ffffff',
  spark: '#fefce8',
  text: '196, 181, 253',
  violet: '167, 139, 250',
  amber: '251, 191, 36',
  rose: '251, 113, 133',
  side: Object.freeze({
    player: Object.freeze({ rgb: '34, 211, 238', body: '#22d3ee', core: '#a5f3fc' }),
    opponent: Object.freeze({ rgb: '244, 114, 182', body: '#f472b6', core: '#fbcfe8' }),
  }),
});

// Rendering above twice the CSS size costs battery on phones without visibly sharper glow.
const MAX_PIXEL_RATIO = 2;
const TRAIL_LENGTH = 18;
const FEVER_RALLY = 10;

/**
 * @param {string} rgb "r, g, b"
 * @param {string} other "r, g, b"
 * @param {number} amount 0 keeps rgb, 1 gives other
 */
function mixRgb(rgb, other, amount) {
  const from = rgb.split(',').map(Number);
  const to = other.split(',').map(Number);
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount)).join(', ');
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 */
function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/**
 * Draws the game as a neon arcade board and plays the visual side of game events: sparks,
 * shockwaves, screen shake, flashes and a ball trail that heats up with speed. Static layers
 * and glows are pre-rendered, so a frame is mostly cheap image copies.
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
   * @param {GameConfig} options.config
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
    this.scale = 1;
    /** @type {GameState | null} */
    this.lastState = null;
    /** @type {Array<{ x: number, y: number }>} */
    this.trail = [];
    this.trailServe = -1;
    /** @type {number | null} */
    this.lastFrameTime = null;
    /** @type {number | null} */
    this.effectsFrame = null;
    /** @type {Map<string, HTMLCanvasElement>} */
    this.glows = new Map();
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
    this.paintBackground();

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

  // The static court: tinted halves, grid, markings, neon border and vignette.
  paintBackground() {
    const { width, height } = this.config;
    const ctx = this.prepareLayer(this.background);

    ctx.fillStyle = THEME.background;
    ctx.fillRect(0, 0, width, height);

    const tint = ctx.createLinearGradient(0, 0, 0, height);
    tint.addColorStop(0, THEME.topTint);
    tint.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
    tint.addColorStop(1, THEME.bottomTint);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, width, height);

    this.paintGrid(ctx, THEME.grid, THEME.gridMajor);

    // Center line and circle, with a glow baked in once instead of blurred every frame.
    ctx.save();
    ctx.strokeStyle = THEME.line;
    ctx.shadowColor = `rgba(${THEME.violet}, 0.9)`;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 12]);
    ctx.beginPath();
    ctx.moveTo(12, height / 2);
    ctx.lineTo(width - 12, height / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Neon border that shifts from the opponent's color to the player's.
    const border = ctx.createLinearGradient(0, 0, 0, height);
    border.addColorStop(0, `rgba(${THEME.side.opponent.rgb}, 0.9)`);
    border.addColorStop(0.5, `rgba(${THEME.violet}, 0.6)`);
    border.addColorStop(1, `rgba(${THEME.side.player.rgb}, 0.9)`);
    ctx.save();
    ctx.strokeStyle = border;
    ctx.lineWidth = 3;
    ctx.shadowColor = `rgba(${THEME.violet}, 0.8)`;
    ctx.shadowBlur = 18;
    roundedRect(ctx, 3, 3, width - 6, height - 6, 18);
    ctx.stroke();
    ctx.restore();

    const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.25, width / 2, height / 2, height * 0.75);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const grid = this.prepareLayer(this.gridLayer);
    this.paintGrid(grid, THEME.gridPulse, THEME.gridPulse);
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} minor
   * @param {string} major
   */
  paintGrid(ctx, minor, major) {
    const { width, height } = this.config;
    const cell = 25;

    ctx.save();
    ctx.lineWidth = 1;

    for (let x = cell; x < width; x += cell) {
      ctx.strokeStyle = x % (cell * 4) === 0 ? major : minor;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let y = cell; y < height; y += cell) {
      ctx.strokeStyle = y % (cell * 4) === 0 ? major : minor;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * A soft round glow, rendered once per color and stretched as needed.
   *
   * @param {string} rgb
   */
  glow(rgb) {
    const cached = this.glows.get(rgb);

    if (cached) {
      return cached;
    }

    const size = 128;
    const sprite = this.createLayer();
    sprite.width = size;
    sprite.height = size;
    const ctx = /** @type {CanvasRenderingContext2D} */ (sprite.getContext('2d'));
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(${rgb}, 0.95)`);
    gradient.addColorStop(0.22, `rgba(${rgb}, 0.5)`);
    gradient.addColorStop(0.55, `rgba(${rgb}, 0.14)`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    this.glows.set(rgb, sprite);
    return sprite;
  }

  /**
   * @param {readonly GameEvent[]} events
   */
  handle(events) {
    const { width, height, ball } = this.config;
    const { effects } = this;

    for (const event of events) {
      switch (event.type) {
        case 'match-start':
          effects.clear();
          this.trail = [];
          effects.ring({ x: width / 2, y: height / 2, color: `rgba(${THEME.violet}, 0.9)`, radius: 20, growth: 560, life: 0.6, width: 5 });
          effects.flash(`rgb(${THEME.violet})`, 0.16);
          break;
        case 'serve':
          effects.ring({ x: event.x, y: event.y, color: `rgba(${THEME.violet}, 0.8)`, radius: ball.radius + 2, growth: 200, life: 0.35, width: 2 });
          effects.burst({ x: event.x, y: event.y, color: `rgb(${THEME.violet})`, count: 10, speed: 130, life: 0.4, size: 1.6 });
          break;
        case 'paddle-hit': {
          const color = `rgb(${THEME.side[event.side].rgb})`;
          const intensity = this.intensity(event.speed);
          const outward = event.side === 'player' ? -Math.PI / 2 : Math.PI / 2;

          effects.burst({ x: event.x, y: event.y, color, count: 22 + Math.round(20 * intensity), speed: 300 + 320 * intensity, direction: outward, spread: 2.3, life: 0.55, size: 2.4 });
          effects.burst({ x: event.x, y: event.y, color: THEME.spark, count: 8, speed: 420, direction: outward, spread: 1.2, life: 0.3, size: 1.5 });
          effects.ring({ x: event.x, y: event.y, color, radius: 8, growth: 300 + 240 * intensity, life: 0.35 });
          effects.kick(event.side);
          effects.shake(0.16 + 0.34 * intensity);
          effects.pulse(0.3 + 0.45 * intensity);
          effects.pop();

          if (event.rally % 5 === 0) {
            effects.ring({ x: width / 2, y: height / 2, color: `rgba(${THEME.amber}, 0.9)`, radius: 30, growth: 620, life: 0.7, width: 5 });
            effects.flash(`rgb(${THEME.amber})`, 0.1);
          }
          break;
        }
        case 'wall-bounce':
          effects.burst({ x: event.x, y: event.y, color: '#c4b5fd', count: 8, speed: 180, direction: event.x < width / 2 ? 0 : Math.PI, spread: 2.4, life: 0.35, size: 1.6 });
          effects.ring({ x: event.x, y: event.y, color: `rgba(${THEME.violet}, 0.8)`, radius: 4, growth: 170, life: 0.25, width: 2 });
          break;
        case 'point': {
          const color = `rgb(${THEME.side[event.scorer].rgb})`;
          const intoCourt = event.y === 0 ? Math.PI / 2 : -Math.PI / 2;
          const y = Math.min(Math.max(event.y, 8), height - 8);

          effects.burst({ x: event.x, y, color, count: 70, speed: 430, direction: intoCourt, spread: Math.PI * 1.1, life: 0.9, size: 2.6 });
          effects.burst({ x: event.x, y, color: THEME.spark, count: 16, speed: 520, direction: intoCourt, spread: 1.4, life: 0.5, size: 1.6 });
          effects.ring({ x: event.x, y, color, radius: 12, growth: 720, life: 0.6, width: 6 });
          effects.flash(color, 0.34);
          effects.shake(0.95);
          effects.pulse(1);
          break;
        }
        case 'game-over':
          this.celebrate(event.winner);
          break;
        default:
          break;
      }
    }

    this.ensureEffectsLoop();
  }

  /** @param {Side} winner */
  celebrate(winner) {
    const { width, height } = this.config;
    const colors = [`rgb(${THEME.side[winner].rgb})`, `rgb(${THEME.amber})`, THEME.spark];

    for (let i = 0; i < 7; i += 1) {
      this.effects.schedule(0.2 + i * 0.28, () => {
        const x = width * (0.18 + this.random() * 0.64);
        const y = height * (0.2 + this.random() * 0.55);
        this.effects.burst({ x, y, color: colors[i % colors.length], count: 64, speed: 250, life: 1.2, gravity: 260, drag: 1.1, size: 2.4 });
        this.effects.ring({ x, y, color: colors[i % colors.length], radius: 6, growth: 260, life: 0.5, width: 3 });
      });
    }
  }

  /**
   * 0 at serve speed, 1 at top speed.
   *
   * @param {number} speed
   */
  intensity(speed) {
    const { initialSpeed, maxSpeed } = this.config.ball;
    return Math.min(1, Math.max(0, (speed - initialSpeed) / (maxSpeed - initialSpeed)));
  }

  /** @param {GameState} state */
  render(state) {
    this.lastState = state;

    if (state.phase === GAME_PHASE.READY) {
      this.effects.clear();
      this.trail = [];
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
    const deltaSeconds = this.lastFrameTime === null ? 0 : Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (state.phase !== GAME_PHASE.PAUSED) {
      this.effects.update(deltaSeconds);
      this.updateTrail(state);
    }

    const ctx = this.context;
    const { width, height } = this.config;
    const shake = this.effects.shakeOffset(9);

    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = THEME.background;
    ctx.fillRect(0, 0, width, height);
    ctx.translate(shake.x, shake.y);
    ctx.drawImage(this.background, 0, 0, width, height);

    if (this.effects.pulseAmount > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.effects.pulseAmount * 0.55;
      ctx.drawImage(this.gridLayer, 0, 0, width, height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    this.drawRally(state);
    this.drawTrail(state);
    this.effects.draw(ctx);
    this.drawBall(state);
    this.drawPaddle('opponent', state.opponent.x);
    this.drawPaddle('player', state.player.x);
    this.drawServeCountdown(state);

    if (this.effects.flashAlpha > 0) {
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.globalAlpha = this.effects.flashAlpha;
      ctx.fillStyle = this.effects.flashColor;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  }

  /** @param {GameState} state */
  updateTrail(state) {
    const { ball } = state;
    const last = this.trail[this.trail.length - 1];
    const teleported = last !== undefined && Math.hypot(ball.x - last.x, ball.y - last.y) > 120;

    if (state.serveNumber !== this.trailServe || state.serveCountdown > 0 || teleported) {
      this.trail = [];
      this.trailServe = state.serveNumber;
    }

    if (state.phase !== GAME_PHASE.RUNNING || state.serveCountdown > 0) {
      return;
    }

    this.trail.push({ x: ball.x, y: ball.y });
    const length = state.rally >= FEVER_RALLY ? TRAIL_LENGTH + 8 : TRAIL_LENGTH;

    if (this.trail.length > length) {
      this.trail.splice(0, this.trail.length - length);
    }
  }

  /**
   * The ball takes the color of whoever hit it last and heats toward amber as it speeds up;
   * a long rally tips it into a rose "fever" glow.
   *
   * @param {GameState} state
   */
  ballColor(state) {
    const { ball } = state;

    if (state.serveCountdown > 0 || state.phase === GAME_PHASE.READY) {
      return THEME.violet;
    }

    const hitter = ball.vy < 0 ? THEME.side.player.rgb : THEME.side.opponent.rgb;
    const heated = mixRgb(hitter, THEME.amber, this.intensity(Math.hypot(ball.vx, ball.vy)) ** 1.4);
    return state.rally >= FEVER_RALLY ? mixRgb(heated, THEME.rose, 0.55) : heated;
  }

  /** @param {GameState} state */
  drawTrail(state) {
    if (this.trail.length < 2) {
      return;
    }

    const ctx = this.context;
    const color = this.ballColor(state);
    const radius = this.config.ball.radius;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgb(${color})`;

    this.trail.forEach((point, index) => {
      const t = (index + 1) / this.trail.length;
      ctx.globalAlpha = t * 0.45;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * (0.25 + 0.7 * t), 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  /** @param {GameState} state */
  drawBall(state) {
    const ctx = this.context;
    const { ball } = state;
    const radius = this.config.ball.radius;
    const color = this.ballColor(state);
    const fever = state.rally >= FEVER_RALLY ? 1.3 : 1;
    const glowSize = radius * 10 * fever;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.glow(color), ball.x - glowSize / 2, ball.y - glowSize / 2, glowSize, glowSize);
    ctx.restore();

    ctx.fillStyle = THEME.ballCore;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // A spinning ball shows a rotating arc, so players can see the curve they put on it.
    if (Math.abs(ball.spin) > 0.12) {
      const turn = (this.window.performance.now() / 1000) * ball.spin * 14;
      ctx.save();
      ctx.strokeStyle = `rgba(224, 242, 254, ${Math.min(0.9, Math.abs(ball.spin))})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, radius + 5, turn, turn + 1.6);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * @param {Side} side
   * @param {number} centerX
   */
  drawPaddle(side, centerX) {
    const ctx = this.context;
    const { paddle, height } = this.config;
    const colors = THEME.side[side];
    const squash = this.effects.squash[side];
    const top = side === 'player' ? height - paddle.inset - paddle.height : paddle.inset;
    const width = paddle.width * (1 + 0.16 * squash);
    const thickness = paddle.height * (1 - 0.3 * squash);
    const left = centerX - width / 2;
    const middle = top + paddle.height / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + 0.5 * squash;
    ctx.drawImage(this.glow(colors.rgb), centerX - width * 0.95, middle - paddle.height * 3.4, width * 1.9, paddle.height * 6.8);
    ctx.restore();

    ctx.fillStyle = colors.body;
    roundedRect(ctx, left, middle - thickness / 2, width, thickness, thickness / 2);
    ctx.fill();

    ctx.fillStyle = colors.core;
    roundedRect(ctx, left + 7, middle - 2, width - 14, 4, 2);
    ctx.fill();
  }

  /**
   * A closing ring and a filling arc around the waiting ball; both complete as it is served.
   *
   * @param {GameState} state
   */
  drawServeCountdown(state) {
    if (state.serveCountdown <= 0 || state.phase === GAME_PHASE.READY) {
      return;
    }

    const ctx = this.context;
    const { ball } = state;
    const radius = this.config.ball.radius;
    const remaining = state.serveCountdown / this.config.serveDelaySeconds;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${THEME.violet}, 0.75)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, radius + 4 + 26 * remaining, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${THEME.side.player.rgb}, 0.9)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, radius + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - remaining));
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The current rally count, pulsing on every hit and turning amber in a long exchange.
   *
   * @param {GameState} state
   */
  drawRally(state) {
    if (state.rally < 2) {
      return;
    }

    const ctx = this.context;
    const { width, height } = this.config;
    const pop = this.effects.popAmount;
    const color = state.rally >= FEVER_RALLY ? THEME.amber : THEME.text;

    ctx.save();
    ctx.translate(width - 26, height / 2 + 34);
    ctx.scale(1 + pop * 0.3, 1 + pop * 0.3);
    ctx.textAlign = 'right';
    ctx.fillStyle = `rgba(${color}, ${0.3 + pop * 0.5})`;
    ctx.font = '800 44px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(String(state.rally), 0, 0);
    ctx.font = '700 11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = `rgba(${color}, ${0.35 + pop * 0.4})`;
    ctx.fillText('RALLY', 0, 16);
    ctx.restore();
  }
}
