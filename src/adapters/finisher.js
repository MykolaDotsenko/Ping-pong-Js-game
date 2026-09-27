/**
 * The finisher: on the point that wins a match, the loser's paddle is destroyed in one of a
 * few ways, a parody of a fighting game's finishing move. It is one of the fun extras, so it
 * needs the `jokes` preference; it plays for the player's wins against the computer and for
 * either winner between two people, never at the end of a Rush run, where the run is lost.
 * The renderer, the sound board and the view all decide from this one place, so they agree.
 *
 * @import { Side } from '../domain/types.js'
 *
 * @typedef {'shatter' | 'launch' | 'slice' | 'vaporize'} FinisherKind
 * @typedef {object} Finisher
 * @property {FinisherKind} kind
 * @property {Side} loser whose paddle goes
 *
 * @typedef {object} FinisherContext
 * @property {Side | null} winner
 * @property {boolean} twoPlayers a second person on the top paddle
 * @property {boolean} rush
 * @property {boolean} jokes the fun extras preference
 */

/** How long the finisher takes; the result screen waits this long, unless a tap skips it. */
export const FINISHER_SECONDS = 1.2;

/** @type {readonly FinisherKind[]} */
export const FINISHER_KINDS = Object.freeze(['shatter', 'launch', 'slice', 'vaporize']);

/**
 * @param {FinisherContext} context
 * @returns {boolean} whether a finisher plays on this match's end
 */
export function finisherApplies({ winner, twoPlayers, rush, jokes }) {
  if (!jokes || rush || winner === null) {
    return false;
  }

  return twoPlayers || winner === 'player';
}

/**
 * @param {FinisherContext & { seed: number }} context the match seed picks the kind
 * @returns {Finisher | null}
 */
export function finisherFor({ winner, twoPlayers, rush, jokes, seed }) {
  if (!finisherApplies({ winner, twoPlayers, rush, jokes })) {
    return null;
  }

  const mixed = Math.imul(Math.trunc(seed) ^ 0x2545f491, 0x9e3779b1) >>> 0;

  return {
    kind: FINISHER_KINDS[mixed % FINISHER_KINDS.length],
    loser: winner === 'player' ? 'opponent' : 'player',
  };
}
