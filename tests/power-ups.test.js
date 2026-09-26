import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../src/config.js';
import { advanceGame, createInitialState, startGame } from '../src/domain/game.js';
import { calculateOpponentTarget } from '../src/domain/opponent.js';
import { NO_MODIFIERS, paddleWidth, POWER_UP_KINDS } from '../src/domain/power-ups.js';

const { width, height, paddle, ball: ballConfig } = GAME_CONFIG;
const { powerUps } = GAME_CONFIG;
const step = GAME_CONFIG.fixedStepSeconds;
const idleInput = Object.freeze({ horizontalAxis: 0, pointerX: null, opponentAxis: 0, opponentPointerX: null });
const ball = (overrides) => ({ x: width / 2, y: height / 2, vx: 0, vy: 0, spin: 0, ...overrides });

// A running match past the countdown, with the ball crossing the court so pickups can appear.
function rallying(overrides = {}) {
  return {
    ...startGame(createInitialState(GAME_CONFIG, 3), GAME_CONFIG),
    serveCountdown: 0,
    rally: powerUps.minRally,
    ball: ball({ vy: -300 }),
    ...overrides,
  };
}

// A pickup right in the ball's path, so the next step collects it.
const PICKUP_Y = height / 2 - 20;

function withPickup(kind, overrides = {}) {
  return rallying({
    pickups: [{ id: 1, kind, x: width / 2, y: PICKUP_Y, ttl: 5 }],
    ...overrides,
  });
}

const collect = (state) => advanceGame(state, step, idleInput, GAME_CONFIG);

test('a power-up appears once the schedule and the rally allow it, and vanishes when ignored', () => {
  let state = rallying({ nextPickupIn: 0.05, ball: ball({ x: 30, y: 30, vx: 0, vy: 300 }) });
  const spawned = [];

  // Bounce the ball along the left wall, away from where pickups appear.
  for (let elapsed = 0; elapsed < powerUps.lifetime + 1; elapsed += step) {
    state = advanceGame(state, step, { ...idleInput, pointerX: 30 }, GAME_CONFIG);
    spawned.push(...state.events.filter((event) => event.type === 'pickup-spawn'));

    if (state.rally < powerUps.minRally) state = { ...state, rally: powerUps.minRally };
    if (state.score.player + state.score.opponent > 0) state = { ...state, score: { player: 0, opponent: 0 } };
    if (spawned.length === 1 && state.pickups.length === 0) break;
  }

  assert.equal(spawned.length, 1);
  assert.ok(POWER_UP_KINDS.includes(spawned[0].kind));
  assert.ok(spawned[0].x > width * 0.1 && spawned[0].x < width * 0.9);
  assert.ok(spawned[0].y > height * 0.3 && spawned[0].y < height * 0.7);
  assert.equal(state.pickups.length, 0);
});

test('a power-up can appear from exactly the minimum rally on', () => {
  const next = advanceGame(rallying({ nextPickupIn: 0, rally: powerUps.minRally }), step, idleInput, GAME_CONFIG);

  assert.deepEqual(next.events.map((event) => event.type), ['pickup-spawn']);
});

test('only one power-up waits on the court at a time', () => {
  const waiting = { id: 1, kind: 'wide', x: 60, y: 400, ttl: 5 };
  const next = advanceGame(rallying({ nextPickupIn: 0, rally: 20, pickups: [waiting] }), step, idleInput, GAME_CONFIG);

  assert.equal(next.pickups.length, 1);
  assert.equal(next.events.some((event) => event.type === 'pickup-spawn'), false);
});

test('every kind of power-up turns up', () => {
  const seen = new Set();

  for (let seed = 1; seed <= 200 && seen.size < POWER_UP_KINDS.length; seed += 1) {
    const next = advanceGame(rallying({ nextPickupIn: 0, seed }), step, idleInput, GAME_CONFIG);
    seen.add(next.pickups[0].kind);
  }

  assert.deepEqual([...seen].sort(), [...POWER_UP_KINDS].sort());
});

test('no power-up appears before the rally is long enough, or when they are switched off', () => {
  const tooEarly = advanceGame(rallying({ nextPickupIn: 0, rally: 0 }), step, idleInput, GAME_CONFIG);
  const disabled = { ...GAME_CONFIG, powerUps: { ...powerUps, enabled: false } };
  const off = advanceGame(rallying({ nextPickupIn: 0 }), step, idleInput, disabled);

  assert.equal(tooEarly.pickups.length, 0);
  assert.equal(off.pickups.length, 0);
});

test('Wide enlarges the paddle of whoever hit the ball last, for a while', () => {
  const collected = collect(withPickup('wide'));

  assert.deepEqual(collected.events, [{ type: 'pickup', kind: 'wide', side: 'player', x: width / 2, y: PICKUP_Y }]);
  assert.equal(collected.pickups.length, 0);
  assert.equal(collected.modifiers.player.wide, powerUps.duration);
  assert.equal(paddleWidth(collected, 'player', GAME_CONFIG), paddle.width * powerUps.wideScale);
  assert.equal(paddleWidth(collected, 'opponent', GAME_CONFIG), paddle.width);

  // Run the clock out with spawning off and the court cleared, so no other pickup can refresh the timer.
  const quiet = { ...GAME_CONFIG, powerUps: { ...powerUps, enabled: false } };
  let state = { ...collected, pickups: [] };
  for (let elapsed = 0; elapsed < powerUps.duration + 0.1; elapsed += step) {
    state = advanceGame(state, step, idleInput, quiet);
  }

  assert.deepEqual(state.modifiers.player, NO_MODIFIERS);
});

test('an effect keeps wearing off during the serve pause', () => {
  const state = {
    ...rallying({ serveCountdown: GAME_CONFIG.serveDelaySeconds }),
    modifiers: { player: { ...NO_MODIFIERS, wide: 1 }, opponent: NO_MODIFIERS },
  };

  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.ok(next.serveCountdown > 0);
  assert.ok(Math.abs(next.modifiers.player.wide - (1 - step)) < 1e-9);
});

test('Shrink shrinks the other side, and Ghost blinds it', () => {
  const shrunk = collect(withPickup('shrink'));
  const ghosted = collect(withPickup('ghost', { ball: ball({ vy: 300 }) }));

  assert.equal(shrunk.modifiers.opponent.tiny, powerUps.duration);
  assert.equal(paddleWidth(shrunk, 'opponent', GAME_CONFIG), paddle.width * powerUps.shrinkScale);
  assert.equal(ghosted.events[0].side, 'opponent');
  assert.equal(ghosted.modifiers.player.ghost, powerUps.duration);
});

test('Turbo launches the ball at turbo speed in the same direction', () => {
  const before = withPickup('turbo', { ball: ball({ vx: 90, vy: -300 }) });
  const collected = collect(before);
  const speed = Math.hypot(collected.ball.vx, collected.ball.vy);

  assert.ok(Math.abs(speed - powerUps.turboSpeed) < 1e-6);
  assert.ok(Math.abs(collected.ball.vx / collected.ball.vy - before.ball.vx / before.ball.vy) < 1e-9);
  assert.equal(collected.turbo, powerUps.duration);
});

test('Turbo is one shot: the return comes back at normal speed and the Turbo look ends with it', () => {
  // A Turbo ball arrives at the computer, which returns it.
  const turboShot = rallying({
    turbo: powerUps.duration - 0.3,
    opponent: { x: width / 2, vx: 0 },
    ball: ball({ y: paddle.inset + paddle.height + ballConfig.radius + 4, vy: -powerUps.turboSpeed }),
    nextPickupIn: 999,
  });
  const returned = collect(turboShot);

  assert.equal(returned.events[0].type, 'paddle-hit');
  assert.ok(Math.hypot(returned.ball.vx, returned.ball.vy) <= ballConfig.maxSpeed + 1e-9);
  assert.equal(returned.turbo, 0);
});

test('a ghosted computer cannot see the ball and drifts to the center', () => {
  const state = {
    ...rallying({ opponent: { x: 400, vx: 0 }, ball: ball({ x: 80, y: 150, vy: -400 }) }),
    modifiers: { player: NO_MODIFIERS, opponent: { ...NO_MODIFIERS, ghost: 3 } },
  };

  assert.equal(calculateOpponentTarget(state, GAME_CONFIG), width / 2);
});

test('a wide paddle catches balls a normal one would miss', () => {
  const edgeX = width / 2 + paddle.width / 2 + 15;
  const incoming = rallying({ ball: ball({ x: edgeX, y: height - paddle.inset - paddle.height - ballConfig.radius - 2, vy: 400 }) });
  const wide = { ...incoming, modifiers: { player: { ...NO_MODIFIERS, wide: 5 }, opponent: NO_MODIFIERS } };

  const missed = advanceGame(incoming, step, idleInput, GAME_CONFIG);
  const caught = advanceGame(wide, step, idleInput, GAME_CONFIG);

  assert.equal(missed.events.length, 0);
  assert.equal(caught.events[0]?.type, 'paddle-hit');
});

test('a point clears the court of power-ups and turbo', () => {
  const state = withPickup('wide', { turbo: 2, ball: ball({ x: 10, y: height + ballConfig.radius + 1, vy: 300 }) });
  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.equal(next.pickups.length, 0);
  assert.equal(next.turbo, 0);
});

test('the match-winning point clears the court of power-ups too', () => {
  const state = rallying({
    score: { player: GAME_CONFIG.rules.winningScore - 1, opponent: 0 },
    pickups: [{ id: 1, kind: 'ghost', x: 60, y: 400, ttl: 5 }],
    ball: ball({ x: 10, y: -ballConfig.radius - 1, vy: -300 }),
  });
  const next = advanceGame(state, step, idleInput, GAME_CONFIG);

  assert.equal(next.phase, 'game-over');
  assert.deepEqual(next.pickups, []);
});
