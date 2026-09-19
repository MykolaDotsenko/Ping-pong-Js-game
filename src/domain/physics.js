export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }

  return current + Math.sign(target - current) * maxDelta;
}

export function paddleBounds(centerX, config) {
  const halfWidth = config.paddle.width / 2;
  return {
    left: centerX - halfWidth,
    right: centerX + halfWidth,
  };
}

export function clampPaddleCenter(centerX, config) {
  const halfWidth = config.paddle.width / 2;
  return clamp(centerX, halfWidth, config.width - halfWidth);
}

export function hasCrossedPaddle({ previousBall, ball, paddleCenterX, paddleY, movingDown, config }) {
  const radius = config.ball.radius;
  const bounds = paddleBounds(paddleCenterX, config);
  const horizontalHit = ball.x + radius >= bounds.left && ball.x - radius <= bounds.right;

  if (!horizontalHit) {
    return false;
  }

  if (movingDown) {
    const previousBottom = previousBall.y + radius;
    const currentBottom = ball.y + radius;
    return previousBottom <= paddleY && currentBottom >= paddleY;
  }

  const paddleBottom = paddleY + config.paddle.height;
  const previousTop = previousBall.y - radius;
  const currentTop = ball.y - radius;
  return previousTop >= paddleBottom && currentTop <= paddleBottom;
}

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
