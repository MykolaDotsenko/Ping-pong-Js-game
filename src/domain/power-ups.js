import { nextBetween, nextRandom } from './random.js';

/** @import { GameConfig, GameEvent, GameState, Modifiers, Pickup, PowerUpKind, Side } from './types.js' */

/** @type {readonly PowerUpKind[]} */
export const POWER_UP_KINDS = Object.freeze(['wide', 'shrink', 'turbo', 'ghost']);

/** @type {Readonly<Modifiers>} */
export const NO_MODIFIERS = Object.freeze({ wide: 0, tiny: 0, ghost: 0 });

/**
 * @param {Side} side
 * @returns {Side}
 */
export function otherSide(side) {
  return side === 'player' ? 'opponent' : 'player';
}

/**
 * The side that last touched the ball: the ball flies away from whoever hit it.
 *
 * @param {GameState} state
 * @returns {Side}
 */
export function lastHitter(state) {
  return state.ball.vy < 0 ? 'player' : 'opponent';
}

/**
 * A side's paddle width once its power-ups are applied.
 *
 * @param {GameState} state
 * @param {Side} side
 * @param {GameConfig} config
 */
export function paddleWidth(state, side, config) {
  const { wide, tiny } = state.modifiers[side];
  const scale = (wide > 0 ? config.powerUps.wideScale : 1) * (tiny > 0 ? config.powerUps.shrinkScale : 1);
  return config.paddle.width * scale;
}

/**
 * @param {number} seed
 * @param {GameConfig} config
 */
function scheduleNext(seed, config) {
  const [min, max] = config.powerUps.spawnDelay;
  return nextBetween(seed, min, max);
}

/**
 * The state of a fresh match: no power-ups, and the first one some seconds away.
 *
 * @param {number} seed
 * @param {GameConfig} config
 */
export function initialPowerUpState(seed, config) {
  const schedule = scheduleNext(seed, config);

  return {
    pickups: /** @type {readonly Pickup[]} */ (Object.freeze([])),
    nextPickupIn: schedule.value,
    modifiers: { player: NO_MODIFIERS, opponent: NO_MODIFIERS },
    turbo: 0,
    seed: schedule.seed,
  };
}

/**
 * @param {Modifiers} modifiers
 * @param {number} deltaSeconds
 * @returns {Modifiers}
 */
function tickModifiers(modifiers, deltaSeconds) {
  if (modifiers.wide === 0 && modifiers.tiny === 0 && modifiers.ghost === 0) {
    return modifiers;
  }

  return {
    wide: Math.max(0, modifiers.wide - deltaSeconds),
    tiny: Math.max(0, modifiers.tiny - deltaSeconds),
    ghost: Math.max(0, modifiers.ghost - deltaSeconds),
  };
}

/**
 * Lets the active effects wear off. This runs every step, serve pauses included, so an
 * effect lasts the same wall-clock time however the rally goes.
 *
 * @param {GameState} state
 * @param {number} deltaSeconds
 * @returns {GameState}
 */
export function tickEffects(state, deltaSeconds) {
  return {
    ...state,
    modifiers: {
      player: tickModifiers(state.modifiers.player, deltaSeconds),
      opponent: tickModifiers(state.modifiers.opponent, deltaSeconds),
    },
    turbo: Math.max(0, state.turbo - deltaSeconds),
  };
}

/**
 * Runs the power-up timers for one step of live play: effects wear off, waiting pickups age
 * out, and a new one appears once the rally has gone on long enough.
 *
 * @param {GameState} state
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
export function tickPowerUps(state, deltaSeconds, config, events) {
  const next = tickEffects(state, deltaSeconds);

  if (!config.powerUps.enabled) {
    return next;
  }

  const aged = next.pickups
    .map((pickup) => ({ ...pickup, ttl: pickup.ttl - deltaSeconds }))
    .filter((pickup) => pickup.ttl > 0);
  let { nextPickupIn, seed } = next;

  if (aged.length === 0) {
    nextPickupIn = Math.max(0, nextPickupIn - deltaSeconds);

    if (nextPickupIn === 0 && next.rally >= config.powerUps.minRally) {
      const kindRoll = nextRandom(seed);
      const xRoll = nextBetween(kindRoll.seed, config.width * 0.15, config.width * 0.85);
      const yRoll = nextBetween(xRoll.seed, config.height * 0.32, config.height * 0.68);
      const schedule = scheduleNext(yRoll.seed, config);
      const kind = POWER_UP_KINDS[Math.floor(kindRoll.value * POWER_UP_KINDS.length)];
      const pickup = { id: next.serveNumber * 1000 + next.rally, kind, x: xRoll.value, y: yRoll.value, ttl: config.powerUps.lifetime };

      aged.push(pickup);
      events.push({ type: 'pickup-spawn', kind, x: pickup.x, y: pickup.y });
      nextPickupIn = schedule.value;
      seed = schedule.seed;
    }
  }

  return { ...next, pickups: aged, nextPickupIn, seed };
}

/**
 * Hands a collected power-up to the side that last hit the ball.
 *
 * @param {GameState} state
 * @param {Pickup} pickup
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function applyPickup(state, pickup, config, events) {
  const side = lastHitter(state);
  const other = otherSide(side);
  const { duration } = config.powerUps;
  const modifiers = { ...state.modifiers };
  let { ball, turbo } = state;

  switch (pickup.kind) {
    case 'wide':
      modifiers[side] = { ...modifiers[side], wide: duration };
      break;
    case 'shrink':
      modifiers[other] = { ...modifiers[other], tiny: duration };
      break;
    case 'ghost':
      modifiers[other] = { ...modifiers[other], ghost: duration };
      break;
    case 'turbo': {
      const speed = Math.hypot(ball.vx, ball.vy);
      const boost = config.powerUps.turboSpeed / speed;
      ball = { ...ball, vx: ball.vx * boost, vy: ball.vy * boost };
      turbo = duration;
      break;
    }
    default:
      break;
  }

  events.push({ type: 'pickup', kind: pickup.kind, side, x: pickup.x, y: pickup.y });

  return { ...state, ball, turbo, modifiers, pickups: state.pickups.filter((other) => other.id !== pickup.id) };
}

/**
 * Collects every power-up the ball is touching.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
export function collectPowerUps(state, config, events) {
  let next = state;

  for (const pickup of state.pickups) {
    const reach = config.powerUps.radius + config.ball.radius;

    if (Math.hypot(next.ball.x - pickup.x, next.ball.y - pickup.y) <= reach) {
      next = applyPickup(next, pickup, config, events);
    }
  }

  return next;
}
