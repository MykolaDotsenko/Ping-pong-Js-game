import { clamp } from './physics.js';
import { paddleWidth } from './power-ups.js';
import { nextBetween } from './random.js';

/** @import { GameConfig, GameEvent, GameState, Hazard, HazardKind, Side } from './types.js' */

/** Shared by every state without a boss attack under way, so the usual match allocates none. */
export const NO_HAZARDS = Object.freeze(/** @type {Hazard[]} */ ([]));
const NO_ATTACKS = Object.freeze(/** @type {HazardKind[]} */ ([]));

// Drips fall from under the boss's paddle, one into each third of the court, so one is always
// aimed at the player and the others fence the way out.
export const DRIP_RADIUS = 9;
export const DRIP_SPEED = 460;
// A beam strikes a column of the player's half, centered near the player's paddle.
export const BEAM_HALF_WIDTH = 42;
export const BEAM_SECONDS = 0.45;

/**
 * The start of a boss match: its first attack some seconds in. Without a boss nothing is
 * drawn, so the random source goes on exactly as in any other match.
 *
 * @param {number} seed
 * @param {GameConfig} config
 * @returns {{ hazards: readonly Hazard[], attackIn: number, seed: number }}
 */
export function initialHazardState(seed, config) {
  if (!config.boss) {
    return { hazards: NO_HAZARDS, attackIn: 0, seed };
  }

  const first = nextBetween(seed, ...config.boss.every);
  return { hazards: NO_HAZARDS, attackIn: first.value, seed: first.seed };
}

/**
 * Whether a boss is the final one: the only boss with phases.
 *
 * @param {GameConfig} config
 * @returns {boolean}
 */
export function isFinalBoss(config) {
  return Boolean(config.boss?.phases);
}

/**
 * The attacks a final boss has in its current phase; any other boss has its one attack, and
 * a match without a boss none.
 *
 * @param {Record<Side, number>} score
 * @param {GameConfig} config
 * @returns {readonly HazardKind[]}
 */
export function bossAttacks(score, config) {
  const { boss } = config;

  if (!boss) {
    return NO_ATTACKS;
  }

  return boss.phases?.[bossPhase(score, config)] ?? [boss.attack];
}

/**
 * The phase a final boss is in. It moves on as the player closes in on winning, so each phase
 * lasts an even share of the points the player needs; a boss without phases is always in its
 * first.
 *
 * @param {Record<Side, number>} score
 * @param {GameConfig} config
 * @returns {number} counted from 0
 */
export function bossPhase(score, config) {
  const phases = config.boss?.phases;

  if (!phases || config.rules.kind !== 'match') {
    return 0;
  }

  return Math.min(phases.length - 1, Math.floor((score.player * phases.length) / config.rules.winningScore));
}

/**
 * @param {GameState} state
 * @param {GameConfig} config
 * @returns {{ left: number, right: number, top: number, bottom: number }}
 */
function playerPaddleBox(state, config) {
  const half = paddleWidth(state, 'player', config) / 2;
  const top = config.height - config.paddle.inset - config.paddle.height;
  return { left: state.player.x - half, right: state.player.x + half, top, bottom: top + config.paddle.height };
}

/**
 * @param {Hazard} drip
 * @param {{ left: number, right: number, top: number, bottom: number }} box
 */
function dripTouches(drip, box) {
  const dx = Math.max(box.left - drip.x, 0, drip.x - box.right);
  const dy = Math.max(box.top - drip.y, 0, drip.y - box.bottom);
  return Math.hypot(dx, dy) <= DRIP_RADIUS;
}

/**
 * What a hit does to the player: a drip or a beam shrinks the paddle for a while, lag makes
 * the balls move in fits and starts. A second hit only renews the effect.
 *
 * @param {GameState} state
 * @param {HazardKind} kind
 * @param {GameConfig} config
 * @returns {GameState}
 */
function strikePlayer(state, kind, config) {
  const boss = /** @type {NonNullable<GameConfig['boss']>} */ (config.boss);
  const player = kind === 'lag'
    ? { ...state.modifiers.player, lag: Math.max(state.modifiers.player.lag, boss.lagSeconds) }
    : { ...state.modifiers.player, tiny: Math.max(state.modifiers.player.tiny, boss.shrinkSeconds) };

  return { ...state, modifiers: { ...state.modifiers, player } };
}

/**
 * Starts the boss's next attack, announced now and striking once its warning is over. A final
 * boss attacks with its phase's attack, or one drawn from its phase's several.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {{ hazards: Hazard[], seed: number }}
 */
function launchAttack(state, config, events) {
  const boss = /** @type {NonNullable<GameConfig['boss']>} */ (config.boss);
  const { width } = config;
  let { seed } = state;
  /** @param {number} min @param {number} max */
  const draw = (min, max) => {
    const roll = nextBetween(seed, min, max);
    seed = roll.seed;
    return roll.value;
  };
  const kinds = bossAttacks(state.score, config);
  // Only a choice draws from the random source, so a boss with one attack plays as it always has.
  const kind = kinds.length === 1 ? kinds[0] : kinds[Math.min(kinds.length - 1, Math.floor(draw(0, kinds.length)))];

  if (kind === 'drip') {
    const margin = DRIP_RADIUS + 6;
    const lane = width / 3;
    const aimed = clamp(state.player.x + draw(-24, 24), margin, width - margin);
    const aimedLane = Math.min(2, Math.floor(aimed / lane));
    const y = config.paddle.inset + config.paddle.height + DRIP_RADIUS + 12;
    const hazards = [0, 1, 2].map((index) => {
      const x = index === aimedLane ? aimed : draw(index * lane + margin, (index + 1) * lane - margin);
      return { kind: /** @type {const} */ ('drip'), x, y, warn: 0, ttl: 0 };
    });

    events.push({ type: 'hazard-warn', kind: 'drip', x: aimed });
    return { hazards, seed };
  }

  const x = kind === 'beam'
    ? clamp(state.player.x + draw(-40, 40), BEAM_HALF_WIDTH, width - BEAM_HALF_WIDTH)
    : width / 2;

  events.push({ type: 'hazard-warn', kind, x });
  return { hazards: [{ kind, x, y: config.height / 2, warn: boss.warning, ttl: BEAM_SECONDS }], seed };
}

/**
 * Runs a boss's attacks for one step of live play. Drips fall and splash on the player's
 * paddle or past it; an announced beam or lag counts down and strikes; and once an attack is
 * over, the next one draws nearer, so two never overlap. Whatever hits the player shrinks
 * their paddle for a while, or, for lag, makes the balls move in fits and starts.
 *
 * @param {GameState} state
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
export function tickHazards(state, deltaSeconds, config, events) {
  if (!config.boss) {
    return state;
  }

  let next = state;
  /** @type {Hazard[]} */
  const hazards = [];

  for (const hazard of state.hazards) {
    if (hazard.kind === 'drip') {
      const drip = { ...hazard, y: hazard.y + DRIP_SPEED * deltaSeconds };

      if (dripTouches(drip, playerPaddleBox(next, config))) {
        next = strikePlayer(next, 'drip', config);
        events.push({ type: 'hazard-hit', kind: 'drip', x: drip.x, y: drip.y });
      } else if (drip.y - DRIP_RADIUS <= config.height) {
        hazards.push(drip);
      }

      continue;
    }

    const warn = Math.max(0, hazard.warn - deltaSeconds);

    if (warn > 0) {
      hazards.push({ ...hazard, warn });
      continue;
    }

    if (hazard.kind === 'lag') {
      next = strikePlayer(next, 'lag', config);
      events.push({ type: 'hazard-hit', kind: 'lag', x: hazard.x, y: hazard.y });
      continue;
    }

    // A beam burns for a moment, and hits a paddle standing in its column once.
    const box = playerPaddleBox(next, config);

    if (box.right > hazard.x - BEAM_HALF_WIDTH && box.left < hazard.x + BEAM_HALF_WIDTH) {
      next = strikePlayer(next, 'beam', config);
      events.push({ type: 'hazard-hit', kind: 'beam', x: next.player.x, y: box.top });
    } else if (hazard.ttl - deltaSeconds > 0) {
      hazards.push({ ...hazard, warn, ttl: hazard.ttl - deltaSeconds });
    }
  }

  let { attackIn, seed } = next;

  if (hazards.length === 0) {
    attackIn = Math.max(0, attackIn - deltaSeconds);

    if (attackIn === 0) {
      const attack = launchAttack(next, config, events);
      const schedule = nextBetween(attack.seed, ...config.boss.every);
      hazards.push(...attack.hazards);
      attackIn = schedule.value;
      seed = schedule.seed;
    }
  }

  return { ...next, hazards: hazards.length > 0 ? hazards : NO_HAZARDS, attackIn, seed };
}
