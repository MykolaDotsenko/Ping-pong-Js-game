import { clampPaddleCenter, moveTowards } from './physics.js';

/** @import { GameConfig, GameState } from './types.js' */

/**
 * @param {GameState} state
 * @param {GameConfig} config
 */
export function calculateOpponentTarget(state, config) {
  const { ball, opponent } = state;
  const center = config.width / 2;

  if (ball.vy >= 0) {
    return center;
  }

  const timeToPaddle = Math.max(
    0,
    (ball.y - (config.paddle.inset + config.paddle.height)) / Math.abs(ball.vy || 1),
  );
  const projectedX = ball.x + ball.vx * timeToPaddle;
  const target = ball.x * (1 - config.opponent.predictionWeight)
    + projectedX * config.opponent.predictionWeight;

  if (Math.abs(target - opponent.x) < config.opponent.trackingDeadZone) {
    return opponent.x;
  }

  return clampPaddleCenter(target, config);
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

  return {
    ...state,
    opponent: {
      ...state.opponent,
      x: moveTowards(state.opponent.x, target, maxDelta),
    },
  };
}
