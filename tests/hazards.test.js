import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG, tuned } from '../src/config.js';
import { advanceGame, createInitialState, startGame } from '../src/domain/game.js';
import { BEAM_HALF_WIDTH, BEAM_SECONDS, bossAttacks, bossPhase, DRIP_RADIUS, initialHazardState, isFinalBoss, NO_HAZARDS, tickHazards } from '../src/domain/hazards.js';
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

// A final boss borrows the other bosses' attacks, one phase after another as the player closes
// in on winning, and in the last phase draws from all of them.
const PHASED = bossConfig('drip', { phases: [['drip'], ['beam'], ['lag'], ['drip', 'beam', 'lag']] });

test('a final boss moves through its phases as the player closes in on winning', () => {
  const phases = [0, 1, 2, 3, 4, 5, 6].map((player) => bossPhase({ player, opponent: 5 }, PHASED));

  assert.deepEqual(phases, [0, 0, 1, 1, 2, 2, 3], 'an even share of the seven points for each of four phases');
  assert.equal(bossPhase({ player: 6, opponent: 0 }, DRIPS), 0, 'a boss without phases stays in its first');
  assert.equal(bossPhase({ player: 6, opponent: 0 }, GAME_CONFIG), 0);
});

test('a final boss is the one with phases, whose attacks change with them', () => {
  const score = (player) => ({ player, opponent: 0 });

  assert.equal(isFinalBoss(PHASED), true);
  assert.equal(isFinalBoss(DRIPS), false);
  assert.equal(isFinalBoss(GAME_CONFIG), false);
  assert.deepEqual(bossAttacks(score(2), PHASED), ['beam']);
  assert.deepEqual(bossAttacks(score(6), PHASED), ['drip', 'beam', 'lag']);
  assert.deepEqual(bossAttacks(score(6), BEAMS), ['beam'], 'any other boss has its one attack');
  assert.deepEqual(bossAttacks(score(6), GAME_CONFIG), [], 'and a match without a boss none');
});

test('a final boss attacks with its phase\'s attack, and draws one from a phase with several', () => {
  const kindAt = (player, seed = 11) => {
    const events = [];
    tickHazards(fighting(PHASED, { attackIn: 0, seed, score: { player, opponent: 0 } }), step, PHASED, events);
    return events.find((event) => event.type === 'hazard-warn').kind;
  };

  assert.deepEqual([0, 1, 2, 3, 4, 5].map((player) => kindAt(player)), ['drip', 'drip', 'beam', 'beam', 'lag', 'lag']);

  const drawn = new Set(Array.from({ length: 40 }, (_, seed) => kindAt(6, seed + 1)));
  assert.deepEqual([...drawn].sort(), ['beam', 'drip', 'lag'], 'at match point it may attack with any of them');
});

test('only a choice of attacks draws from the random source, so a boss with one plays as ever', () => {
  const single = tickHazards(fighting(DRIPS, { attackIn: 0 }), step, DRIPS, []);
  const phased = tickHazards(fighting(PHASED, { attackIn: 0 }), step, PHASED, []);

  assert.deepEqual(phased.hazards, single.hazards);
  assert.equal(phased.seed, single.seed);
});

test('the point that moves a final boss on announces its next phase, and only that point', () => {
  const pastTheBoss = { x: width / 2, y: -ballConfig.radius - 1, vx: 0, vy: -300, spin: 0 };
  const pastThePlayer = { x: width / 2, y: height + ballConfig.radius + 1, vx: 0, vy: 300, spin: 0 };
  const phaseEvents = (config, score, ball) => advanceGame(fighting(config, { score, ball }), step, idle, config)
    .events.filter((event) => event.type === 'boss-phase');

  assert.deepEqual(phaseEvents(PHASED, { player: 1, opponent: 0 }, pastTheBoss), [{ type: 'boss-phase', phase: 1 }]);
  assert.deepEqual(phaseEvents(PHASED, { player: 5, opponent: 3 }, pastTheBoss), [{ type: 'boss-phase', phase: 3 }]);
  assert.deepEqual(phaseEvents(PHASED, { player: 2, opponent: 0 }, pastTheBoss), [], 'within a phase');
  assert.deepEqual(phaseEvents(PHASED, { player: 1, opponent: 0 }, pastThePlayer), [], 'the boss\'s own points');
  assert.deepEqual(phaseEvents(DRIPS, { player: 1, opponent: 0 }, pastTheBoss), [], 'a boss without phases');
  assert.deepEqual(phaseEvents(PHASED, { player: 6, opponent: 0 }, pastTheBoss), [], 'the winning point ends the match instead');
});
