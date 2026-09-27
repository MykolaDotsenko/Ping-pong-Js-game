import { otherSide } from '../domain/power-ups.js';

/**
 * The finisher: on the point that wins a match, the loser's paddle is destroyed, a parody of a
 * fighting game's finishing move. It is one of the fun extras, so it needs the `jokes`
 * preference; it plays for the player's wins against the computer and for either winner
 * between two people, never at the end of a Rush run, where the run is lost. A match won with
 * a super ends in that super's own finisher; any other in one of seven, now and then in a comic
 * one instead; and a win to nil is PERFECT!. The renderer, the sound board and the view all
 * decide from this one place, so they agree.
 *
 * @import { GameConfig, GameEvent, GameState, Side, SuperKind } from '../domain/types.js'
 *
 * @typedef {'shatter' | 'launch' | 'slice' | 'vaporize' | 'meteor' | 'blackhole' | 'freeze'} RegularFinisher
 * @typedef {'incinerate' | 'shred' | 'derez' | 'electrocute'} SuperFinisher
 * @typedef {'tiny' | 'snooze'} ComicFinisher
 * @typedef {RegularFinisher | SuperFinisher | ComicFinisher} FinisherKind
 *
 * @typedef {object} Finisher
 * @property {FinisherKind} kind
 * @property {Side} loser whose paddle goes
 * @property {string} title the callout: PONGALITY, or a comic finisher's own
 * @property {SuperKind | null} super the super that won the match, whose finisher this is
 * @property {boolean} perfect the loser never scored
 *
 * @typedef {object} FinisherContext
 * @property {Side | null} winner
 * @property {boolean} twoPlayers a second person on the top paddle
 * @property {boolean} rush
 * @property {boolean} jokes the fun extras preference
 */

/** How long the finisher takes; the result screen waits this long, unless a tap skips it. */
export const FINISHER_SECONDS = 1.2;

/** @type {readonly RegularFinisher[]} */
export const REGULAR_FINISHERS = Object.freeze(['shatter', 'launch', 'slice', 'vaporize', 'meteor', 'blackhole', 'freeze']);

/** Each super's own finisher, for a match it wins. */
/** @type {Readonly<Record<SuperKind, SuperFinisher>>} */
export const SUPER_FINISHERS = Object.freeze({ fireball: 'incinerate', zigzag: 'shred', phantom: 'derez', thunder: 'electrocute' });

/** The comic finishers go by titles of their own. */
/** @type {Readonly<Record<ComicFinisher, string>>} */
export const COMIC_TITLES = Object.freeze({ tiny: 'TINYALITY', snooze: 'SNOOZALITY' });

/** @type {readonly FinisherKind[]} */
export const FINISHER_KINDS = Object.freeze([
  ...REGULAR_FINISHERS,
  ...Object.values(SUPER_FINISHERS),
  .../** @type {ComicFinisher[]} */ (Object.keys(COMIC_TITLES)),
]);

/** Of the finishers that no super decides, this many in a hundred are comic. */
const COMIC_PERCENT = 15;

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
 * @param {FinisherContext & { seed: number, super?: SuperKind | null, perfect?: boolean }} context
 *   the match seed picks the kind, unless a super won the match
 * @returns {Finisher | null}
 */
export function finisherFor({ winner, twoPlayers, rush, jokes, seed, super: superKind = null, perfect = false }) {
  if (!finisherApplies({ winner, twoPlayers, rush, jokes })) {
    return null;
  }

  const loser = winner === 'player' ? 'opponent' : 'player';

  if (superKind) {
    return { kind: SUPER_FINISHERS[superKind], loser, title: 'PONGALITY', super: superKind, perfect };
  }

  const mixed = Math.imul(Math.trunc(seed) ^ 0x2545f491, 0x9e3779b1) >>> 0;

  if (mixed % 100 < COMIC_PERCENT) {
    const kind = (mixed >>> 8) % 2 === 0 ? 'tiny' : 'snooze';
    return { kind, loser, title: COMIC_TITLES[kind], super: null, perfect };
  }

  return { kind: REGULAR_FINISHERS[(mixed >>> 8) % REGULAR_FINISHERS.length], loser, title: 'PONGALITY', super: null, perfect };
}

/**
 * The finisher for a match that has just ended, read from its game-over event and final state.
 *
 * @param {Extract<GameEvent, { type: 'game-over' }>} event
 * @param {GameState} state
 * @param {GameConfig} config
 * @param {boolean} jokes
 * @returns {Finisher | null}
 */
export function finisherAt(event, state, config, jokes) {
  return finisherFor({
    winner: event.winner,
    twoPlayers: config.opponent.controller === 'human',
    rush: config.rules.kind === 'rush',
    jokes,
    seed: state.seed,
    super: event.super ?? null,
    perfect: state.score[otherSide(event.winner)] === 0,
  });
}
