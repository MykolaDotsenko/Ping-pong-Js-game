/**
 * The neon look shared by every part of the canvas renderer: colors, fonts and the few
 * drawing helpers they all use.
 *
 * @import { GameConfig, PowerUpKind } from '../../domain/types.js'
 */

// Pure white (#ffffff) is reserved for the ball core, and each paddle has a unique core
// stripe color, so tests and tools can locate them in the pixels.
export const THEME = Object.freeze({
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
  lime: '163, 230, 53',
  side: Object.freeze({
    player: Object.freeze({ rgb: '34, 211, 238', body: '#22d3ee', core: '#a5f3fc' }),
    opponent: Object.freeze({ rgb: '244, 114, 182', body: '#f472b6', core: '#fbcfe8' }),
  }),
});

/** @type {Readonly<Record<PowerUpKind, { rgb: string, glyph: string, label: string }>>} */
export const PICKUP_STYLE = Object.freeze({
  wide: Object.freeze({ rgb: '34, 211, 238', glyph: '⟷', label: 'WIDE' }),
  shrink: Object.freeze({ rgb: '251, 113, 133', glyph: '⤡', label: 'SHRINK' }),
  turbo: Object.freeze({ rgb: '251, 191, 36', glyph: '⚡', label: 'TURBO' }),
  ghost: Object.freeze({ rgb: '167, 139, 250', glyph: '◌', label: 'GHOST' }),
});

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** From this many hits a rally runs "fever": a hotter ball, a longer trail, an amber counter. */
export const FEVER_RALLY = 10;

/**
 * @param {string} rgb "r, g, b"
 * @param {string} other "r, g, b"
 * @param {number} amount 0 keeps rgb, 1 gives other
 */
export function mixRgb(rgb, other, amount) {
  const from = rgb.split(',').map(Number);
  const to = other.split(',').map(Number);
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount)).join(', ');
}

/**
 * 0 at serve speed, 1 at top speed.
 *
 * @param {number} speed
 * @param {GameConfig} config
 */
export function speedIntensity(speed, config) {
  const { initialSpeed, maxSpeed } = config.ball;
  return Math.min(1, Math.max(0, (speed - initialSpeed) / (maxSpeed - initialSpeed)));
}

/**
 * @param {Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'arcTo' | 'closePath'>} context
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 */
export function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}
