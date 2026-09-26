import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../src/config.js';
import {
  bounceFromPaddle,
  clampPaddleCenter,
  curveBall,
  findPaddleContact,
  foldIntoRange,
  glanceOffPaddle,
  movePaddle,
  reflectFromSideWalls,
} from '../src/domain/physics.js';

const { width, height, ball: ballConfig, paddle: paddleConfig } = GAME_CONFIG;
const radius = ballConfig.radius;
const center = width / 2;
const halfPaddle = paddleConfig.width / 2;
const playerPaddleY = height - paddleConfig.inset - paddleConfig.height;
const opponentPaddleBottom = paddleConfig.inset + paddleConfig.height;

/** The player's paddle, still at the center unless the test moves it. */
const contact = (from, to, paddle = {}) => findPaddleContact({
  from,
  to,
  paddleFrom: center,
  paddleTo: center,
  paddleTop: playerPaddleY,
  paddleWidth: paddleConfig.width,
  config: GAME_CONFIG,
  ...paddle,
});

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} ${actual} ≠ ${expected}`);

const ball = (overrides) => ({ x: center, y: height / 2, vx: 0, vy: 0, spin: 0, ...overrides });

test('clampPaddleCenter keeps the full paddle inside the board', () => {
  const half = paddleConfig.width / 2;

  assert.equal(clampPaddleCenter(-100, GAME_CONFIG), half);
  assert.equal(clampPaddleCenter(width + 100, GAME_CONFIG), width - half);
});

test('reflectFromSideWalls mirrors horizontal velocity without changing vertical velocity', () => {
  const reflected = reflectFromSideWalls(ball({ x: radius - 2, vx: -200, vy: 300 }), GAME_CONFIG);

  assert.equal(reflected.x, radius);
  assert.equal(reflected.vx, 200);
  assert.equal(reflected.vy, 300);
});

test('reflectFromSideWalls also mirrors the right wall', () => {
  const reflected = reflectFromSideWalls(ball({ x: width - radius + 3, vx: 250, vy: -300 }), GAME_CONFIG);

  assert.equal(reflected.x, width - radius);
  assert.equal(reflected.vx, -250);
  assert.equal(reflected.vy, -300);
});

test('a wall bounce reverses and weakens spin, so the ball curves away from the wall', () => {
  const reflected = reflectFromSideWalls(ball({ x: width - radius + 1, vx: 250, vy: -300, spin: 0.8 }), GAME_CONFIG);

  assert.ok(reflected.spin < 0 && reflected.spin > -0.8);
});

test('a ball away from the walls is returned untouched', () => {
  const inside = ball({ vx: 250, vy: -300 });

  assert.strictEqual(reflectFromSideWalls(inside, GAME_CONFIG), inside);
});

test('center paddle hits produce an almost vertical return', () => {
  const bounced = bounceFromPaddle(ball({ vx: 180, vy: 320 }), center, -1, GAME_CONFIG);

  assert.ok(Math.abs(bounced.vx) < 1e-9);
  assert.ok(bounced.vy < 0);
});

test('off-center paddle hits influence the bounce angle', () => {
  const bounced = bounceFromPaddle(ball({ x: center + paddleConfig.width / 3, vy: 360 }), center, -1, GAME_CONFIG);

  assert.ok(bounced.vx > 0);
  assert.ok(bounced.vy < 0);
});

test('paddle bounce speed never exceeds the configured cap', () => {
  const fast = ball({ x: center + 10, vx: ballConfig.maxSpeed, vy: ballConfig.maxSpeed });
  const bounced = bounceFromPaddle(fast, center, -1, GAME_CONFIG);

  assert.ok(Math.hypot(bounced.vx, bounced.vy) <= ballConfig.maxSpeed + 1e-9);
});

test('a paddle moving at impact adds spin in its direction, up to the cap', () => {
  const still = bounceFromPaddle(ball({ vy: 360 }), center, -1, GAME_CONFIG, 0);
  const flickRight = bounceFromPaddle(ball({ vy: 360 }), center, -1, GAME_CONFIG, 500);
  const hardFlickLeft = bounceFromPaddle(ball({ vy: 360 }), center, -1, GAME_CONFIG, -1e6);

  assert.equal(still.spin, 0);
  assert.ok(Math.abs(flickRight.spin - 500 * ballConfig.spinPerPaddleSpeed) < 1e-9);
  assert.equal(hardFlickLeft.spin, -ballConfig.maxSpin);
});

test('positive spin bends the ball toward +x whichever way it flies, keeping its speed', () => {
  for (const vy of [-400, 400]) {
    const curved = curveBall(ball({ vx: 0, vy, spin: 0.8 }), 0.1, GAME_CONFIG);

    assert.ok(curved.vx > 0, `vy ${vy}`);
    assert.ok(Math.sign(curved.vy) === Math.sign(vy));
    assert.ok(Math.abs(Math.hypot(curved.vx, curved.vy) - 400) < 1e-9);
  }
});

test('spin fades over time and stops once it is negligible', () => {
  let spinning = ball({ vy: -400, spin: 0.5 });
  const afterOneStep = curveBall(spinning, 0.1, GAME_CONFIG);

  assert.ok(afterOneStep.spin < 0.5 && afterOneStep.spin > 0);

  for (let step = 0; step < 1000 && spinning.spin !== 0; step += 1) {
    spinning = curveBall(spinning, 0.05, GAME_CONFIG);
  }

  assert.equal(spinning.spin, 0);
});

test('a curve never leans the ball further than the steepest bounce angle', () => {
  const maxLean = Math.sin(ballConfig.maxBounceAngleRadians);
  let curving = ball({ vx: 300, vy: -300, spin: ballConfig.maxSpin });

  for (let step = 0; step < 240; step += 1) {
    curving = curveBall(curving, 1 / 120, GAME_CONFIG);
    const speed = Math.hypot(curving.vx, curving.vy);

    assert.ok(Math.abs(curving.vx) <= speed * maxLean + 1e-9);
    assert.ok(curving.vy < 0);
  }

  assert.equal(curving.spin, 0);
});

test('a ball without spin flies straight', () => {
  const straight = ball({ vx: 120, vy: -400 });

  assert.strictEqual(curveBall(straight, 0.1, GAME_CONFIG), straight);
});

test('movePaddle tracks a smoothed velocity instead of single-step jumps', () => {
  const step = GAME_CONFIG.fixedStepSeconds;
  let paddle = { x: center, vx: 0 };

  paddle = movePaddle(paddle, center + 10, step, GAME_CONFIG);
  const rawVelocity = 10 / step;

  assert.equal(paddle.x, center + 10);
  assert.ok(paddle.vx > 0 && paddle.vx < rawVelocity);

  for (let i = 0; i < 60; i += 1) {
    paddle = movePaddle(paddle, paddle.x + 5, step, GAME_CONFIG);
  }

  assert.ok(Math.abs(paddle.vx - 5 / step) < 1);
});

test('foldIntoRange reflects positions past either end back into the range', () => {
  assert.equal(foldIntoRange(50, 0, 100), 50);
  assert.equal(foldIntoRange(130, 0, 100), 70);
  assert.equal(foldIntoRange(-30, 0, 100), 30);
  assert.equal(foldIntoRange(250, 0, 100), 50);
});

test('a ball meeting the face is caught where it crosses, even if its end point misses', () => {
  const touch = contact({ x: center, y: playerPaddleY - radius - 40 }, { x: center + 100, y: playerPaddleY - radius + 40 });

  near(touch.time, 0.5);
  near(touch.x, 50, 'relative to the paddle center');
  assert.equal(touch.y, playerPaddleY - radius, 'exactly one radius above the face');
  assert.deepEqual([touch.normalX, touch.normalY], [0, -1]);
  assert.equal(touch.approaching, true);
  assert.equal(touch.overlapping, false);
});

test('a ball too fast to be seen inside the paddle during any step still meets its face', () => {
  // One step carries the ball from above the paddle to below it: no frame shows it inside.
  const touch = contact({ x: center, y: playerPaddleY - 60 }, { x: center, y: playerPaddleY + 80 });

  assert.ok(touch);
  assert.deepEqual([touch.normalX, touch.normalY], [0, -1]);
});

test('the opponent paddle is met from below, on its lower face', () => {
  const touch = findPaddleContact({
    from: { x: center - 20, y: opponentPaddleBottom + radius + 20 },
    to: { x: center + 20, y: opponentPaddleBottom + radius - 20 },
    paddleFrom: center,
    paddleTo: center,
    paddleTop: paddleConfig.inset,
    paddleWidth: paddleConfig.width,
    config: GAME_CONFIG,
  });

  near(touch.time, 0.5);
  near(touch.x, 0);
  assert.equal(touch.y, opponentPaddleBottom + radius);
  assert.deepEqual([touch.normalX, touch.normalY], [0, 1]);
});

test('a ball moving away from the paddle, or passing well wide of it, touches nothing', () => {
  assert.equal(contact({ x: center, y: playerPaddleY - radius }, { x: center, y: playerPaddleY - radius - 20 }), null);
  assert.equal(contact({ x: 40, y: playerPaddleY - 40 }, { x: 60, y: playerPaddleY + 40 }), null);
});

test('a ball clipping a front corner touches it on the rounded corner, facing up and out', () => {
  // Diagonal flight that reaches the face plane 25 units wide of the paddle, then drifts into
  // its top-right corner: the old face-plane test let this ball through the paddle.
  const angle = ballConfig.maxBounceAngleRadians;
  const direction = { x: -Math.sin(angle), y: Math.cos(angle) };
  const atFace = { x: center + halfPaddle + 25, y: playerPaddleY - radius };
  const from = { x: atFace.x - direction.x * 30, y: atFace.y - direction.y * 30 };
  const to = { x: atFace.x + direction.x * 30, y: atFace.y + direction.y * 30 };
  const touch = contact(from, to);
  const corner = { x: halfPaddle, y: playerPaddleY };

  assert.ok(touch.x > halfPaddle, 'beyond the right end');
  assert.ok(touch.normalX > 0 && touch.normalY < 0, 'normal points up and to the right');
  near(Math.hypot(touch.x - corner.x, touch.y - corner.y), radius, 'one radius from the corner');
});

test('a ball that has passed the face and drifts into the side touches the side', () => {
  const touch = contact(
    { x: center + halfPaddle + radius + 12, y: playerPaddleY + 6 },
    { x: center + halfPaddle + radius - 12, y: playerPaddleY + 10 },
  );

  assert.deepEqual([touch.normalX, touch.normalY], [1, 0]);
  assert.equal(touch.x, halfPaddle + radius);
  near(touch.time, 0.5);
});

test('a paddle swept sideways into a ball beside it touches the ball, in the paddle frame', () => {
  const ballX = center + halfPaddle + radius + 5;
  const touch = contact(
    { x: ballX, y: playerPaddleY + 8 },
    { x: ballX, y: playerPaddleY + 8 },
    { paddleFrom: center, paddleTo: center + 10 },
  );

  near(touch.time, 0.5, 'the paddle covers the 5-unit gap halfway through its 10-unit move');
  assert.deepEqual([touch.normalX, touch.normalY], [1, 0]);
  assert.equal(touch.approaching, true);
});

test('a ball that starts inside the paddle is reported as overlapping, and placed on its surface', () => {
  const touch = contact({ x: center + halfPaddle + 4, y: playerPaddleY + 8 }, { x: center + halfPaddle + 8, y: playerPaddleY + 10 });

  assert.equal(touch.overlapping, true);
  assert.equal(touch.approaching, false, 'it is already moving out');
  assert.deepEqual([touch.normalX, touch.normalY], [1, 0]);
  assert.equal(touch.x, halfPaddle + radius);
});

test('a ball resting against the paddle is not caught again as it leaves', () => {
  const resting = { x: center + halfPaddle + radius, y: playerPaddleY + 8 };

  assert.equal(contact(resting, { x: resting.x + 5, y: resting.y + 3 }), null);
});

test('a glance off a still paddle side mirrors the sideways motion and keeps the downward motion', () => {
  const glanced = glanceOffPaddle(ball({ vx: -300, vy: 400, spin: 0.6 }), { x: 1, y: 0 }, 0, ballConfig.maxSpeed);

  assert.deepEqual({ vx: glanced.vx, vy: glanced.vy, spin: glanced.spin }, { vx: 300, vy: 400, spin: 0 });
});

test('a paddle moving into the ball knocks it away faster, within the speed cap', () => {
  const pushed = glanceOffPaddle(ball({ vx: 0, vy: 400 }), { x: 1, y: 0 }, 200, ballConfig.maxSpeed);
  const whacked = glanceOffPaddle(ball({ vx: 0, vy: 400 }), { x: 1, y: 0 }, 20000, ballConfig.maxSpeed);

  assert.equal(pushed.vx, 400);
  assert.equal(whacked.vy, 400, 'progress toward the goal is kept');
  near(Math.hypot(whacked.vx, whacked.vy), ballConfig.maxSpeed, 'the sideways part fills the rest of the cap');
});

test('a glance off a back corner speeds the ball on toward the goal, never back into play', () => {
  const normal = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const glanced = glanceOffPaddle(ball({ vx: -600, vy: 100 }), normal, 0, ballConfig.maxSpeed);
  const slammed = glanceOffPaddle(ball({ vx: -100, vy: 900 }), normal, 20000, ballConfig.maxSpeed);

  assert.ok(glanced.vy > 100);
  assert.deepEqual({ vx: slammed.vx, vy: slammed.vy }, { vx: 0, vy: ballConfig.maxSpeed });
});
