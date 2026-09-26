import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../src/config.js';
import {
  advanceGame,
  createInitialState,
  GAME_PHASE,
  getWinner,
  pauseGame,
  setPlayerPosition,
  startGame,
  togglePause,
} from '../src/domain/game.js';

const idleInput = Object.freeze({ horizontalAxis: 0, pointerX: null });
const step = GAME_CONFIG.fixedStepSeconds;
const playerPaddleY = GAME_CONFIG.height - GAME_CONFIG.paddle.inset - GAME_CONFIG.paddle.height;
const opponentPaddleBottom = GAME_CONFIG.paddle.inset + GAME_CONFIG.paddle.height;

function runningState(overrides = {}) {
  return { ...startGame(createInitialState(GAME_CONFIG), GAME_CONFIG), ...overrides };
}

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

test('start resumes a paused match and begins a fresh one after game over', () => {
  const paused = pauseGame(runningState({ score: { player: 3, opponent: 2 } }));
  const resumed = startGame(paused, GAME_CONFIG);
  const rematch = startGame({ ...paused, phase: GAME_PHASE.GAME_OVER }, GAME_CONFIG);

  assert.equal(resumed.phase, GAME_PHASE.RUNNING);
  assert.deepEqual(resumed.score, { player: 3, opponent: 2 });
  assert.equal(rematch.phase, GAME_PHASE.RUNNING);
  assert.deepEqual(rematch.score, { player: 0, opponent: 0 });
});

test('pauseGame only pauses a running match, so repeated requests are harmless', () => {
  const ready = createInitialState(GAME_CONFIG);
  const paused = pauseGame(runningState());

  assert.equal(paused.phase, GAME_PHASE.PAUSED);
  assert.strictEqual(pauseGame(paused), paused);
  assert.strictEqual(pauseGame(ready), ready);
});

test('getWinner names the winner only once the match is over', () => {
  const running = runningState({ score: { player: 5, opponent: 2 } });

  assert.equal(getWinner(running), null);
  assert.equal(getWinner({ ...running, phase: GAME_PHASE.GAME_OVER }), 'player');
  assert.equal(
    getWinner({ ...running, phase: GAME_PHASE.GAME_OVER, score: { player: 4, opponent: 7 } }),
    'opponent',
  );
});

test('advanceGame is a no-op while paused', () => {
  const paused = togglePause(runningState());
  const next = advanceGame(paused, step, idleInput, GAME_CONFIG);

  assert.strictEqual(next, paused);
});

test('player position is clamped at the domain boundary', () => {
  const state = createInitialState(GAME_CONFIG);
  const moved = setPlayerPosition(state, -999, GAME_CONFIG);

  assert.equal(moved.player.x, GAME_CONFIG.paddle.width / 2);
});

test('a pointer target places the paddle directly and wins over the keyboard axis', () => {
  const next = advanceGame(
    runningState(),
    step,
    { horizontalAxis: -1, pointerX: 5000 },
    GAME_CONFIG,
  );

  assert.equal(next.player.x, GAME_CONFIG.width - GAME_CONFIG.paddle.width / 2);
});

test('the keyboard axis moves the paddle at the configured speed', () => {
  const state = runningState();
  const next = advanceGame(state, step, { horizontalAxis: 1, pointerX: null }, GAME_CONFIG);

  assert.ok(Math.abs(next.player.x - state.player.x - GAME_CONFIG.paddle.keyboardSpeed * step) < 1e-9);
});

test('a ball crossing the player paddle bounces back up, a little faster', () => {
  const state = runningState({
    ball: { x: GAME_CONFIG.width / 2, y: playerPaddleY - GAME_CONFIG.ball.radius - 2, vx: 0, vy: 360 },
  });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.ok(next.ball.vy < 0);
  assert.equal(next.ball.y, playerPaddleY - GAME_CONFIG.ball.radius);
  assert.ok(Math.abs(Math.hypot(next.ball.vx, next.ball.vy) - 360 * GAME_CONFIG.ball.speedIncrease) < 1e-9);
});

test('a ball crossing the opponent paddle bounces back down', () => {
  const state = runningState({
    ball: { x: GAME_CONFIG.width / 2, y: opponentPaddleBottom + GAME_CONFIG.ball.radius + 2, vx: 0, vy: -360 },
  });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.ok(next.ball.vy > 0);
  assert.equal(next.ball.y, opponentPaddleBottom + GAME_CONFIG.ball.radius);
});

test('a player who tracks the ball sustains a rally that exercises both paddles', () => {
  let state = runningState();
  let playerHits = 0;
  let opponentHits = 0;

  for (let i = 0; i < 20 / step; i += 1) {
    const previous = state;
    state = advanceGame(state, step, { horizontalAxis: 0, pointerX: state.ball.x }, GAME_CONFIG);

    if (previous.ball.vy > 0 && state.ball.vy < 0) playerHits += 1;
    if (previous.ball.vy < 0 && state.ball.vy > 0) opponentHits += 1;

    assert.ok(Math.hypot(state.ball.vx, state.ball.vy) <= GAME_CONFIG.ball.maxSpeed + 1e-9);
    assert.ok(state.ball.x >= GAME_CONFIG.ball.radius);
    assert.ok(state.ball.x <= GAME_CONFIG.width - GAME_CONFIG.ball.radius);
  }

  assert.deepEqual(state.score, { player: 0, opponent: 0 });
  assert.ok(playerHits >= 10, `expected at least 10 player hits, got ${playerHits}`);
  assert.ok(opponentHits >= 10, `expected at least 10 opponent hits, got ${opponentHits}`);
});

test('crossing the bottom boundary awards the opponent a point and resets the ball', () => {
  const state = runningState({
    ball: { x: 10, y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1, vx: 0, vy: 300 },
  });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.equal(next.score.opponent, 1);
  assert.equal(next.ball.x, GAME_CONFIG.width / 2);
  assert.equal(next.ball.y, GAME_CONFIG.height / 2);
});

test('a point is counted only once because the ball is reset immediately', () => {
  const state = runningState({
    ball: { x: 10, y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1, vx: 0, vy: 300 },
  });

  const afterPoint = advanceGame(state, step, idleInput, GAME_CONFIG);
  const afterNextStep = advanceGame(afterPoint, step, idleInput, GAME_CONFIG);

  assert.equal(afterPoint.score.opponent, 1);
  assert.equal(afterNextStep.score.opponent, 1);
});

test('winning point moves the state machine to game-over', () => {
  const state = runningState({
    score: { player: GAME_CONFIG.winningScore - 1, opponent: 0 },
    ball: { x: 10, y: -GAME_CONFIG.ball.radius - 1, vx: 0, vy: -300 },
  });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.equal(next.score.player, GAME_CONFIG.winningScore);
  assert.equal(next.phase, GAME_PHASE.GAME_OVER);
  assert.deepEqual({ vx: next.ball.vx, vy: next.ball.vy }, { vx: 0, vy: 0 });
});

test('serve after a player point travels back toward the player', () => {
  const state = runningState({
    ball: { x: 10, y: -GAME_CONFIG.ball.radius - 1, vx: 0, vy: -300 },
  });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.equal(next.score.player, 1);
  assert.ok(next.ball.vy > 0);
});
