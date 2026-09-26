import test from 'node:test';
import assert from 'node:assert/strict';

import { DIFFICULTY_CONFIGS, GAME_CONFIG } from '../src/config.js';
import { createInitialState } from '../src/domain/game.js';
import {
  calculateOpponentTarget,
  moveOpponent,
} from '../src/domain/opponent.js';

const { width, height, paddle } = GAME_CONFIG;
const center = width / 2;
const halfPaddle = paddle.width / 2;

// An opponent that neither aims nor misjudges, to test prediction on its own.
const plain = { ...GAME_CONFIG, opponent: { ...GAME_CONFIG.opponent, aim: 0, error: 0 } };

function stateWith(overrides) {
  return { ...createInitialState(GAME_CONFIG), ...overrides };
}

const ball = (overrides) => ({ x: center, y: 200, vx: 0, vy: -300, spin: 0, ...overrides });

test('opponent returns toward center while the ball travels away', () => {
  const state = stateWith({ opponent: { x: 120, vx: 0 }, ball: ball({ vy: 200 }) });

  assert.equal(calculateOpponentTarget(state, GAME_CONFIG), center);
});

test('opponent waits at the center until the ball comes within its reach', () => {
  const reactionLine = paddle.inset + GAME_CONFIG.opponent.reach * height;
  const outOfReach = stateWith({ opponent: { x: 120, vx: 0 }, ball: ball({ x: 60, y: reactionLine + 20 }) });
  const inReach = stateWith({ opponent: { x: 120, vx: 0 }, ball: ball({ x: 60, y: reactionLine - 20 }) });

  assert.equal(calculateOpponentTarget(outOfReach, plain), center);
  assert.equal(calculateOpponentTarget(inReach, plain), 60);
});

test('opponent movement is capped by configured speed', () => {
  const deltaSeconds = 0.1;
  const state = stateWith({ opponent: { x: 100, vx: 0 }, ball: ball({ x: 450, y: 100, vx: 300 }) });

  const next = moveOpponent(state, deltaSeconds, GAME_CONFIG);
  const movement = Math.abs(next.opponent.x - state.opponent.x);

  assert.ok(movement <= GAME_CONFIG.opponent.maxSpeed * deltaSeconds + 1e-9);
  assert.ok(next.opponent.vx > 0);
});

test('opponent holds position when the target is inside its dead zone', () => {
  const state = stateWith({
    opponent: { x: 300, vx: 0 },
    ball: ball({ x: 300 + GAME_CONFIG.opponent.trackingDeadZone / 2 }),
  });

  assert.equal(calculateOpponentTarget(state, plain), 300);
});

test('prediction folds the ball path at the side walls', () => {
  const predicting = { ...plain, opponent: { ...plain.opponent, predictionWeight: 1 } };
  const paddleFace = paddle.inset + paddle.height;
  const radius = GAME_CONFIG.ball.radius;
  // One second from the paddle, drifting 100 units past the right wall.
  const state = stateWith({
    opponent: { x: center, vx: 0 },
    ball: ball({ x: width - radius - 50, y: paddleFace + radius + 300, vx: 150, vy: -300 }),
  });

  assert.equal(calculateOpponentTarget(state, predicting), width - radius - 100);
});

test('opponent aims its return away from the player', () => {
  const aiming = { ...plain, opponent: { ...plain.opponent, aim: 0.5 } };
  const incoming = ball({ x: center, y: 150 });
  const playerLeft = stateWith({ player: { x: 100, vx: 0 }, opponent: { x: 0, vx: 0 }, ball: incoming });
  const playerRight = stateWith({ player: { x: 400, vx: 0 }, opponent: { x: 0, vx: 0 }, ball: incoming });

  // Meeting the ball left of center sends it right, away from a player on the left.
  assert.equal(calculateOpponentTarget(playerLeft, aiming), center - 0.5 * halfPaddle);
  assert.equal(calculateOpponentTarget(playerRight, aiming), center + 0.5 * halfPaddle);
});

test('opponent misjudges fast balls but reads a serve-speed ball exactly', () => {
  const erring = { ...plain, opponent: { ...plain.opponent, error: 60 } };
  const slow = stateWith({ opponent: { x: 0, vx: 0 }, ball: ball({ vy: -GAME_CONFIG.ball.initialSpeed }) });
  const offsets = [];

  for (let rally = 0; rally < 20; rally += 1) {
    const fast = stateWith({ rally, opponent: { x: 0, vx: 0 }, ball: ball({ vy: -2 * GAME_CONFIG.ball.initialSpeed }) });
    offsets.push(calculateOpponentTarget(fast, erring) - center);
  }

  assert.equal(calculateOpponentTarget(slow, erring), center);
  assert.ok(offsets.some((offset) => Math.abs(offset) > 20));
  assert.ok(offsets.every((offset) => Math.abs(offset) <= 60 * (2 ** 1.5 - 1) + 1e-9));
});

test('opponent target stays inside legal paddle bounds', () => {
  const state = stateWith({ opponent: { x: center, vx: 0 }, ball: ball({ x: width - 1, y: 300, vx: 5000, vy: -200 }) });

  const target = calculateOpponentTarget(state, GAME_CONFIG);

  assert.ok(target >= halfPaddle);
  assert.ok(target <= width - halfPaddle);
});

test('harder opponents are faster, react sooner, predict better and misjudge less', () => {
  const { easy, normal, hard } = DIFFICULTY_CONFIGS;

  for (const key of ['maxSpeed', 'reach', 'predictionWeight']) {
    assert.ok(easy.opponent[key] < normal.opponent[key] && normal.opponent[key] < hard.opponent[key], key);
  }

  assert.ok(easy.opponent.error > normal.opponent.error && normal.opponent.error > hard.opponent.error);
  assert.ok(easy.ball.maxSpeed < normal.ball.maxSpeed && normal.ball.maxSpeed < hard.ball.maxSpeed);
});
