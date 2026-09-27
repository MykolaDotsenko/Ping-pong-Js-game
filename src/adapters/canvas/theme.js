/**
 * The neon look shared by every part of the canvas renderer: colors, fonts and the few
 * drawing helpers they all use.
 *
 * @import { GameConfig, HazardKind, PowerUpKind, SuperKind } from '../../domain/types.js'
 */

// Pure white (#ffffff) is reserved for the ball core, and each paddle has a unique core
// stripe color, so tests and tools can locate them in the pixels. Balls a Multiball split off
// have a pale blue core, so they never pass for the ball.
export const THEME = Object.freeze({
  background: '#05060f',
  topTint: 'rgba(190, 24, 93, 0.16)',
  bottomTint: 'rgba(8, 145, 178, 0.16)',
  grid: 'rgba(129, 140, 248, 0.07)',
  gridMajor: 'rgba(129, 140, 248, 0.13)',
  gridPulse: 'rgba(165, 180, 252, 0.5)',
  line: 'rgba(196, 181, 253, 0.6)',
  ballCore: '#ffffff',
  extraBallCore: '#dbeafe',
  spark: '#fefce8',
  text: '196, 181, 253',
  violet: '167, 139, 250',
  amber: '251, 191, 36',
  rose: '251, 113, 133',
  red: '239, 68, 68',
  lime: '163, 230, 53',
  drip: '125, 211, 252',
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
  multi: Object.freeze({ rgb: '163, 230, 53', glyph: '••', label: 'MULTIBALL' }),
});

// Each super has a color of its own, which its ball, its trail, its callout and a full meter
// holding it all wear.
/** @type {Readonly<Record<SuperKind, { rgb: string, label: string }>>} */
export const SUPER_STYLE = Object.freeze({
  fireball: Object.freeze({ rgb: '249, 115, 22', label: 'FIREBALL' }),
  zigzag: Object.freeze({ rgb: '250, 204, 21', label: 'ZIGZAG' }),
  phantom: Object.freeze({ rgb: '216, 180, 254', label: 'PHANTOM' }),
  thunder: Object.freeze({ rgb: '96, 165, 250', label: 'THUNDER' }),
});

// The landlord's phases are the faults of its building: a leaky roof drips, bad wiring throws a
// beam, bad Wi-Fi lags, and the final notice brings all three. Its paddle glows in the color of
// the phase, and the title announces it.
/** @type {Readonly<Record<HazardKind | 'all', { rgb: string, title: string }>>} */
export const PHASE_STYLE = Object.freeze({
  drip: Object.freeze({ rgb: '125, 211, 252', title: 'LEAKY ROOF!' }),
  beam: Object.freeze({ rgb: '251, 191, 36', title: 'BAD WIRING!' }),
  lag: Object.freeze({ rgb: '167, 139, 250', title: 'BAD WI-FI!' }),
  all: Object.freeze({ rgb: '239, 68, 68', title: 'FINAL NOTICE!' }),
});

/**
 * @param {readonly HazardKind[]} kinds the attacks of a phase
 * @returns {{ rgb: string, title: string }}
 */
export function phaseStyle(kinds) {
  return kinds.length === 1 ? PHASE_STYLE[kinds[0]] : PHASE_STYLE.all;
}

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
