import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../src/config.js';
import {
  advanceGame,
  createInitialState,
  GAME_PHASE,
  setPlayerPosition,
  startGame,
  togglePause,
} from '../src/domain/game.js';

const idleInput = Object.freeze({ horizontalAxis: 0, pointerX: null });

test('game state transitions are explicit and reversible for pause', () => {
  const ready = createInitialState(GAME_CONFIG);
  const running = startGame(ready, GAME_CONFIG);
  const paused = togglePause(running);
  const resumed = togglePause(paused);

  assert.equal(ready.phase, GAME_PHASE.READY);
  assert.equal(running.phase, GAME_PHASE.RUNNING);
  assert.equal(paused.phase, GAME_PHASE.PAUSED);
  assert.equal(resumed.phase, GAME_PHASE.RUNNING);
});

test('advanceGame is a no-op while paused', () => {
  const running = startGame(createInitialState(GAME_CONFIG), GAME_CONFIG);
  const paused = togglePause(running);
  const next = advanceGame(
    paused,
    GAME_CONFIG.fixedStepSeconds,
    idleInput,
    GAME_CONFIG,
  );

  assert.strictEqual(next, paused);
});

test('player position is clamped at the domain boundary', () => {
  const state = createInitialState(GAME_CONFIG);
  const moved = setPlayerPosition(state, -999, GAME_CONFIG);

  assert.equal(moved.player.x, GAME_CONFIG.paddle.width / 2);
});

test('crossing the bottom boundary awards the opponent a point and resets the ball', () => {
  let state = startGame(createInitialState(GAME_CONFIG), GAME_CONFIG);
  state = {
    ...state,
    ball: {
      x: 10,
      y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1,
      vx: 0,
      vy: 300,
    },
  };

  const next = advanceGame(
    state,
    GAME_CONFIG.fixedStepSeconds,
    idleInput,
    GAME_CONFIG,
  );

  assert.equal(next.score.opponent, 1);
  assert.equal(next.ball.x, GAME_CONFIG.width / 2);
  assert.equal(next.ball.y, GAME_CONFIG.height / 2);
});

test('a point is counted only once because the ball is reset immediately', () => {
  let state = startGame(createInitialState(GAME_CONFIG), GAME_CONFIG);
  state = {
    ...state,
    ball: {
      x: 10,
      y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1,
      vx: 0,
      vy: 300,
    },
  };

  const afterPoint = advanceGame(
    state,
    GAME_CONFIG.fixedStepSeconds,
    idleInput,
    GAME_CONFIG,
  );
  const afterNextStep = advanceGame(
    afterPoint,
    GAME_CONFIG.fixedStepSeconds,
    idleInput,
    GAME_CONFIG,
  );

  assert.equal(afterPoint.score.opponent, 1);
  assert.equal(afterNextStep.score.opponent, 1);
});

test('winning point moves the state machine to game-over', () => {
  let state = startGame(createInitialState(GAME_CONFIG), GAME_CONFIG);
  state = {
    ...state,
    score: { player: GAME_CONFIG.winningScore - 1, opponent: 0 },
    ball: {
      x: 10,
      y: -GAME_CONFIG.ball.radius - 1,
      vx: 0,
      vy: -300,
    },
  };

  const next = advanceGame(
    state,
    GAME_CONFIG.fixedStepSeconds,
    idleInput,
    GAME_CONFIG,
  );

  assert.equal(next.score.player, GAME_CONFIG.winningScore);
  assert.equal(next.phase, GAME_PHASE.GAME_OVER);
  assert.deepEqual({ vx: next.ball.vx, vy: next.ball.vy }, { vx: 0, vy: 0 });
});

test('serve after a player point travels back toward the player', () => {
  let state = startGame(createInitialState(GAME_CONFIG), GAME_CONFIG);
  state = {
    ...state,
    ball: {
      x: 10,
      y: -GAME_CONFIG.ball.radius - 1,
      vx: 0,
      vy: -300,
    },
  };

  const next = advanceGame(
    state,
    GAME_CONFIG.fixedStepSeconds,
    idleInput,
    GAME_CONFIG,
  );

  assert.equal(next.score.player, 1);
  assert.ok(next.ball.vy > 0);
});
