import { clamp } from './physics.js';
import { otherSide } from './power-ups.js';
import { nextRandom } from './random.js';

/**
 * @import { Ball, GameConfig, GameEvent, GameState, Side, SuperKind, SuperMeter, SuperShot } from './types.js'
 *
 * @typedef {object} Strike what a return did with supers on
 * @property {GameState} state the state, with the ball as it leaves the paddle
 * @property {SuperKind | null} fired the super the return fired
 * @property {SuperKind | null} saved the super the return answered
 */

/** @type {readonly SuperKind[]} */
export const SUPER_KINDS = Object.freeze(['fireball', 'zigzag', 'phantom', 'thunder']);

/** @type {Readonly<SuperMeter>} */
export const EMPTY_METER = Object.freeze({ charge: 0, kind: null });

// A return this far from the paddle's center, or with this much curve, is skilful: it charges
// the meter more, and the board calls it out.
export const EDGE_OFFSET = 0.8;
export const CURVE_SPIN = 0.35;

// Every super flies at least this share of the ball's top speed; a fireball flies faster than
// any ordinary ball can.
const SUPER_SPEED_SHARE = 0.72;
const FIREBALL_SPEED_SHARE = 1.1;
// A fireball and a phantom are aimed this far wide of the receiver's paddle, toward the open side.
const FIREBALL_WIDE = 240;
const PHANTOM_WIDE = 60;
// A phantom curves on toward the open side while nobody can see it.
const PHANTOM_SPIN = 0.3;
// A zigzag leans this far from straight, in radians, and swerves the other way as it crosses
// each third of the court.
const ZIGZAG_LEAN = 0.6;
// A phantom vanishes between these shares of its way across, and shows again in time to be met.
export const PHANTOM_FROM = 0.3;
export const PHANTOM_TO = 0.9;
// Thunder flies straight at the receiver's paddle and breaks late: its spin grows with the
// square of the way it has come, just enough to land this far to the side, whatever its speed.
const THUNDER_BREAK = 110;
const THUNDER_START_SPIN = 0.05;
const THUNDER_SPEED_SHARE = 1;

// A receiver this close to the middle of the court leaves no side open; a super then goes the
// way the return leans, which the hitter aims.
const CENTERED = 30;

// Float sums of charges such as 0.1 fall a hair short of 1; this much short counts as full.
const FULL_TOLERANCE = 1e-9;

/**
 * The start of a match: both meters empty and no super in flight.
 *
 * @returns {{ meters: GameState['meters'], superShot: SuperShot | null }}
 */
export function initialSuperState() {
  return { meters: { player: EMPTY_METER, opponent: EMPTY_METER }, superShot: null };
}

/**
 * @param {SuperMeter} meter
 */
export function isLoaded(meter) {
  return meter.charge >= 1;
}

/**
 * Adds charge to a side's meter. As it fills, a super is drawn for it at random, never the one
 * it fired last, and announced; a full meter takes no more.
 *
 * @param {GameState} state
 * @param {Side} side
 * @param {number} amount
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
export function chargeMeter(state, side, amount, events) {
  const meter = state.meters[side];

  if (isLoaded(meter) || amount <= 0) {
    return state;
  }

  const charge = meter.charge + amount;

  if (charge < 1 - FULL_TOLERANCE) {
    return { ...state, meters: { ...state.meters, [side]: { ...meter, charge } } };
  }

  const roll = nextRandom(state.seed);
  const choices = SUPER_KINDS.filter((kind) => kind !== meter.kind);
  const kind = choices[Math.floor(roll.value * choices.length)];

  events.push({ type: 'super-ready', side, kind });
  return { ...state, seed: roll.seed, meters: { ...state.meters, [side]: { charge: 1, kind } } };
}

/**
 * @param {Ball} ball
 * @param {number} speed
 * @returns {Ball}
 */
function withSpeed(ball, speed) {
  const current = Math.hypot(ball.vx, ball.vy);
  const scale = current > 0 ? speed / current : 0;
  return { ...ball, vx: ball.vx * scale, vy: ball.vy * scale };
}

/**
 * The line the ball's center crosses as it meets a side's paddle.
 *
 * @param {Side} side
 * @param {GameConfig} config
 */
function faceLine(side, config) {
  const near = config.paddle.inset + config.paddle.height + config.ball.radius;
  return side === 'player' ? config.height - near : near;
}

/**
 * A ball sent from where it is toward a point on the receiver's face line, as far as the
 * steepest bounce angle allows.
 *
 * @param {Ball} ball
 * @param {number} targetX
 * @param {Side} receiver
 * @param {number} speed
 * @param {number} spin
 * @param {GameConfig} config
 * @returns {Ball}
 */
function aimAt(ball, targetX, receiver, speed, spin, config) {
  const maxAngle = config.ball.maxBounceAngleRadians;
  const angle = clamp(Math.atan2(targetX - ball.x, Math.abs(faceLine(receiver, config) - ball.y)), -maxAngle, maxAngle);
  const direction = receiver === 'player' ? 1 : -1;

  return { ...ball, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed * direction, spin };
}

/**
 * The open side of the court for a receiver: the half their paddle is not in, or, with their
 * paddle in the middle, the way the return leans. 1 is toward +x.
 *
 * @param {number} receiverX
 * @param {Ball} ball the ordinary return
 * @param {GameConfig} config
 * @returns {1 | -1}
 */
function openSide(receiverX, ball, config) {
  const offCenter = receiverX - config.width / 2;

  if (Math.abs(offCenter) > CENTERED) {
    return offCenter < 0 ? 1 : -1;
  }

  return ball.vx < 0 ? -1 : 1;
}

/**
 * What a super does to the ordinary return it rides on. A fireball flies faster than any
 * ordinary ball can, wide of the receiver's paddle toward the open side of the court. A zigzag
 * leans toward the open side and swerves at each third of the court. A phantom goes wide too
 * and vanishes halfway across. Thunder heads straight for the receiver's paddle and breaks
 * late toward the open side.
 *
 * @param {SuperKind} kind
 * @param {Ball} ball
 * @param {Side} side who fires it
 * @param {GameState} state
 * @param {GameConfig} config
 * @returns {Ball}
 */
export function launchSuper(kind, ball, side, state, config) {
  const receiver = otherSide(side);
  const receiverX = state[receiver].x;
  const speed = Math.max(Math.hypot(ball.vx, ball.vy), config.ball.maxSpeed * SUPER_SPEED_SHARE);
  const away = openSide(receiverX, ball, config);
  const margin = 2 * config.ball.radius;
  /** @param {number} distance */
  const wide = (distance) => clamp(receiverX + away * distance, margin, config.width - margin);

  switch (kind) {
    case 'fireball':
      return aimAt(ball, wide(FIREBALL_WIDE), receiver, config.ball.maxSpeed * FIREBALL_SPEED_SHARE, 0, config);
    case 'zigzag': {
      const direction = receiver === 'player' ? 1 : -1;
      return { ...ball, vx: Math.sin(ZIGZAG_LEAN) * speed * away, vy: Math.cos(ZIGZAG_LEAN) * speed * direction, spin: 0 };
    }
    case 'thunder': {
      // The spin only sets the way it will break; steerSuper makes it grow.
      const thunderSpeed = Math.max(speed, config.ball.maxSpeed * THUNDER_SPEED_SHARE);
      return aimAt(ball, receiverX, receiver, thunderSpeed, away * THUNDER_START_SPIN, config);
    }
    case 'phantom':
    default:
      return aimAt(ball, wide(PHANTOM_WIDE), receiver, speed, away * PHANTOM_SPIN, config);
  }
}

/**
 * Whether a side fires its super with this return: a person by flicking the paddle as they
 * hit, as for a curve; the computer when chance says so.
 *
 * @param {GameState} state
 * @param {Side} side
 * @param {GameConfig} config
 * @returns {{ fires: boolean, seed: number }}
 */
function firesSuper(state, side, config) {
  if (!isLoaded(state.meters[side])) {
    return { fires: false, seed: state.seed };
  }

  if (side === 'opponent' && config.opponent.controller === 'cpu') {
    const roll = nextRandom(state.seed);
    return { fires: roll.value < config.supers.cpuChance, seed: roll.seed };
  }

  return { fires: Math.abs(state[side].vx) >= config.supers.flickSpeed, seed: state.seed };
}

/**
 * A return with supers on. It answers the super in flight, if there is one, and the ball goes
 * on at the pace an ordinary rally would have had; then the hitter fires their own super, if
 * their meter is full and they flick, or, for the computer, if chance says so.
 *
 * @param {GameState} state the state, with the ball just returned by `side`
 * @param {Side} side
 * @param {GameConfig} config
 * @returns {Strike}
 */
export function strikeBack(state, side, config) {
  const flying = state.superShot;
  const ball = flying
    ? withSpeed(state.ball, Math.min(flying.speed * config.ball.speedIncrease, config.ball.maxSpeed))
    : state.ball;
  const saved = flying && flying.side !== side ? flying.kind : null;
  const { fires, seed } = firesSuper(state, side, config);

  if (!fires) {
    return { state: { ...state, ball, seed, superShot: null }, fired: null, saved };
  }

  const kind = /** @type {SuperKind} */ (state.meters[side].kind);

  return {
    state: {
      ...state,
      ball: launchSuper(kind, ball, side, state, config),
      seed,
      meters: { ...state.meters, [side]: { charge: 0, kind } },
      superShot: { kind, side, speed: Math.hypot(ball.vx, ball.vy) },
    },
    fired: kind,
    saved,
  };
}

/**
 * The charge a return earns: some for any return, more for one off the paddle's edge or with
 * curve, and more again for answering a super. A return that fires a super earns none.
 *
 * @param {Strike} strike
 * @param {number} offset how far from the paddle's center the ball was struck, from -1 to 1
 * @param {GameConfig} config
 */
export function returnCharge(strike, offset, config) {
  if (strike.fired) {
    return 0;
  }

  const { perHit, perSkill, perSave } = config.supers;
  const edge = Math.abs(offset) >= EDGE_OFFSET ? perSkill : 0;
  const curve = Math.abs(strike.state.ball.spin) >= CURVE_SPIN ? perSkill : 0;

  return perHit + edge + curve + (strike.saved ? perSave : 0);
}

/**
 * How far a shot from `side` has come on its way to the other paddle: 0 at the hitter's
 * paddle, 1 at the receiver's.
 *
 * @param {number} y
 * @param {Side} side
 * @param {GameConfig} config
 */
function shotProgress(y, side, config) {
  const from = faceLine(side, config);
  const to = faceLine(otherSide(side), config);
  return (y - from) / (to - from);
}

/**
 * Whether the ball is a phantom in the middle of the court, where nobody can see it.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 */
export function phantomHidden(state, config) {
  const shot = state.superShot;

  if (!shot || shot.kind !== 'phantom') {
    return false;
  }

  const progress = shotProgress(state.ball.y, shot.side, config);
  return progress > PHANTOM_FROM && progress < PHANTOM_TO;
}

/**
 * Steers a super in flight for one step: a zigzag swerves the other way as it crosses a third
 * of the court, and thunder's spin grows as it comes, so it breaks late; a wall that reverses
 * its spin reverses the break. Every other super flies as the ball does.
 *
 * @param {SuperShot} shot
 * @param {Ball} from where the ball began the step
 * @param {Ball} to where it ends the step
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {Ball}
 */
export function steerSuper(shot, from, to, config, events) {
  if (shot.kind === 'thunder') {
    // Spin that grows as p² across a court of length L bends a ball of speed v sideways by
    // about spin(1) · L² / (12 v), so this spin(1) breaks it THUNDER_BREAK wide.
    const span = faceLine('player', config) - faceLine('opponent', config);
    const full = (12 * Math.hypot(to.vx, to.vy) * THUNDER_BREAK) / span ** 2;
    const progress = clamp(shotProgress(to.y, shot.side, config), 0, 1);
    const spin = Math.max(THUNDER_START_SPIN, full * progress ** 2);
    return to.spin === 0 ? to : { ...to, spin: Math.sign(to.spin) * spin };
  }

  if (shot.kind !== 'zigzag') {
    return to;
  }

  const crossed = [config.height / 3, (config.height * 2) / 3].some((line) => (from.y - line) * (to.y - line) < 0);

  if (!crossed) {
    return to;
  }

  events.push({ type: 'super-swerve', x: to.x, y: to.y });
  return { ...to, vx: -to.vx };
}

/**
 * The super that scores a point for `scorer` with the ball, if the ball is one.
 *
 * @param {GameState} state
 * @param {Side} scorer
 * @returns {SuperKind | null}
 */
export function scoringSuper(state, scorer) {
  return state.superShot && state.superShot.side === scorer ? state.superShot.kind : null;
}
