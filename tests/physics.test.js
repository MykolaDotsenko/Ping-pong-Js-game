import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../src/config.js';
import {
  bounceFromPaddle,
  clampPaddleCenter,
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
  assert.ok(Math.hypot(bounced.vx, bounced.vy) > Math.hypot(incoming.vx, incoming.vy));
});
