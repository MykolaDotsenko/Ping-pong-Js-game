/** @import { GameState } from '../domain/types.js' */

/**
 * @param {number} from
 * @param {number} to
 * @param {number} alpha
 */
function lerp(from, to, alpha) {
  return from + (to - from) * alpha;
}

/**
 * Blends the last two simulation states for display, so motion stays smooth when the
 * display refresh rate is not a multiple of the fixed simulation rate.
 *
 * @param {GameState} previous
 * @param {GameState} current
 * @param {number} alpha fraction of the next fixed step already elapsed, from 0 to 1
 * @returns {GameState}
 */
export function interpolateState(previous, current, alpha) {
  // A serve teleports the ball to the center; blending across it would draw a streak.
  if (previous === current || alpha >= 1 || previous.serveNumber !== current.serveNumber) {
    return current;
  }

  return {
    ...current,
    player: { ...current.player, x: lerp(previous.player.x, current.player.x, alpha) },
    opponent: { ...current.opponent, x: lerp(previous.opponent.x, current.opponent.x, alpha) },
    ball: {
      ...current.ball,
      x: lerp(previous.ball.x, current.ball.x, alpha),
      y: lerp(previous.ball.y, current.ball.y, alpha),
    },
  };
}
