/** @import { Ball, GameConfig, Paddle } from './types.js' */

// Share of a ball's spin that survives a wall bounce, reversed so the ball curves away from the wall.
const WALL_SPIN_RETENTION = 0.6;
// Spin below this is dropped, so a decaying curve ends instead of lingering forever.
const MIN_SPIN = 0.01;

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
 * Reflects a coordinate back into [min, max] as if it had bounced off both ends, which is
 * where a ball travelling in a straight line ends up after wall bounces.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function foldIntoRange(value, min, max) {
  const span = max - min;
  const offset = (((value - min) % (2 * span)) + 2 * span) % (2 * span);
  return min + (offset <= span ? offset : 2 * span - offset);
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
 * Moves a paddle to x and updates its smoothed velocity, so a quick flick reads as speed
 * while a single jittery sample does not.
 *
 * @param {Paddle} paddle
 * @param {number} x
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @returns {Paddle}
 */
export function movePaddle(paddle, x, deltaSeconds, config) {
  const measured = (x - paddle.x) / deltaSeconds;
  const blend = Math.min(1, config.paddle.velocityResponse * deltaSeconds);

  return { ...paddle, x, vx: paddle.vx + (measured - paddle.vx) * blend };
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
 * The contact point sets the outgoing angle; the paddle's own sideways motion adds spin.
 *
 * @param {Ball} ball
 * @param {number} paddleCenterX
 * @param {1 | -1} direction vertical direction after the bounce
 * @param {GameConfig} config
 * @param {number} [paddleVx] horizontal velocity of the paddle at impact
 * @returns {Ball}
 */
export function bounceFromPaddle(ball, paddleCenterX, direction, config, paddleVx = 0) {
  const halfWidth = config.paddle.width / 2;
  const normalizedOffset = clamp((ball.x - paddleCenterX) / halfWidth, -1, 1);
  const angle = normalizedOffset * config.ball.maxBounceAngleRadians;
  const currentSpeed = Math.hypot(ball.vx, ball.vy);
  const nextSpeed = Math.min(currentSpeed * config.ball.speedIncrease, config.ball.maxSpeed);
  const spin = clamp(paddleVx * config.ball.spinPerPaddleSpeed, -config.ball.maxSpin, config.ball.maxSpin);

  return {
    ...ball,
    vx: Math.sin(angle) * nextSpeed,
    vy: Math.cos(angle) * nextSpeed * direction,
    spin,
  };
}

/**
 * Bends a spinning ball's path: its direction turns toward +x for positive spin, its speed
 * stays the same, and the spin fades. The ball never leans further from vertical than the
 * steepest bounce angle, so a curve cannot stall a rally.
 *
 * @param {Ball} ball
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @returns {Ball}
 */
export function curveBall(ball, deltaSeconds, config) {
  if (!ball.spin) {
    return ball;
  }

  const speed = Math.hypot(ball.vx, ball.vy);
  const verticalSign = Math.sign(ball.vy);
  const turn = -verticalSign * ball.spin * deltaSeconds;
  let vx = ball.vx * Math.cos(turn) - ball.vy * Math.sin(turn);
  let vy = ball.vx * Math.sin(turn) + ball.vy * Math.cos(turn);
  let spin = ball.spin * Math.exp(-config.ball.spinDecay * deltaSeconds);
  const maxAngle = config.ball.maxBounceAngleRadians;

  if (Math.abs(vx) > speed * Math.sin(maxAngle) || Math.sign(vy) !== verticalSign) {
    vx = Math.sign(ball.spin) * speed * Math.sin(maxAngle);
    vy = verticalSign * speed * Math.cos(maxAngle);
    spin = 0;
  }

  return { ...ball, vx, vy, spin: Math.abs(spin) < MIN_SPIN ? 0 : spin };
}

/**
 * @param {Ball} ball
 * @param {GameConfig} config
 * @returns {Ball}
 */
export function reflectFromSideWalls(ball, config) {
  const radius = config.ball.radius;

  if (ball.x - radius < 0 && ball.vx < 0) {
    return { ...ball, x: radius, vx: -ball.vx, spin: -ball.spin * WALL_SPIN_RETENTION };
  }

  if (ball.x + radius > config.width && ball.vx > 0) {
    return { ...ball, x: config.width - radius, vx: -ball.vx, spin: -ball.spin * WALL_SPIN_RETENTION };
  }

  return ball;
}
