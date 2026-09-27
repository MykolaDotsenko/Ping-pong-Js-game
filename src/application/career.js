/**
 * The career's rules, apart from the rivals themselves: the stars a match earns, how far the
 * ladder is open, and how a rival eases off once it has beaten the player twice in a row, so
 * nobody stays stuck on a rung.
 *
 * @import { GameConfig, Side } from '../domain/types.js'
 */

/** Losses in a row to one rival after which it eases off. */
export const EASE_AFTER = 2;

/** Stars a match can earn. */
export const MAX_STARS = 3;

/**
 * None for a loss, one for a win, two for winning by four points or more, and three for
 * conceding at most one.
 *
 * @param {Record<Side, number>} score
 * @returns {number}
 */
export function starsFor(score) {
  if (score.player <= score.opponent) {
    return 0;
  }

  if (score.opponent <= 1) {
    return MAX_STARS;
  }

  return score.player - score.opponent >= 4 ? 2 : 1;
}

/**
 * The furthest rival the player may choose: the first not yet beaten, or the last of all.
 *
 * @param {readonly number[]} stars the best stars earned against each rival
 * @param {number} count rivals on the ladder
 * @returns {number}
 */
export function unlockedRival(stars, count) {
  for (let index = 0; index < count; index += 1) {
    if (!((stars[index] ?? 0) > 0)) {
      return index;
    }
  }

  return count - 1;
}

/**
 * A rival that has just beaten the player twice in a row plays tired: it moves slower and
 * misjudges more, and a boss attacks less often, and less harshly.
 *
 * @param {GameConfig} config
 * @returns {GameConfig}
 */
export function easedConfig(config) {
  const { opponent, boss } = config;

  return Object.freeze({
    ...config,
    opponent: Object.freeze({ ...opponent, maxSpeed: opponent.maxSpeed * 0.9, error: opponent.error * 1.2 + 6 }),
    boss: boss && Object.freeze({
      ...boss,
      every: /** @type {[number, number]} */ ([boss.every[0] * 1.35, boss.every[1] * 1.35]),
      shrinkSeconds: boss.shrinkSeconds * 0.75,
      lagSeconds: boss.lagSeconds * 0.8,
    }),
  });
}
