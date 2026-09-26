import test from 'node:test';
import assert from 'node:assert/strict';

import { interpolateState } from '../src/application/interpolation.js';
import { GAME_CONFIG } from '../src/config.js';
import { createInitialState } from '../src/domain/game.js';

const previous = {
  ...createInitialState(GAME_CONFIG),
  player: { x: 100 },
  opponent: { x: 300 },
  ball: { x: 400, y: 200, vx: 120, vy: 240 },
};
const current = {
  ...previous,
  player: { x: 200 },
  opponent: { x: 340 },
  ball: { x: 410, y: 220, vx: 120, vy: 240 },
};

test('positions are blended by the elapsed fraction of the next step', () => {
  const frame = interpolateState(previous, current, 0.25);

  assert.equal(frame.player.x, 125);
  assert.equal(frame.opponent.x, 310);
  assert.deepEqual(frame.ball, { x: 402.5, y: 205, vx: 120, vy: 240 });
  assert.equal(frame.phase, current.phase);
});

test('a serve between the two states is not blended, so the ball never streaks', () => {
  const served = { ...current, serveNumber: previous.serveNumber + 1, ball: { x: 400, y: 260, vx: 0, vy: 360 } };

  assert.strictEqual(interpolateState(previous, served, 0.5), served);
});

test('the current state is returned as-is when there is nothing to blend', () => {
  assert.strictEqual(interpolateState(current, current, 0.5), current);
  assert.strictEqual(interpolateState(previous, current, 1), current);
});
