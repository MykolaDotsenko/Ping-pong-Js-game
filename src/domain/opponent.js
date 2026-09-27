import { clampPaddleCenter, foldIntoRange, movePaddle, moveTowards } from './physics.js';
import { paddleWidth } from './power-ups.js';
import { phantomHidden } from './supers.js';

/** @import { Ball, GameConfig, GameState } from './types.js' */

// While a phantom is out of sight the computer guesses where it went, and may be this many
// board units out on top of its usual misjudgement, whatever its difficulty.
const PHANTOM_GUESS = 320;

/**
 * A repeatable value in [-1, 1] that changes with every hit and serve: the computer's
 * misjudgement for the ball in flight. It is derived from the state, so the simulation
 * stays deterministic while the computer still errs differently each time.
 *
 * @param {GameState} state
 */
function wobble(state) {
  const n = Math.sin(state.serveNumber * 12.9898 + state.rally * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

/**
 * The ball the computer keeps its eye on. With Multiball balls in play, that is the one that
 * will reach its paddle first, of those still in front of it; otherwise it is the ball.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 * @returns {Ball}
 */
export function watchedBall(state, config) {
  if (state.extraBalls.length === 0) {
    return state.ball;
  }

  const face = config.paddle.inset + config.paddle.height + config.ball.radius;
  /** @param {Ball} ball seconds until it reaches the paddle, or Infinity if it never will */
  const arrival = (ball) => (ball.vy < 0 && ball.y >= face ? (ball.y - face) / -ball.vy : Infinity);

  return state.extraBalls.reduce(
    (soonest, ball) => (arrival(ball) < arrival(soonest) ? ball : soonest),
    /** @type {Ball} */ (state.ball),
  );
}

/**
 * Where the computer wants its paddle. Like a person, it only reacts once the ball comes
 * within its reach, and it cannot see a ghosted ball at all. It then predicts where the ball
 * will cross its paddle, folding the path at the side walls, trusts that prediction as much
 * as its difficulty allows, misjudges it more the faster the ball flies, and far more while a
 * phantom is out of sight, and shifts to meet the ball off-center so the return angles away
 * from the player. Spin and swerves are not predicted, so a curved shot, or a super, is the
 * player's way past it.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 */
export function calculateOpponentTarget(state, config) {
  const { opponent, player } = state;
  const ball = watchedBall(state, config);
  const center = config.width / 2;
  const reactionLine = config.paddle.inset + config.opponent.reach * config.height;

  if (ball.vy >= 0 || ball.y > reactionLine || state.modifiers.opponent.ghost > 0) {
    return center;
  }

  const radius = config.ball.radius;
  const paddleFace = config.paddle.inset + config.paddle.height;
  const timeToPaddle = Math.max(0, (ball.y - radius - paddleFace) / -ball.vy);
  const crossingX = foldIntoRange(ball.x + ball.vx * timeToPaddle, radius, config.width - radius);
  const predictedX = ball.x + (crossingX - ball.x) * config.opponent.predictionWeight;
  const speedup = Math.hypot(ball.vx, ball.vy) / config.ball.initialSpeed;
  const guess = ball === state.ball && phantomHidden(state, config) ? PHANTOM_GUESS : 0;
  const misjudgement = (config.opponent.error * Math.max(0, speedup ** 1.5 - 1) + guess) * wobble(state);
  const width = paddleWidth(state, 'opponent', config);
  const awayFromPlayer = player.x < center ? 1 : -1;
  const target = predictedX + misjudgement - awayFromPlayer * config.opponent.aim * (width / 2);

  if (Math.abs(target - opponent.x) < config.opponent.trackingDeadZone) {
    return opponent.x;
  }

  return clampPaddleCenter(target, config, width);
}

/**
 * @param {GameState} state
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @returns {GameState}
 */
export function moveOpponent(state, deltaSeconds, config) {
  const target = calculateOpponentTarget(state, config);
  const maxDelta = config.opponent.maxSpeed * deltaSeconds;
  const x = moveTowards(state.opponent.x, target, maxDelta);

  return {
    ...state,
    opponent: movePaddle(state.opponent, x, deltaSeconds, config),
  };
}
