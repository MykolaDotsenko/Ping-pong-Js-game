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
    { horizontalAxis: 0, pointerX: null },
    GAME_CONFIG,
  );

  assert.equal(next.score.opponent, 1);
  assert.equal(next.ball.x, GAME_CONFIG.width / 2);
  assert.equal(next.ball.y, GAME_CONFIG.height / 2);
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
    { horizontalAxis: 0, pointerX: null },
    GAME_CONFIG,
  );

  assert.equal(next.score.player, GAME_CONFIG.winningScore);
  assert.equal(next.phase, GAME_PHASE.GAME_OVER);
  assert.deepEqual({ vx: next.ball.vx, vy: next.ball.vy }, { vx: 0, vy: 0 });
});
