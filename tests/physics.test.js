import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../src/config.js';
import {
  bounceFromPaddle,
  clampPaddleCenter,
  curveBall,
  findPaddleCollision,
  foldIntoRange,
  movePaddle,
  reflectFromSideWalls,
} from '../src/domain/physics.js';

const { width, height, ball: ballConfig, paddle: paddleConfig } = GAME_CONFIG;
const radius = ballConfig.radius;
const center = width / 2;
const playerPaddleY = height - paddleConfig.inset - paddleConfig.height;
const opponentPaddleBottom = paddleConfig.inset + paddleConfig.height;

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

test('swept paddle collision detects a hit at the crossing point even when the final x misses', () => {
  const collision = findPaddleCollision({
    previousBall: ball({ x: center, y: playerPaddleY - radius - 40 }),
    ball: ball({ x: center + 100, y: playerPaddleY - radius + 40 }),
    paddleCenterX: center,
    paddleY: playerPaddleY,
    movingDown: true,
    config: GAME_CONFIG,
  });

  assert.ok(collision);
  assert.ok(Math.abs(collision.time - 0.5) < 1e-9);
  assert.ok(Math.abs(collision.x - (center + 50)) < 1e-9);
});

test('swept collision also detects an upward crossing of the opponent paddle', () => {
  const collision = findPaddleCollision({
    previousBall: ball({ x: center - 20, y: opponentPaddleBottom + radius + 20 }),
    ball: ball({ x: center + 20, y: opponentPaddleBottom + radius - 20 }),
    paddleCenterX: center,
    paddleY: paddleConfig.inset,
    movingDown: false,
    config: GAME_CONFIG,
  });

  assert.ok(collision);
  assert.ok(Math.abs(collision.time - 0.5) < 1e-9);
  assert.ok(Math.abs(collision.x - center) < 1e-9);
});

test('swept collision ignores a ball moving away from the paddle plane', () => {
  const collision = findPaddleCollision({
    previousBall: ball({ y: opponentPaddleBottom + 20 }),
    ball: ball({ y: opponentPaddleBottom + 30 }),
    paddleCenterX: center,
    paddleY: paddleConfig.inset,
    movingDown: false,
    config: GAME_CONFIG,
  });

  assert.equal(collision, null);
});

test('swept paddle collision rejects a crossing outside paddle bounds', () => {
  const collision = findPaddleCollision({
    previousBall: ball({ x: 40, y: playerPaddleY - radius - 40 }),
    ball: ball({ x: 60, y: playerPaddleY - radius + 40 }),
    paddleCenterX: width - paddleConfig.width / 2,
    paddleY: playerPaddleY,
    movingDown: true,
    config: GAME_CONFIG,
  });

  assert.equal(collision, null);
});
