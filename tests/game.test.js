import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../src/config.js';
import {
  advanceGame,
  createInitialState,
  GAME_PHASE,
  getWinner,
  NO_EVENTS,
  pauseGame,
  resetGame,
  setPlayerPosition,
  startGame,
  togglePause,
} from '../src/domain/game.js';

const { width, height, ball: ballConfig, paddle } = GAME_CONFIG;
const radius = ballConfig.radius;
const idleInput = Object.freeze({ horizontalAxis: 0, pointerX: null });
const step = GAME_CONFIG.fixedStepSeconds;
const playerPaddleY = height - paddle.inset - paddle.height;
const opponentPaddleBottom = paddle.inset + paddle.height;

const ball = (overrides) => ({ x: width / 2, y: height / 2, vx: 0, vy: 0, spin: 0, ...overrides });

// A running match with the ball already in play, past the serve countdown.
function runningState(overrides = {}) {
  return { ...startGame(createInitialState(GAME_CONFIG), GAME_CONFIG), serveCountdown: 0, ...overrides };
}

const eventTypes = (state) => state.events.map((event) => event.type);

test('a new match holds the ball at the center before serving, while paddles can move', () => {
  const fresh = startGame(createInitialState(GAME_CONFIG), GAME_CONFIG);
  const next = advanceGame(fresh, step, { horizontalAxis: 1, pointerX: null }, GAME_CONFIG);

  assert.deepEqual(next.ball, fresh.ball);
  assert.ok(next.player.x > fresh.player.x);
  assert.ok(Math.abs(next.serveCountdown - (GAME_CONFIG.serveDelaySeconds - step)) < 1e-9);
});

test('the ball is served as soon as the countdown runs out, with a serve event', () => {
  let state = startGame(createInitialState(GAME_CONFIG), GAME_CONFIG);
  let waitingSteps = 0;

  while (state.serveCountdown > 0) {
    state = advanceGame(state, step, idleInput, GAME_CONFIG);
    waitingSteps += 1;
  }

  const served = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.deepEqual(state.events, [{ type: 'serve', x: width / 2, y: height / 2 }]);
  assert.ok(Math.abs(waitingSteps * step - GAME_CONFIG.serveDelaySeconds) <= step);
  assert.deepEqual(state.ball, createInitialState(GAME_CONFIG).ball);
  assert.ok(served.ball.y > state.ball.y);
});

test('pausing keeps the remaining serve countdown', () => {
  const waiting = advanceGame(startGame(createInitialState(GAME_CONFIG), GAME_CONFIG), step, idleInput, GAME_CONFIG);
  const resumed = togglePause(togglePause(waiting));

  assert.equal(resumed.serveCountdown, waiting.serveCountdown);
});

test('game state transitions are explicit, reversible for pause, and announce themselves', () => {
  const ready = createInitialState(GAME_CONFIG);
  const running = startGame(ready, GAME_CONFIG);
  const paused = togglePause(running);
  const resumed = togglePause(paused);

  assert.equal(ready.phase, GAME_PHASE.READY);
  assert.equal(running.phase, GAME_PHASE.RUNNING);
  assert.equal(paused.phase, GAME_PHASE.PAUSED);
  assert.equal(resumed.phase, GAME_PHASE.RUNNING);
  assert.deepEqual([ready, running, paused, resumed].map(eventTypes), [[], ['match-start'], ['paused'], ['resumed']]);
  assert.strictEqual(resetGame(GAME_CONFIG).events, NO_EVENTS);
});

test('start resumes a paused match and begins a fresh one after game over', () => {
  const paused = pauseGame(runningState({ score: { player: 3, opponent: 2 } }));
  const resumed = startGame(paused, GAME_CONFIG);
  const rematch = startGame({ ...paused, phase: GAME_PHASE.GAME_OVER }, GAME_CONFIG);

  assert.equal(resumed.phase, GAME_PHASE.RUNNING);
  assert.deepEqual(resumed.score, { player: 3, opponent: 2 });
  assert.deepEqual(eventTypes(resumed), ['resumed']);
  assert.equal(rematch.phase, GAME_PHASE.RUNNING);
  assert.deepEqual(rematch.score, { player: 0, opponent: 0 });
  assert.deepEqual(eventTypes(rematch), ['match-start']);
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

test('quiet steps share the empty event list', () => {
  const next = advanceGame(runningState({ ball: ball({ vy: 300 }) }), step, idleInput, GAME_CONFIG);

  assert.strictEqual(next.events, NO_EVENTS);
});

test('player position is clamped at the domain boundary', () => {
  const state = createInitialState(GAME_CONFIG);
  const moved = setPlayerPosition(state, -999, GAME_CONFIG);

  assert.equal(moved.player.x, paddle.width / 2);
});

test('a pointer target places the paddle directly and wins over the keyboard axis', () => {
  const next = advanceGame(runningState(), step, { horizontalAxis: -1, pointerX: 5000 }, GAME_CONFIG);

  assert.equal(next.player.x, width - paddle.width / 2);
  assert.ok(next.player.vx > 0);
});

test('the keyboard axis moves the paddle at the configured speed', () => {
  const state = runningState();
  const next = advanceGame(state, step, { horizontalAxis: 1, pointerX: null }, GAME_CONFIG);

  assert.ok(Math.abs(next.player.x - state.player.x - paddle.keyboardSpeed * step) < 1e-9);
});

test('a ball crossing the player paddle bounces back up, a little faster, and starts a rally', () => {
  const state = runningState({ ball: ball({ y: playerPaddleY - radius - 2, vy: 360 }) });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.ok(next.ball.vy < 0);
  assert.equal(next.ball.y, playerPaddleY - radius);
  assert.ok(Math.abs(Math.hypot(next.ball.vx, next.ball.vy) - 360 * ballConfig.speedIncrease) < 1e-9);
  assert.equal(next.rally, 1);
  assert.equal(next.longestRally, 1);
  assert.deepEqual(next.events, [{
    type: 'paddle-hit',
    side: 'player',
    x: width / 2,
    y: playerPaddleY - radius,
    speed: Math.hypot(next.ball.vx, next.ball.vy),
    spin: 0,
    rally: 1,
  }]);
});

test('a ball crossing the opponent paddle bounces back down', () => {
  const state = runningState({ rally: 4, ball: ball({ y: opponentPaddleBottom + radius + 2, vy: -360 }) });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.ok(next.ball.vy > 0);
  assert.equal(next.ball.y, opponentPaddleBottom + radius);
  assert.equal(next.events[0].side, 'opponent');
  assert.equal(next.rally, 5);
});

test('flicking the paddle as it meets the ball puts spin on the return', () => {
  const state = runningState({
    player: { x: width / 2, vx: 0 },
    ball: ball({ y: playerPaddleY - radius - 2, vy: 360 }),
  });

  // The paddle sweeps right through the ball over the step in which they meet.
  const next = advanceGame(state, step, { horizontalAxis: 0, pointerX: width / 2 + 8 }, GAME_CONFIG);

  assert.equal(next.events[0].type, 'paddle-hit');
  assert.ok(next.ball.spin > 0);
  assert.equal(next.events[0].spin, next.ball.spin);
});

test('bouncing off a side wall is reported', () => {
  const state = runningState({ ball: ball({ x: width - radius - 1, vx: 300, vy: -300 }) });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.deepEqual(eventTypes(next), ['wall-bounce']);
  assert.ok(next.ball.vx < 0);
});

test('a player who tracks the ball sustains a long rally that exercises both paddles', () => {
  let state = runningState();
  let playerHits = 0;
  let opponentHits = 0;

  for (let i = 0; i < 20 / step; i += 1) {
    state = advanceGame(state, step, { horizontalAxis: 0, pointerX: state.ball.x }, GAME_CONFIG);

    for (const event of state.events) {
      if (event.type === 'paddle-hit') {
        if (event.side === 'player') playerHits += 1;
        else opponentHits += 1;
      }
    }

    assert.ok(Math.hypot(state.ball.vx, state.ball.vy) <= ballConfig.maxSpeed + 1e-9);
    assert.ok(state.ball.x >= radius);
    assert.ok(state.ball.x <= width - radius);
  }

  assert.deepEqual(state.score, { player: 0, opponent: 0 });
  assert.ok(playerHits >= 8, `expected at least 8 player hits, got ${playerHits}`);
  assert.ok(opponentHits >= 8, `expected at least 8 opponent hits, got ${opponentHits}`);
  assert.equal(state.longestRally, playerHits + opponentHits);
});

test('crossing the bottom boundary awards the opponent a point, resets the ball and the rally', () => {
  const state = runningState({ rally: 6, longestRally: 6, ball: ball({ x: 10, y: height + radius + 1, vy: 300 }) });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.equal(next.score.opponent, 1);
  assert.equal(next.ball.x, width / 2);
  assert.equal(next.ball.y, height / 2);
  assert.equal(next.serveCountdown, GAME_CONFIG.serveDelaySeconds);
  assert.equal(next.rally, 0);
  assert.equal(next.longestRally, 6);
  assert.deepEqual(next.events, [{ type: 'point', scorer: 'opponent', x: 10, y: height }]);
});

test('a point is counted only once because the ball is reset immediately', () => {
  const state = runningState({ ball: ball({ x: 10, y: height + radius + 1, vy: 300 }) });

  const afterPoint = advanceGame(state, step, idleInput, GAME_CONFIG);
  const afterNextStep = advanceGame(afterPoint, step, idleInput, GAME_CONFIG);

  assert.equal(afterPoint.score.opponent, 1);
  assert.equal(afterNextStep.score.opponent, 1);
});

test('winning point moves the state machine to game-over', () => {
  const state = runningState({
    score: { player: GAME_CONFIG.winningScore - 1, opponent: 0 },
    ball: ball({ x: 10, y: -radius - 1, vy: -300, spin: 0.5 }),
  });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.equal(next.score.player, GAME_CONFIG.winningScore);
  assert.equal(next.phase, GAME_PHASE.GAME_OVER);
  assert.deepEqual({ vx: next.ball.vx, vy: next.ball.vy, spin: next.ball.spin }, { vx: 0, vy: 0, spin: 0 });
  assert.equal(next.serveCountdown, 0);
  assert.deepEqual(eventTypes(next), ['point', 'game-over']);
  assert.deepEqual(next.events[1], { type: 'game-over', winner: 'player' });
});

test('serve after a player point travels back toward the player', () => {
  const state = runningState({ ball: ball({ x: 10, y: -radius - 1, vy: -300 }) });

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.equal(next.score.player, 1);
  assert.ok(next.ball.vy > 0);
  assert.deepEqual(next.events[0], { type: 'point', scorer: 'player', x: 10, y: 0 });
});
