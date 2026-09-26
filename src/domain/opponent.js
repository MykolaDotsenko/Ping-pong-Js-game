import { clampPaddleCenter, foldIntoRange, movePaddle, moveTowards } from './physics.js';
import { paddleWidth } from './power-ups.js';

/** @import { GameConfig, GameState } from './types.js' */

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
 * Where the computer wants its paddle. Like a person, it only reacts once the ball comes
 * within its reach, and it cannot see a ghosted ball at all. It then predicts where the ball
 * will cross its paddle, folding the path at the side walls, trusts that prediction as much
 * as its difficulty allows, misjudges it more the faster the ball flies, and shifts to meet
 * the ball off-center so the return angles away from the player. Spin is not predicted, so
 * a curved shot is the player's way past it.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 */
export function calculateOpponentTarget(state, config) {
  const { ball, opponent, player } = state;
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
  const misjudgement = config.opponent.error * Math.max(0, speedup ** 1.5 - 1) * wobble(state);
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
