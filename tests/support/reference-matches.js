// The reference matches: deterministic bot matches whose every step is digested, so any
// change to how a classic match plays out shows up as a different digest. The fixtures in
// tests/fixtures/reference-matches.json were recorded before new modes and power-ups were
// added; tests/reference-matches.test.js replays them, and scripts/record-reference-matches.mjs
// re-records them when a change to classic play is intended.
import { createHash } from 'node:crypto';

import { DIFFICULTY_CONFIGS, GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG } from '../../src/config.js';
import { advanceGame, createInitialState, GAME_PHASE, startGame } from '../../src/domain/game.js';
import { nextBetween, nextRandom } from '../../src/domain/random.js';

/** @import { GameConfig, GameState } from '../../src/domain/types.js' */

/** @param {GameConfig} config */
const withoutPowerUps = (config) => ({ ...config, powerUps: { ...config.powerUps, enabled: false } });

/**
 * A human-like bot: it follows the ball with an aiming error that changes every rally, and
 * now and then yanks the paddle somewhere else, as a tap does. A keyboard bot steers with the
 * axis instead of a pointer.
 *
 * @param {number} seed
 * @param {'pointer' | 'keys'} device
 */
function createBot(seed, device) {
  let state = seed;
  let error = 0;
  let rally = -1;
  /** @param {number} min @param {number} max */
  const draw = (min, max) => {
    const roll = nextBetween(state, min, max);
    state = roll.seed;
    return roll.value;
  };

  /**
   * @param {GameState} game
   * @param {number} paddleX
   * @returns {{ pointerX: number | null, axis: number }}
   */
  return (game, paddleX) => {
    if (game.rally !== rally) {
      rally = game.rally;
      error = draw(-80, 80);
    }

    const chance = nextRandom(state);
    state = chance.seed;
    const target = chance.value < 0.012 ? game.ball.x + draw(-200, 200) : game.ball.x + error;

    if (device === 'keys') {
      return { pointerX: null, axis: Math.abs(target - paddleX) > 8 ? Math.sign(target - paddleX) : 0 };
    }

    return { pointerX: target, axis: 0 };
  };
}

/**
 * @typedef {object} Scenario
 * @property {string} name
 * @property {() => GameConfig} config
 * @property {number} seed
 * @property {number} seconds
 * @property {'pointer' | 'keys'} device
 */

/** @type {readonly Scenario[]} */
export const SCENARIOS = Object.freeze([
  { name: 'solo-normal', config: () => withoutPowerUps(GAME_CONFIG), seed: 4242, seconds: 60, device: 'pointer' },
  { name: 'solo-easy', config: () => withoutPowerUps(DIFFICULTY_CONFIGS.easy), seed: 1701, seconds: 40, device: 'pointer' },
  { name: 'solo-hard', config: () => withoutPowerUps(DIFFICULTY_CONFIGS.hard), seed: 9001, seconds: 40, device: 'pointer' },
  { name: 'solo-keys', config: () => withoutPowerUps(GAME_CONFIG), seed: 313, seconds: 30, device: 'keys' },
  { name: 'rush', config: () => RUSH_CONFIG, seed: 77, seconds: 40, device: 'pointer' },
  { name: 'duo', config: () => withoutPowerUps(TWO_PLAYER_CONFIG), seed: 2024, seconds: 60, device: 'pointer' },
  // Power-ups draw kinds from the seeded random source, so adding a kind changes this one; it
  // is re-recorded on purpose when that happens, and only then.
  { name: 'solo-power-ups', config: () => GAME_CONFIG, seed: 5150, seconds: 60, device: 'pointer' },
]);

/**
 * Plays a scenario to the end of its time, or of the match, and digests every step.
 *
 * @param {Scenario} scenario
 */
export function playReference(scenario) {
  const config = scenario.config();
  const bottom = createBot(scenario.seed + 1, scenario.device);
  const top = createBot(scenario.seed + 2, scenario.device);
  const hash = createHash('sha256');
  const counts = /** @type {Record<string, number>} */ ({});
  let state = startGame(createInitialState(config, scenario.seed), config);
  let steps = 0;

  while (steps < scenario.seconds / config.fixedStepSeconds && state.phase === GAME_PHASE.RUNNING) {
    const player = bottom(state, state.player.x);
    const opponent = config.opponent.controller === 'human' ? top(state, state.opponent.x) : { pointerX: null, axis: 0 };

    state = advanceGame(state, config.fixedStepSeconds, {
      horizontalAxis: player.axis,
      pointerX: player.pointerX,
      opponentAxis: opponent.axis,
      opponentPointerX: opponent.pointerX,
    }, config);
    steps += 1;

    for (const event of state.events) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
    }

    hash.update([
      state.ball.x.toFixed(6), state.ball.y.toFixed(6), state.ball.vx.toFixed(6), state.ball.vy.toFixed(6),
      state.player.x.toFixed(6), state.opponent.x.toFixed(6),
      state.score.player, state.score.opponent, state.rally, state.lives, state.pickups.length,
      state.events.map((event) => event.type).join('+'),
      // Balls a Multiball split off. Nothing is added while there are none, so a match without
      // them digests exactly as it did before Multiball existed.
      ...state.extraBalls.map((extra) => `${extra.x.toFixed(6)}/${extra.y.toFixed(6)}`),
    ].join(',') + '\n');
  }

  return {
    digest: hash.digest('hex'),
    summary: {
      steps,
      score: { ...state.score },
      hits: { ...state.hits },
      longestRally: state.longestRally,
      phase: state.phase,
      events: Object.fromEntries(Object.entries(counts).sort()),
    },
  };
}
