import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG } from '../src/config.js';
import {
  advanceGame,
  createInitialState,
  GAME_PHASE,
  getWinner,
  matchPointSide,
  NO_EVENTS,
  pauseGame,
  resetGame,
  startGame,
  togglePause,
} from '../src/domain/game.js';

const { width, height, ball: ballConfig, paddle } = GAME_CONFIG;
const radius = ballConfig.radius;
const idleInput = Object.freeze({ horizontalAxis: 0, pointerX: null, opponentAxis: 0, opponentPointerX: null });
const step = GAME_CONFIG.fixedStepSeconds;
const playerPaddleY = height - paddle.inset - paddle.height;
const opponentPaddleBottom = paddle.inset + paddle.height;

// Power-ups have their own tests; the rules here are easier to read without them.
const PLAIN = { ...GAME_CONFIG, powerUps: { ...GAME_CONFIG.powerUps, enabled: false } };

const ball = (overrides) => ({ x: width / 2, y: height / 2, vx: 0, vy: 0, spin: 0, ...overrides });

// A running match with the ball already in play, past the serve countdown.
function runningState(overrides = {}, config = PLAIN) {
  return { ...startGame(createInitialState(config), config), serveCountdown: 0, ...overrides };
}

const eventTypes = (state) => state.events.map((event) => event.type);

/**
 * Runs the simulation until the predicate holds or the time runs out.
 */
function runUntil(state, config, input, predicate, seconds = 30) {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    state = advanceGame(state, step, input, config);

    if (predicate(state)) {
      return state;
    }
  }

  throw new Error(`condition not reached within ${seconds}s`);
}

test('a new match holds the ball at the center before serving, while paddles can move', () => {
  const fresh = startGame(createInitialState(PLAIN), PLAIN);
  const next = advanceGame(fresh, step, { ...idleInput, horizontalAxis: 1 }, PLAIN);

  assert.deepEqual(next.ball, fresh.ball);
  assert.ok(next.player.x > fresh.player.x);
  assert.ok(Math.abs(next.serveCountdown - (PLAIN.startDelaySeconds - step)) < 1e-9);
});

test('the first serve of a match counts down from three, aloud, then serves', () => {
  let state = startGame(createInitialState(PLAIN), PLAIN);
  const countdown = [];
  let serves = 0;

  while (state.serveCountdown > 0) {
    state = advanceGame(state, step, idleInput, PLAIN);

    for (const event of state.events) {
      if (event.type === 'countdown') countdown.push(event.value);
      if (event.type === 'serve') serves += 1;
    }
  }

  assert.deepEqual(countdown, [3, 2, 1]);
  assert.equal(serves, 1);
  assert.deepEqual(state.ball, createInitialState(PLAIN).ball);
});

test('later serves wait the short serve delay without a countdown', () => {
  const state = runningState({ ball: ball({ x: 10, y: -radius - 1, vy: -300 }) });
  const afterPoint = advanceGame(state, step, idleInput, PLAIN);

  assert.equal(afterPoint.serveCountdown, PLAIN.serveDelaySeconds);

  const served = runUntil(afterPoint, PLAIN, idleInput, (s) => s.serveCountdown === 0, 2);
  const countdowns = [];

  for (let s = afterPoint; s.serveCountdown > 0; s = advanceGame(s, step, idleInput, PLAIN)) {
    countdowns.push(...s.events.filter((event) => event.type === 'countdown'));
  }

  assert.deepEqual(countdowns, []);
  assert.deepEqual(eventTypes(served), ['serve']);
});

test('pausing keeps the remaining serve countdown', () => {
  const waiting = advanceGame(startGame(createInitialState(PLAIN), PLAIN), step, idleInput, PLAIN);
  const resumed = togglePause(togglePause(waiting));

  assert.equal(resumed.serveCountdown, waiting.serveCountdown);
});

test('game state transitions are explicit, reversible for pause, and announce themselves', () => {
  const ready = createInitialState(PLAIN);
  const running = startGame(ready, PLAIN);
  const paused = togglePause(running);
  const resumed = togglePause(paused);

  assert.equal(ready.phase, GAME_PHASE.READY);
  assert.equal(running.phase, GAME_PHASE.RUNNING);
  assert.equal(paused.phase, GAME_PHASE.PAUSED);
  assert.equal(resumed.phase, GAME_PHASE.RUNNING);
  assert.deepEqual([ready, running, paused, resumed].map(eventTypes), [[], ['match-start'], ['paused'], ['resumed']]);
  assert.deepEqual(eventTypes(resetGame(PLAIN)), ['menu']);
});

test('start resumes a paused match and begins a fresh one after game over', () => {
  const paused = pauseGame(runningState({ score: { player: 3, opponent: 2 } }));
  const resumed = startGame(paused, PLAIN);
  const rematch = startGame({ ...paused, phase: GAME_PHASE.GAME_OVER }, PLAIN);

  assert.equal(resumed.phase, GAME_PHASE.RUNNING);
  assert.deepEqual(resumed.score, { player: 3, opponent: 2 });
  assert.deepEqual(eventTypes(resumed), ['resumed']);
  assert.equal(rematch.phase, GAME_PHASE.RUNNING);
  assert.deepEqual(rematch.score, { player: 0, opponent: 0 });
  assert.deepEqual(eventTypes(rematch), ['match-start']);
});

test('the same seed replays the same match', () => {
  const play = (seed) => {
    let state = startGame(createInitialState(GAME_CONFIG, seed), GAME_CONFIG);
    const log = [];

    for (let elapsed = 0; elapsed < 40; elapsed += step) {
      state = advanceGame(state, step, { ...idleInput, pointerX: state.ball.x }, GAME_CONFIG);
      log.push(...state.events.map((event) => event.type));
    }

    return log.join(',');
  };

  assert.equal(play(7), play(7));
  assert.notEqual(play(7), play(8));
});

test('pauseGame only pauses a running match, so repeated requests are harmless', () => {
  const ready = createInitialState(PLAIN);
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
  const next = advanceGame(paused, step, idleInput, PLAIN);

  assert.strictEqual(next, paused);
});

test('quiet steps share the empty event list', () => {
  const next = advanceGame(runningState({ ball: ball({ vy: 300 }) }), step, idleInput, PLAIN);

  assert.strictEqual(next.events, NO_EVENTS);
});

test('a pointer far off the court leaves the whole paddle on it', () => {
  const next = advanceGame(runningState(), step, { ...idleInput, pointerX: -999 }, PLAIN);

  assert.equal(next.player.x, paddle.width / 2);
});

test('a pointer target places the paddle directly and wins over the keyboard axis', () => {
  const next = advanceGame(runningState(), step, { ...idleInput, horizontalAxis: -1, pointerX: 5000 }, PLAIN);

  assert.equal(next.player.x, width - paddle.width / 2);
  assert.ok(next.player.vx > 0);
});

test('the keyboard axis moves the paddle at the configured speed', () => {
  const state = runningState();
  const next = advanceGame(state, step, { ...idleInput, horizontalAxis: 1 }, PLAIN);

  assert.ok(Math.abs(next.player.x - state.player.x - paddle.keyboardSpeed * step) < 1e-9);
});

test('a ball crossing the player paddle bounces back up, a little faster, and starts a rally', () => {
  const state = runningState({ ball: ball({ y: playerPaddleY - radius - 2, vy: 360 }) });

  const next = advanceGame(state, step, idleInput, PLAIN);

  assert.ok(next.ball.vy < 0);
  assert.equal(next.ball.y, playerPaddleY - radius);
  assert.ok(Math.abs(Math.hypot(next.ball.vx, next.ball.vy) - 360 * ballConfig.speedIncrease) < 1e-9);
  assert.equal(next.rally, 1);
  assert.equal(next.longestRally, 1);
  assert.deepEqual(next.hits, { player: 1, opponent: 0 });
  assert.deepEqual(next.events, [{
    type: 'paddle-hit',
    side: 'player',
    x: width / 2,
    y: playerPaddleY - radius,
    speed: Math.hypot(next.ball.vx, next.ball.vy),
    spin: 0,
    offset: 0,
    rally: 1,
  }]);
});

test('an edge hit reports how far from the paddle center the ball struck', () => {
  const state = runningState({ ball: ball({ x: width / 2 + paddle.width / 2 - 2, y: playerPaddleY - radius - 2, vy: 360 }) });

  const next = advanceGame(state, step, idleInput, PLAIN);

  assert.equal(next.events[0].type, 'paddle-hit');
  assert.ok(next.events[0].offset > 0.9);
});

test('a ball crossing the opponent paddle bounces back down', () => {
  const state = runningState({ rally: 4, ball: ball({ y: opponentPaddleBottom + radius + 2, vy: -360 }) });

  const next = advanceGame(state, step, idleInput, PLAIN);

  assert.ok(next.ball.vy > 0);
  assert.equal(next.ball.y, opponentPaddleBottom + radius);
  assert.equal(next.events[0].side, 'opponent');
  assert.equal(next.rally, 5);
  assert.equal(next.hits.opponent, 1);
});

test('flicking the paddle as it meets the ball puts spin on the return', () => {
  const state = runningState({
    player: { x: width / 2, vx: 0 },
    ball: ball({ y: playerPaddleY - radius - 2, vy: 360 }),
  });

  // The paddle sweeps right through the ball over the step in which they meet.
  const next = advanceGame(state, step, { ...idleInput, pointerX: width / 2 + 8 }, PLAIN);

  assert.equal(next.events[0].type, 'paddle-hit');
  assert.ok(next.ball.spin > 0);
  assert.equal(next.events[0].spin, next.ball.spin);
});

test('bouncing off a side wall is reported', () => {
  const state = runningState({ ball: ball({ x: width - radius - 1, vx: 300, vy: -300 }) });

  const next = advanceGame(state, step, idleInput, PLAIN);

  assert.deepEqual(eventTypes(next), ['wall-bounce']);
  assert.ok(next.ball.vx < 0);
});

test('a player who tracks the ball sustains a long rally that exercises both paddles', () => {
  let state = runningState();
  let playerHits = 0;
  let opponentHits = 0;

  for (let i = 0; i < 20 / step; i += 1) {
    state = advanceGame(state, step, { ...idleInput, pointerX: state.ball.x }, PLAIN);

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
  assert.deepEqual(state.hits, { player: playerHits, opponent: opponentHits });
});

test('crossing the bottom boundary awards the opponent a point, resets the ball and the rally', () => {
  const state = runningState({ rally: 6, longestRally: 6, ball: ball({ x: 10, y: height + radius + 1, vy: 300 }) });

  const next = advanceGame(state, step, idleInput, PLAIN);

  assert.equal(next.score.opponent, 1);
  assert.equal(next.ball.x, width / 2);
  assert.equal(next.ball.y, height / 2);
  assert.equal(next.serveCountdown, PLAIN.serveDelaySeconds);
  assert.equal(next.rally, 0);
  assert.equal(next.longestRally, 6);
  assert.deepEqual(next.events, [{ type: 'point', scorer: 'opponent', x: 10, y: height }]);
});

test('a point is counted only once because the ball is reset immediately', () => {
  const state = runningState({ ball: ball({ x: 10, y: height + radius + 1, vy: 300 }) });

  const afterPoint = advanceGame(state, step, idleInput, PLAIN);
  const afterNextStep = advanceGame(afterPoint, step, idleInput, PLAIN);

  assert.equal(afterPoint.score.opponent, 1);
  assert.equal(afterNextStep.score.opponent, 1);
});

test('reaching one point from victory announces match point', () => {
  const winning = PLAIN.rules.winningScore;
  const state = runningState({
    score: { player: winning - 2, opponent: 0 },
    ball: ball({ x: 10, y: -radius - 1, vy: -300 }),
  });

  const next = advanceGame(state, step, idleInput, PLAIN);

  assert.deepEqual(eventTypes(next), ['point', 'match-point']);
  assert.deepEqual(next.events[1], { type: 'match-point', side: 'player' });
  assert.equal(matchPointSide(next, PLAIN), 'player');
  assert.equal(matchPointSide(runningState(), PLAIN), null);
});

test('winning point moves the state machine to game-over', () => {
  const state = runningState({
    score: { player: PLAIN.rules.winningScore - 1, opponent: 0 },
    ball: ball({ x: 10, y: -radius - 1, vy: -300, spin: 0.5 }),
  });

  const next = advanceGame(state, step, idleInput, PLAIN);

  assert.equal(next.score.player, PLAIN.rules.winningScore);
  assert.equal(next.phase, GAME_PHASE.GAME_OVER);
  assert.deepEqual({ vx: next.ball.vx, vy: next.ball.vy, spin: next.ball.spin }, { vx: 0, vy: 0, spin: 0 });
  assert.equal(next.serveCountdown, 0);
  assert.deepEqual(eventTypes(next), ['point', 'game-over']);
  assert.deepEqual(next.events[1], { type: 'game-over', winner: 'player' });
  assert.equal(matchPointSide(next, PLAIN), null);
});

test('serve after a player point travels back toward the player', () => {
  const state = runningState({ ball: ball({ x: 10, y: -radius - 1, vy: -300 }) });

  const next = advanceGame(state, step, idleInput, PLAIN);

  assert.equal(next.score.player, 1);
  assert.ok(next.ball.vy > 0);
  assert.deepEqual(next.events[0], { type: 'point', scorer: 'player', x: 10, y: 0 });
});

test('in Rush a miss costs a life and the last miss ends the run; the opponent never wins points', () => {
  const start = runningState({}, RUSH_CONFIG);
  assert.equal(start.lives, RUSH_CONFIG.rules.lives);

  const miss = (state) => advanceGame({ ...state, ball: ball({ x: 10, y: height + radius + 1, vy: 300 }) }, step, idleInput, RUSH_CONFIG);
  const afterFirst = miss(start);

  assert.equal(afterFirst.lives, RUSH_CONFIG.rules.lives - 1);
  assert.deepEqual(eventTypes(afterFirst), ['point', 'life-lost']);
  assert.equal(afterFirst.phase, GAME_PHASE.RUNNING);
  assert.equal(matchPointSide(afterFirst, RUSH_CONFIG), null);

  let state = afterFirst;
  while (state.lives > 0) {
    state = miss(state);
  }

  assert.equal(state.lives, 0);
  assert.equal(state.phase, GAME_PHASE.GAME_OVER);
  assert.equal(getWinner(state), 'opponent');
  assert.deepEqual(eventTypes(state), ['point', 'life-lost', 'game-over']);

  // The player scoring past the computer is not a win condition in Rush.
  const playerScores = advanceGame({ ...start, score: { player: 20, opponent: 0 }, ball: ball({ x: 10, y: -radius - 1, vy: -300 }) }, step, idleInput, RUSH_CONFIG);
  assert.equal(playerScores.phase, GAME_PHASE.RUNNING);
  assert.deepEqual(eventTypes(playerScores), ['point']);
});

test('with two players the top paddle follows the second person instead of the computer', () => {
  const state = runningState({}, TWO_PLAYER_CONFIG);
  const byPointer = advanceGame(state, step, { ...idleInput, opponentPointerX: 60 }, TWO_PLAYER_CONFIG);
  const byAxis = advanceGame(state, step, { ...idleInput, opponentAxis: -1 }, TWO_PLAYER_CONFIG);
  const idle = advanceGame({ ...state, ball: ball({ x: 60, y: 150, vy: -400 }) }, step, idleInput, TWO_PLAYER_CONFIG);

  assert.equal(byPointer.opponent.x, 60);
  assert.ok(Math.abs(byAxis.opponent.x - (width / 2 - paddle.keyboardSpeed * step)) < 1e-9);
  assert.equal(idle.opponent.x, width / 2);
});

test('serves alternate sides, so neither player always receives on the same side', () => {
  let state = runningState();
  const directions = [];

  for (let point = 0; point < 4; point += 1) {
    state = advanceGame({ ...state, serveCountdown: 0, ball: ball({ x: 10, y: -radius - 1, vy: -300 }) }, step, idleInput, PLAIN);
    directions.push(Math.sign(state.ball.vx));
  }

  assert.deepEqual(directions, [-1, 1, -1, 1]);
});

test('the longest rally is kept when a shorter one follows', () => {
  const state = runningState({ rally: 2, longestRally: 9, ball: ball({ x: width / 2, y: playerPaddleY - radius - 2, vy: 400 }) });
  const next = advanceGame(state, step, { ...idleInput, pointerX: width / 2 }, PLAIN);

  assert.equal(next.rally, 3);
  assert.equal(next.longestRally, 9);
});

test('a point is scored only once the whole ball has left the court', () => {
  const leaving = runningState({ ball: ball({ x: 10, y: height + radius / 2, vy: 1 }) });

  assert.equal(advanceGame(leaving, step, idleInput, PLAIN).score.opponent, 0);
});

test('a ball overlapping a front corner but sliding away from it is eased out without a hit', () => {
  // Its center sits inside the rounded corner, and it moves off sideways faster than it falls.
  const corner = { x: width / 2 + paddle.width / 2, y: playerPaddleY };
  const state = runningState({ ball: ball({ x: corner.x + 5, y: corner.y - 5, vx: 600, vy: 100 }) });
  const next = advanceGame(state, step, { ...idleInput, pointerX: width / 2 }, PLAIN);

  assert.equal(next.events.some((event) => event.type === 'paddle-hit'), false);
  assert.ok(next.ball.vy > 0, 'still falling toward the goal line');
  assert.ok(Math.hypot(next.ball.x - corner.x, next.ball.y - corner.y) >= radius - 1e-9, 'clear of the corner');
});
