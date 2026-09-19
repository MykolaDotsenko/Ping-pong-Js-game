import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../src/config.js';
import {
  bounceFromPaddle,
  clampPaddleCenter,
  findPaddleCollision,
  reflectFromSideWalls,
} from '../src/domain/physics.js';

test('clampPaddleCenter keeps the full paddle inside the board', () => {
  const half = GAME_CONFIG.paddle.width / 2;

  assert.equal(clampPaddleCenter(-100, GAME_CONFIG), half);
  assert.equal(
    clampPaddleCenter(GAME_CONFIG.width + 100, GAME_CONFIG),
    GAME_CONFIG.width - half,
  );
});

test('reflectFromSideWalls mirrors horizontal velocity without changing vertical velocity', () => {
  const ball = {
    x: GAME_CONFIG.ball.radius - 2,
    y: 100,
    vx: -200,
    vy: 300,
  };

  const reflected = reflectFromSideWalls(ball, GAME_CONFIG);

  assert.equal(reflected.x, GAME_CONFIG.ball.radius);
  assert.equal(reflected.vx, 200);
  assert.equal(reflected.vy, 300);
});

test('center paddle hits produce an almost vertical return', () => {
  const incoming = {
    x: GAME_CONFIG.width / 2,
    y: 100,
    vx: 180,
    vy: 320,
  };

  const bounced = bounceFromPaddle(
    incoming,
    GAME_CONFIG.width / 2,
    -1,
    GAME_CONFIG,
  );

  assert.ok(Math.abs(bounced.vx) < 1e-9);
  assert.ok(bounced.vy < 0);
});

test('off-center paddle hits influence the bounce angle', () => {
  const incoming = {
    x: GAME_CONFIG.width / 2 + GAME_CONFIG.paddle.width / 3,
    y: 100,
    vx: 0,
    vy: 360,
  };

  const bounced = bounceFromPaddle(
    incoming,
    GAME_CONFIG.width / 2,
    -1,
    GAME_CONFIG,
  );

  assert.ok(bounced.vx > 0);
  assert.ok(bounced.vy < 0);
});

test('paddle bounce speed never exceeds the configured cap', () => {
  const incoming = {
    x: GAME_CONFIG.width / 2 + 10,
    y: 100,
    vx: GAME_CONFIG.ball.maxSpeed,
    vy: GAME_CONFIG.ball.maxSpeed,
  };

  const bounced = bounceFromPaddle(
    incoming,
    GAME_CONFIG.width / 2,
    -1,
    GAME_CONFIG,
  );

  assert.ok(
    Math.hypot(bounced.vx, bounced.vy) <= GAME_CONFIG.ball.maxSpeed + 1e-9,
  );
});

test('swept paddle collision detects a hit at the crossing point even when the final x misses', () => {
  const playerY =
    GAME_CONFIG.height - GAME_CONFIG.paddle.inset - GAME_CONFIG.paddle.height;

  const collision = findPaddleCollision({
    previousBall: { x: 400, y: 450, vx: 0, vy: 0 },
    ball: { x: 600, y: 530, vx: 0, vy: 0 },
    paddleCenterX: 400,
    paddleY: playerY,
    movingDown: true,
    config: GAME_CONFIG,
  });

  assert.ok(collision);
  assert.ok(collision.time > 0 && collision.time < 1);
  assert.ok(collision.x < 500);
});

test('swept paddle collision rejects a crossing outside paddle bounds', () => {
  const playerY =
    GAME_CONFIG.height - GAME_CONFIG.paddle.inset - GAME_CONFIG.paddle.height;

  const collision = findPaddleCollision({
    previousBall: { x: 100, y: 450, vx: 0, vy: 0 },
    ball: { x: 120, y: 530, vx: 0, vy: 0 },
    paddleCenterX: 400,
    paddleY: playerY,
    movingDown: true,
    config: GAME_CONFIG,
  });

  assert.equal(collision, null);
});
