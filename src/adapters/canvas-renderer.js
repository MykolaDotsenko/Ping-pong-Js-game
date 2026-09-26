import { GAME_PHASE, getWinner } from '../domain/game.js';

/**
 * @import { GameConfig, GameState } from '../domain/types.js'
 * @import { RendererPort } from '../application/ports.js'
 */

/** @implements {RendererPort} */
export class CanvasRenderer {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {Window & typeof globalThis} options.window
   * @param {GameConfig} options.config
   */
  constructor({ canvas, window, config }) {
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Ping Pong needs Canvas 2D support.');
    }

    this.canvas = canvas;
    this.window = window;
    this.config = config;
    this.context = context;
    /** @type {GameState | null} */
    this.lastState = null;
    /** @type {ResizeObserver | null} */
    this.resizeObserver = null;
    this.stopWatchingPixelRatio = () => {};
    this.resize();
  }

  connect() {
    const observer = new this.window.ResizeObserver(() => this.resize());
    observer.observe(this.canvas);
    this.resizeObserver = observer;
    this.watchPixelRatio();
  }

  disconnect() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stopWatchingPixelRatio();
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
    const scale = (displayWidth * (this.window.devicePixelRatio || 1)) / width;
    const backingWidth = Math.round(width * scale);
    const backingHeight = Math.round(height * scale);

    if (this.canvas.width === backingWidth && this.canvas.height === backingHeight) {
      return;
    }

    // Resizing clears the canvas and resets the context, so restore the transform and repaint.
    this.canvas.width = backingWidth;
    this.canvas.height = backingHeight;
    this.context.setTransform(backingWidth / width, 0, 0, backingHeight / height, 0, 0);

    if (this.lastState) {
      this.render(this.lastState);
    }
  }

  /** @param {GameState} state */
  render(state) {
    this.lastState = state;

    const ctx = this.context;
    const { width, height, paddle, ball } = this.config;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#09111f';
    ctx.fillRect(0, 0, width, height);

    this.drawCenterLine();
    this.drawScore(state);
    this.drawPaddle(state.opponent.x, paddle.inset);
    this.drawPaddle(state.player.x, height - paddle.inset - paddle.height);
    this.drawBall(state.ball.x, state.ball.y, ball.radius);

    if (state.phase === GAME_PHASE.READY) {
      this.drawOverlay('Ready', 'Press Start or Space');
    } else if (state.phase === GAME_PHASE.PAUSED) {
      this.drawOverlay('Paused', 'Press Resume or Space to continue');
    } else if (state.phase === GAME_PHASE.GAME_OVER) {
      const winner = getWinner(state) === 'player' ? 'You win' : 'Computer wins';
      this.drawOverlay(winner, 'Press Start or Space for a new match');
    }
  }

  drawCenterLine() {
    const ctx = this.context;
    ctx.save();
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.28)';
    ctx.setLineDash([12, 14]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.config.height / 2);
    ctx.lineTo(this.config.width, this.config.height / 2);
    ctx.stroke();
    ctx.restore();
  }

  /** @param {GameState} state */
  drawScore(state) {
    const ctx = this.context;
    ctx.save();
    ctx.fillStyle = 'rgba(241, 245, 249, 0.92)';
    ctx.font = '700 36px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(state.score.opponent), 28, this.config.height / 2 - 30);
    ctx.fillText(String(state.score.player), 28, this.config.height / 2 + 58);
    ctx.restore();
  }

  /**
   * @param {number} centerX
   * @param {number} y
   */
  drawPaddle(centerX, y) {
    const { paddle } = this.config;
    const x = centerX - paddle.width / 2;
    const ctx = this.context;

    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.shadowColor = 'rgba(94, 234, 212, 0.32)';
    ctx.shadowBlur = 16;
    ctx.fillRect(x, y, paddle.width, paddle.height);
    ctx.restore();
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   */
  drawBall(x, y, radius) {
    const ctx = this.context;
    ctx.save();
    ctx.fillStyle = '#5eead4';
    ctx.shadowColor = 'rgba(94, 234, 212, 0.65)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * @param {string} title
   * @param {string} subtitle
   */
  drawOverlay(title, subtitle) {
    const ctx = this.context;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 10, 20, 0.66)';
    ctx.fillRect(0, 0, this.config.width, this.config.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 42px system-ui, sans-serif';
    ctx.fillText(title, this.config.width / 2, this.config.height / 2 - 10);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.fillText(subtitle, this.config.width / 2, this.config.height / 2 + 30);
    ctx.restore();
  }
}
