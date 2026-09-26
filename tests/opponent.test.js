import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../src/config.js';
import { createInitialState } from '../src/domain/game.js';
import {
  calculateOpponentTarget,
  moveOpponent,
} from '../src/domain/opponent.js';

test('opponent returns toward center while the ball travels away', () => {
  const state = {
    ...createInitialState(GAME_CONFIG),
    opponent: { x: 120 },
    ball: { x: 700, y: 400, vx: 100, vy: 200 },
  };

  assert.equal(calculateOpponentTarget(state, GAME_CONFIG), GAME_CONFIG.width / 2);
});

test('opponent movement is capped by configured speed', () => {
  const deltaSeconds = 0.1;
  const state = {
    ...createInitialState(GAME_CONFIG),
    opponent: { x: 100 },
    ball: { x: 700, y: 100, vx: 300, vy: -300 },
  };

  const next = moveOpponent(state, deltaSeconds, GAME_CONFIG);
  const movement = Math.abs(next.opponent.x - state.opponent.x);

  assert.ok(movement <= GAME_CONFIG.opponent.maxSpeed * deltaSeconds + 1e-9);
});

test('opponent holds position when the target is inside its dead zone', () => {
  const state = {
    ...createInitialState(GAME_CONFIG),
    opponent: { x: 400 },
    ball: { x: 400 + GAME_CONFIG.opponent.trackingDeadZone / 2, y: 300, vx: 0, vy: -300 },
  };

  assert.equal(calculateOpponentTarget(state, GAME_CONFIG), 400);
});

test('opponent target stays inside legal paddle bounds', () => {
  const state = {
    ...createInitialState(GAME_CONFIG),
    opponent: { x: GAME_CONFIG.width / 2 },
    ball: {
      x: GAME_CONFIG.width - 1,
      y: 400,
      vx: 5000,
      vy: -200,
    },
  };

  const target = calculateOpponentTarget(state, GAME_CONFIG);
  const halfWidth = GAME_CONFIG.paddle.width / 2;

  assert.ok(target >= halfWidth);
  assert.ok(target <= GAME_CONFIG.width - halfWidth);
});
