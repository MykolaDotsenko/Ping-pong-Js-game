/** @import { Ball, GameConfig } from './types.js' */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * @param {number} current
 * @param {number} target
 * @param {number} maxDelta
 */
export function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }

  return current + Math.sign(target - current) * maxDelta;
}

/**
 * @param {number} centerX
 * @param {GameConfig} config
 */
export function paddleBounds(centerX, config) {
  const halfWidth = config.paddle.width / 2;
  return {
    left: centerX - halfWidth,
    right: centerX + halfWidth,
  };
}

/**
 * @param {number} centerX
 * @param {GameConfig} config
 */
export function clampPaddleCenter(centerX, config) {
  const halfWidth = config.paddle.width / 2;
  return clamp(centerX, halfWidth, config.width - halfWidth);
}

/**
 * @param {object} options
 * @param {Ball} options.previousBall
 * @param {Ball} options.ball
 * @param {number} options.paddleCenterX
 * @param {number} options.paddleY
 * @param {boolean} options.movingDown
 * @param {GameConfig} options.config
 * @returns {{ time: number, x: number } | null}
 */
export function findPaddleCollision({
  previousBall,
  ball,
  paddleCenterX,
  paddleY,
  movingDown,
  config,
}) {
  const radius = config.ball.radius;
  const collisionPlane = movingDown ? paddleY : paddleY + config.paddle.height;
  const edgeOffset = movingDown ? radius : -radius;
  const previousLeadingEdge = previousBall.y + edgeOffset;
  const currentLeadingEdge = ball.y + edgeOffset;
  const travel = currentLeadingEdge - previousLeadingEdge;

  if (movingDown) {
    if (travel <= 0 || previousLeadingEdge > collisionPlane || currentLeadingEdge < collisionPlane) {
      return null;
    }
  } else if (
    travel >= 0
    || previousLeadingEdge < collisionPlane
    || currentLeadingEdge > collisionPlane
  ) {
    return null;
  }

  const time = (collisionPlane - previousLeadingEdge) / travel;
  const x = previousBall.x + (ball.x - previousBall.x) * time;
  const bounds = paddleBounds(paddleCenterX, config);
  const overlapsHorizontally = x + radius >= bounds.left && x - radius <= bounds.right;

  return overlapsHorizontally ? { time, x } : null;
}

/**
 * @param {Ball} ball
 * @param {number} paddleCenterX
 * @param {1 | -1} direction vertical direction after the bounce
 * @param {GameConfig} config
 * @returns {Ball}
 */
export function bounceFromPaddle(ball, paddleCenterX, direction, config) {
  const halfWidth = config.paddle.width / 2;
  const normalizedOffset = clamp((ball.x - paddleCenterX) / halfWidth, -1, 1);
  const angle = normalizedOffset * config.ball.maxBounceAngleRadians;
  const currentSpeed = Math.hypot(ball.vx, ball.vy);
  const nextSpeed = Math.min(currentSpeed * config.ball.speedIncrease, config.ball.maxSpeed);

  return {
    ...ball,
    vx: Math.sin(angle) * nextSpeed,
    vy: Math.cos(angle) * nextSpeed * direction,
  };
}

/**
 * @param {Ball} ball
 * @param {GameConfig} config
 * @returns {Ball}
 */
export function reflectFromSideWalls(ball, config) {
  const radius = config.ball.radius;
  let { x, vx } = ball;

  if (x - radius < 0 && vx < 0) {
    x = radius;
    vx = -vx;
  } else if (x + radius > config.width && vx > 0) {
    x = config.width - radius;
    vx = -vx;
  }

  return { ...ball, x, vx };
}
