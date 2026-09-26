import { roundedRect, THEME } from './theme.js';

/** @import { GameConfig } from '../../domain/types.js' */

const GRID_CELL = 25;

/**
 * The static court: tinted halves, grid, markings, neon border and vignette. It is painted
 * once per canvas size into a layer, so a frame only copies it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameConfig} config
 */
export function paintCourt(ctx, config) {
  const { width, height } = config;

  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, width, height);

  const tint = ctx.createLinearGradient(0, 0, 0, height);
  tint.addColorStop(0, THEME.topTint);
  tint.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
  tint.addColorStop(1, THEME.bottomTint);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, width, height);

  paintGrid(ctx, config, THEME.grid, THEME.gridMajor);

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
}

/**
 * The court grid. Drawn faintly into the court, and brightly into a separate layer that
 * flashes over it on big moments.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameConfig} config
 * @param {string} minor color of ordinary lines
 * @param {string} major color of every fourth line
 */
export function paintGrid(ctx, config, minor, major) {
  const { width, height } = config;

  ctx.save();
  ctx.lineWidth = 1;

  for (let x = GRID_CELL; x < width; x += GRID_CELL) {
    ctx.strokeStyle = x % (GRID_CELL * 4) === 0 ? major : minor;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = GRID_CELL; y < height; y += GRID_CELL) {
    ctx.strokeStyle = y % (GRID_CELL * 4) === 0 ? major : minor;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Soft round glows, rendered once per color and stretched as needed, so no frame pays for
 * a blur.
 */
export class GlowSprites {
  /** @param {() => HTMLCanvasElement} createCanvas */
  constructor(createCanvas) {
    this.createCanvas = createCanvas;
    /** @type {Map<string, HTMLCanvasElement>} */
    this.cache = new Map();
  }

  /** @param {string} rgb "r, g, b" */
  get(rgb) {
    const cached = this.cache.get(rgb);

    if (cached) {
      return cached;
    }

    const size = 128;
    const sprite = this.createCanvas();
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
    this.cache.set(rgb, sprite);
    return sprite;
  }
}
