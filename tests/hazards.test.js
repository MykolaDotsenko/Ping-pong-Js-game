import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG, tuned } from '../src/config.js';
import { advanceGame, createInitialState, startGame } from '../src/domain/game.js';
import { BEAM_HALF_WIDTH, BEAM_SECONDS, DRIP_RADIUS, initialHazardState, NO_HAZARDS, tickHazards } from '../src/domain/hazards.js';
import { NO_MODIFIERS, paddleWidth } from '../src/domain/power-ups.js';

// A career boss attacks the player's end of the court: drips fall, a beam strikes a column,
// lag blurs the view. Each is announced, and a hit only shrinks the paddle for a while.

const { width, height, paddle, ball: ballConfig } = GAME_CONFIG;
const step = GAME_CONFIG.fixedStepSeconds;
const idle = Object.freeze({ horizontalAxis: 0, pointerX: null, opponentAxis: 0, opponentPointerX: null });
const bossConfig = (attack, overrides = {}) => tuned(GAME_CONFIG, {
  powerUps: { enabled: false },
  boss: { attack, every: [2, 3], warning: 1, shrinkSeconds: 3, lagSeconds: 2.5, ...overrides },
});
const DRIPS = bossConfig('drip');
const BEAMS = bossConfig('beam');
const LAG = bossConfig('lag');
const paddleTop = height - paddle.inset - paddle.height;

/** A boss match past the countdown, the ball high in the court on its way up. */
function fighting(config, overrides = {}) {
  return {
    ...startGame(createInitialState(config, 11), config),
    serveCountdown: 0,
    ball: { x: width / 2, y: 300, vx: 0, vy: -200, spin: 0 },
    attackIn: 99,
    ...overrides,
  };
}

const tick = (state, config) => tickHazards(state, step, config, []);

test('without a boss nothing is drawn from the random source and nothing ever attacks', () => {
  assert.deepEqual(initialHazardState(42, GAME_CONFIG), { hazards: NO_HAZARDS, attackIn: 0, seed: 42 });

  const state = fighting(GAME_CONFIG, { attackIn: 0 });
  assert.strictEqual(tickHazards(state, step, GAME_CONFIG, []), state);
});

test('a boss first attacks a few seconds in, and the next attack waits for the last to end', () => {
  const start = createInitialState(DRIPS, 11);
  assert.ok(start.attackIn >= 2 && start.attackIn <= 3);
  assert.notEqual(start.seed, createInitialState(GAME_CONFIG, 11).seed, 'the schedule is drawn from the seed');

  const events = [];
  let state = fighting(DRIPS, { attackIn: step / 2 });
  state = tickHazards(state, step, DRIPS, events);

  assert.deepEqual(events.map((event) => event.type), ['hazard-warn']);
  assert.equal(state.hazards.length, 3);
  assert.ok(state.attackIn >= 2 && state.attackIn <= 3);

  const waiting = tick(state, DRIPS).attackIn;
  assert.equal(waiting, state.attackIn, 'no countdown while drips are falling');
});

test('drips fall one into each third of the court, and one of them at the player', () => {
  for (const playerX of [60, width / 2, width - 60]) {
    const events = [];
    const state = tickHazards(fighting(DRIPS, { attackIn: 0, player: { x: playerX, vx: 0 } }), step, DRIPS, events);
    const lanes = state.hazards.map((drip) => Math.floor(drip.x / (width / 3)));

    assert.deepEqual(lanes.sort(), [0, 1, 2]);
    assert.ok(state.hazards.some((drip) => Math.abs(drip.x - playerX) <= 24 + 1e-9));
    assert.ok(state.hazards.every((drip) => drip.x >= DRIP_RADIUS && drip.x <= width - DRIP_RADIUS));
    assert.equal(events[0].kind, 'drip');
  }
});

test('a drip that lands on the player\'s paddle shrinks it for a while', () => {
  const drip = { kind: 'drip', x: width / 2, y: paddleTop - DRIP_RADIUS - 1, warn: 0, ttl: 0 };
  const events = [];
  const state = tickHazards(fighting(DRIPS, { hazards: [drip] }), step, DRIPS, events);

  assert.deepEqual(events.map(({ type, kind }) => [type, kind]), [['hazard-hit', 'drip']]);
  assert.equal(state.modifiers.player.tiny, 3);
  assert.equal(paddleWidth(state, 'player', DRIPS), paddle.width * DRIPS.powerUps.shrinkScale);
  assert.deepEqual(state.modifiers.opponent, NO_MODIFIERS, 'the boss is never hurt');
});

test('a drip that misses falls past the paddle and is gone', () => {
  let state = fighting(DRIPS, { hazards: [{ kind: 'drip', x: 20, y: paddleTop - 40, warn: 0, ttl: 0 }] });

  for (let i = 0; i < 60 && state.hazards.length > 0; i += 1) {
    state = tick(state, DRIPS);
  }

  assert.strictEqual(state.hazards, NO_HAZARDS);
  assert.equal(state.modifiers.player.tiny, 0);
});

test('a beam is announced, then strikes a paddle standing in its column', () => {
  const events = [];
  let state = tickHazards(fighting(BEAMS, { attackIn: 0 }), step, BEAMS, events);
  const [beam] = state.hazards;

  assert.equal(beam.kind, 'beam');
  assert.ok(Math.abs(beam.x - width / 2) <= 40 + 1e-9, 'aimed near the player');
  assert.equal(events[0].kind, 'beam');

  // Nothing happens during the warning, however long the player stands there; then it strikes.
  const struck = [];
  let elapsed = 0;

  while (struck.length === 0 && elapsed < 2) {
    state = tickHazards(state, step, BEAMS, struck);
    elapsed += step;
  }

  assert.ok(elapsed > 1 - step / 2 && elapsed < 1 + 2 * step, `struck after ${elapsed} s`);
  assert.deepEqual(struck.map((event) => event.type), ['hazard-hit']);
  assert.equal(state.modifiers.player.tiny, 3);
  assert.strictEqual(state.hazards, NO_HAZARDS, 'a beam hits once');
});

test('a beam misses a paddle out of its column, and burns out', () => {
  const beam = { kind: 'beam', x: width - BEAM_HALF_WIDTH, y: height / 2, warn: 0, ttl: BEAM_SECONDS };
  let state = fighting(BEAMS, { player: { x: 60, vx: 0 }, hazards: [beam] });
  let steps = 0;

  while (state.hazards.length > 0 && steps < 200) {
    state = tick(state, BEAMS);
    steps += 1;
  }

  assert.equal(state.modifiers.player.tiny, 0);
  assert.ok(Math.abs(steps * step - BEAM_SECONDS) < step * 1.5);
});

test('lag is announced, then makes the player see the balls in fits and starts', () => {
  const events = [];
  let state = tickHazards(fighting(LAG, { attackIn: 0 }), step, LAG, events);
  assert.deepEqual(events.map(({ type, kind }) => [type, kind]), [['hazard-warn', 'lag']]);

  const hits = [];
  for (let t = 0; t < 1 + step; t += step) {
    state = tickHazards(state, step, LAG, hits);
  }

  assert.deepEqual(hits.map(({ type, kind }) => [type, kind]), [['hazard-hit', 'lag']]);
  assert.ok(state.modifiers.player.lag > 2.4 && state.modifiers.player.lag <= 2.5);
  assert.equal(state.modifiers.player.tiny, 0);
});

test('an attack\'s effect wears off like a power-up\'s, through serve pauses too', () => {
  const lagging = fighting(LAG, {
    serveCountdown: GAME_CONFIG.serveDelaySeconds,
    modifiers: { player: { ...NO_MODIFIERS, lag: 1 }, opponent: NO_MODIFIERS },
  });

  const next = advanceGame(lagging, step, idle, LAG);
  assert.ok(Math.abs(next.modifiers.player.lag - (1 - step)) < 1e-9);
});

test('a point ends an attack under way, and the next comes on schedule', () => {
  const drip = { kind: 'drip', x: 30, y: 200, warn: 0, ttl: 0 };
  const scoring = fighting(DRIPS, {
    attackIn: 1.5,
    hazards: [drip],
    ball: { x: width / 2, y: height + ballConfig.radius + 1, vx: 0, vy: 300, spin: 0 },
  });
  const next = advanceGame(scoring, step, idle, DRIPS);

  assert.equal(next.score.opponent, 1);
  assert.strictEqual(next.hazards, NO_HAZARDS);
  assert.equal(next.attackIn, 1.5);
});

test('attacks come only in live play, never while the ball waits to be served', () => {
  const waiting = fighting(DRIPS, { serveCountdown: 0.5, attackIn: step / 2 });
  const next = advanceGame(waiting, step, idle, DRIPS);

  assert.strictEqual(next.hazards, NO_HAZARDS);
  assert.equal(next.attackIn, step / 2);
});
