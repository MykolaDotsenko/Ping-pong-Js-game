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
 * @param {number} [width] the paddle's current width, when a power-up changed it
 */
export function clampPaddleCenter(centerX, config, width = config.paddle.width) {
  const halfWidth = width / 2;
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
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ left: number, right: number, top: number, bottom: number }} Box
 *
 * @typedef {object} PaddleContact Where a ball touches a paddle during one step.
 * @property {number} time share of the step at which they first touch, from 0 to 1
 * @property {number} x the ball's center relative to the paddle's center, touching it
 * @property {number} y the ball's center in board coordinates, touching it
 * @property {number} normalX the paddle surface's outward normal where they touch
 * @property {number} normalY
 * @property {boolean} approaching whether the ball moves into the paddle rather than away
 * @property {boolean} overlapping whether they already overlapped when the step began
 */

// Below this, distances count as touching rather than overlapping, so a ball resting exactly
// against a paddle after a contact is not caught again by rounding error.
const CONTACT_EPSILON = 1e-7;

/**
 * The earliest share of the segment start → start + delta that lies inside the box, or null.
 *
 * @param {Point} start
 * @param {Point} delta
 * @param {Box} box
 */
function segmentEntersBox(start, delta, box) {
  let enter = 0;
  let exit = 1;

  for (const [from, move, min, max] of /** @type {const} */ ([
    [start.x, delta.x, box.left, box.right],
    [start.y, delta.y, box.top, box.bottom],
  ])) {
    if (move === 0) {
      if (from < min || from > max) {
        return null;
      }
      continue;
    }

    const near = (min - from) / move;
    const far = (max - from) / move;
    enter = Math.max(enter, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));

    if (enter > exit) {
      return null;
    }
  }

  return enter;
}

/**
 * The earliest share of the segment start → start + delta that lies inside the circle, or null.
 *
 * @param {Point} start
 * @param {Point} delta
 * @param {Point} center
 * @param {number} radius
 */
function segmentEntersCircle(start, delta, center, radius) {
  const offsetX = start.x - center.x;
  const offsetY = start.y - center.y;
  const c = offsetX ** 2 + offsetY ** 2 - radius ** 2;

  if (c <= 0) {
    return 0;
  }

  const a = delta.x ** 2 + delta.y ** 2;
  const b = 2 * (offsetX * delta.x + offsetY * delta.y);
  const discriminant = b ** 2 - 4 * a * c;

  if (a === 0 || discriminant < 0) {
    return null;
  }

  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  return time >= 0 && time <= 1 ? time : null;
}

/**
 * When a circle of the given radius, moving from start by delta, first touches the box. The
 * shape its center must not enter is the box grown by the radius, with rounded corners: two
 * crossed rectangles and four corner circles. The earliest entry into any of them is the
 * first touch.
 *
 * @param {Point} start
 * @param {Point} delta
 * @param {Box} box
 * @param {number} radius
 */
function firstTouch(start, delta, box, radius) {
  const { left, right, top, bottom } = box;
  const times = [
    segmentEntersBox(start, delta, { left: left - radius, right: right + radius, top, bottom }),
    segmentEntersBox(start, delta, { left, right, top: top - radius, bottom: bottom + radius }),
    ...[[left, top], [right, top], [left, bottom], [right, bottom]].map(([x, y]) => (
      segmentEntersCircle(start, delta, { x, y }, radius)
    )),
  ].filter((time) => time !== null);

  return times.length > 0 ? Math.min(...times) : null;
}

/**
 * The point of the box nearest to p, and the box's outward normal there. For a point inside
 * the box, the normal points out through the nearest side.
 *
 * @param {Point} p
 * @param {Box} box
 */
function nearestSurface(p, box) {
  const nearest = { x: clamp(p.x, box.left, box.right), y: clamp(p.y, box.top, box.bottom) };
  const distance = Math.hypot(p.x - nearest.x, p.y - nearest.y);

  if (distance > 0) {
    return { nearest, distance, normal: { x: (p.x - nearest.x) / distance, y: (p.y - nearest.y) / distance } };
  }

  const exits = [
    { depth: p.x - box.left, normal: { x: -1, y: 0 }, nearest: { x: box.left, y: p.y } },
    { depth: box.right - p.x, normal: { x: 1, y: 0 }, nearest: { x: box.right, y: p.y } },
    { depth: p.y - box.top, normal: { x: 0, y: -1 }, nearest: { x: p.x, y: box.top } },
    { depth: box.bottom - p.y, normal: { x: 0, y: 1 }, nearest: { x: p.x, y: box.bottom } },
  ];
  const exit = exits.reduce((best, candidate) => (candidate.depth < best.depth ? candidate : best));

  return { nearest: exit.nearest, distance: 0, normal: exit.normal };
}

/**
 * Finds where a moving ball first touches a moving paddle during one step. It works in the
 * paddle's frame of reference, where the paddle stands still and the ball's path is a
 * straight segment, so fast balls cannot tunnel through and a paddle swept sideways into
 * the ball counts as well. Faces, sides and rounded corners are all solid.
 *
 * @param {object} options
 * @param {Point} options.from ball center at the start of the step
 * @param {Point} options.to ball center at the end of the step
 * @param {number} options.paddleFrom paddle center x at the start of the step
 * @param {number} options.paddleTo paddle center x at the end of the step
 * @param {number} options.paddleTop
 * @param {number} options.paddleWidth the paddle's current width, power-ups included
 * @param {GameConfig} options.config
 * @returns {PaddleContact | null}
 */
export function findPaddleContact({ from, to, paddleFrom, paddleTo, paddleTop, paddleWidth, config }) {
  const radius = config.ball.radius;
  const box = { left: -paddleWidth / 2, right: paddleWidth / 2, top: paddleTop, bottom: paddleTop + config.paddle.height };
  const start = { x: from.x - paddleFrom, y: from.y };
  const delta = { x: to.x - paddleTo - start.x, y: to.y - start.y };
  const time = firstTouch(start, delta, box, radius);

  if (time === null) {
    return null;
  }

  const touch = { x: start.x + delta.x * time, y: start.y + delta.y * time };
  const surface = nearestSurface(touch, box);
  const overlapping = time === 0 && surface.distance < radius - CONTACT_EPSILON;
  const approaching = delta.x * surface.normal.x + delta.y * surface.normal.y < 0;

  // A ball resting against the paddle, or already leaving it, is not a new contact.
  if (!overlapping && !approaching) {
    return null;
  }

  // Report the ball exactly one radius off the surface: touching, never inside.
  return {
    time,
    x: surface.nearest.x + surface.normal.x * radius,
    y: surface.nearest.y + surface.normal.y * radius,
    normalX: surface.normal.x,
    normalY: surface.normal.y,
    approaching,
    overlapping,
  };
}

/**
 * A glancing blow off a paddle's side or back corner: the ball bounces off the surface as off
 * a wall, at the same speed and without spin. A paddle never passes its own speed on this way;
 * one that runs into the ball side-on stops against it instead.
 *
 * @param {Ball} ball
 * @param {{ x: number, y: number }} normal the paddle surface's outward normal
 * @returns {Ball}
 */
export function glanceOffPaddle(ball, normal) {
  const along = ball.vx * normal.x + ball.vy * normal.y;
  return { ...ball, vx: ball.vx - 2 * along * normal.x, vy: ball.vy - 2 * along * normal.y, spin: 0 };
}

/**
 * How far from the paddle's center the ball meets it: -1 at the left edge, 1 at the right.
 *
 * @param {number} ballX
 * @param {number} paddleCenterX
 * @param {number} paddleWidth
 */
export function contactOffset(ballX, paddleCenterX, paddleWidth) {
  return clamp((ballX - paddleCenterX) / (paddleWidth / 2), -1, 1);
}

/**
 * The contact point sets the outgoing angle; the paddle's own sideways motion adds spin.
 *
 * @param {Ball} ball
 * @param {number} paddleCenterX
 * @param {1 | -1} direction vertical direction after the bounce
 * @param {GameConfig} config
 * @param {number} [paddleVx] horizontal velocity of the paddle at impact
 * @param {number} [paddleWidth] the paddle's current width, when a power-up changed it
 * @returns {Ball}
 */
export function bounceFromPaddle(ball, paddleCenterX, direction, config, paddleVx = 0, paddleWidth = config.paddle.width) {
  const normalizedOffset = contactOffset(ball.x, paddleCenterX, paddleWidth);
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
