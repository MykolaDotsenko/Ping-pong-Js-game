import test from 'node:test';
import assert from 'node:assert/strict';

import { calloutFor, CURVE_SPIN, EDGE_OFFSET, finish, LAST_WORD, playEvents, TAUNTS } from '../src/adapters/canvas/event-effects.js';
import { SUPER_STYLE, THEME } from '../src/adapters/canvas/theme.js';
import { Effects } from '../src/adapters/effects.js';
import { COMIC_TITLES, FINISHER_KINDS, FINISHER_SECONDS, finisherFor, SUPER_FINISHERS } from '../src/adapters/finisher.js';
import { RIVALS } from '../src/catalog.js';
import { GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG } from '../src/config.js';
import { createInitialState, GAME_PHASE } from '../src/domain/game.js';

const { width, height, ball } = GAME_CONFIG;
const context = { config: GAME_CONFIG, random: () => 0.5 };

function play(events, effects = new Effects({ random: () => 0.5 })) {
  playEvents(effects, events, context);
  return effects;
}

const hit = (overrides = {}) => ({ type: 'paddle-hit', side: 'player', x: 250, y: 734, speed: ball.initialSpeed, spin: 0, offset: 0, rally: 1, ...overrides });

test('every game event the board shows leaves something on it', () => {
  const events = [
    { type: 'match-start' },
    { type: 'countdown', value: 3 },
    { type: 'serve', x: 250, y: 400 },
    hit(),
    { type: 'paddle-graze', side: 'opponent', x: 310, y: 50, speed: 600 },
    { type: 'wall-bounce', x: 10, y: 300, speed: 500 },
    { type: 'wall-bounce', x: 490, y: 300, speed: 500 },
    { type: 'pickup-spawn', kind: 'wide', x: 200, y: 400 },
    { type: 'pickup', kind: 'turbo', side: 'player', x: 200, y: 400 },
    { type: 'point', scorer: 'opponent', x: 250, y: height },
    { type: 'point', scorer: 'player', x: 250, y: 0 },
    { type: 'match-point', side: 'player' },
    { type: 'life-lost', lives: 2 },
  ];

  for (const event of events) {
    const effects = play([event]);
    assert.ok(effects.active, event.type);
  }
});

test('events the board does not show leave it untouched', () => {
  const effects = play([{ type: 'paused' }, { type: 'resumed' }, { type: 'menu' }]);

  assert.equal(effects.active, false);
});

test('a new match wipes the old effects before its own opening ring', () => {
  const effects = play([{ type: 'point', scorer: 'player', x: 250, y: 0 }]);
  play([{ type: 'match-start' }], effects);

  assert.equal(effects.particles.length, 0);
  assert.equal(effects.rings.length, 1);
});

test('a serve clears the last callout', () => {
  const effects = play([{ type: 'match-point', side: 'player' }]);
  play([{ type: 'serve', x: width / 2, y: height / 2 }], effects);

  assert.deepEqual(effects.labels, []);
});

test('a skilful hit earns one callout: a curve beats a smash, which beats a catch at the edge', () => {
  const smash = hit({ speed: ball.maxSpeed });

  assert.deepEqual(calloutFor(hit({ spin: CURVE_SPIN, speed: ball.maxSpeed, offset: 1 }), GAME_CONFIG), { text: 'CURVE!', rgb: THEME.lime });
  assert.deepEqual(calloutFor({ ...smash, offset: 1 }, GAME_CONFIG), { text: 'SMASH!', rgb: THEME.amber });
  assert.deepEqual(calloutFor(hit({ offset: -EDGE_OFFSET }), GAME_CONFIG), { text: 'EDGE!', rgb: THEME.rose });
  assert.equal(calloutFor(hit(), GAME_CONFIG), null);

  assert.equal(play([hit({ offset: 1 })]).labels[0].text, 'EDGE!');
  assert.equal(play([hit()]).labels.length, 0);
});

test('the callout floats on the court side of the paddle that hit', () => {
  const player = play([hit({ offset: 1 })]).labels[0];
  const opponent = play([hit({ side: 'opponent', y: 66, offset: 1 })]).labels[0];

  assert.ok(player.y < 734);
  assert.ok(opponent.y > 66);
});

test('every fifth hit of a rally pulses the whole court, but a Multiball ball\'s return does not', () => {
  const ordinary = play([hit({ rally: 4 })]);
  const milestone = play([hit({ rally: 5 })]);
  const extra = play([hit({ rally: 5, extra: true })]);

  assert.equal(milestone.rings.length, ordinary.rings.length + 1);
  assert.equal(extra.rings.length, ordinary.rings.length, 'it keeps its sparks, but is no fifth hit');
});

test('a Multiball power-up announces itself in its own color', () => {
  const effects = play([{ type: 'pickup', kind: 'multi', side: 'player', x: 200, y: 400 }]);

  assert.equal(effects.labels[0].text, 'MULTIBALL');
  assert.equal(effects.labels[0].color, `rgb(${THEME.lime})`);
});

test('the winner gets fireworks in their colors, spread over time and placed by the random source', () => {
  const draws = [];
  const effects = new Effects({ random: () => 0.5 });
  playEvents(effects, [{ type: 'game-over', winner: 'player' }], {
    config: GAME_CONFIG,
    random: () => {
      draws.push(true);
      return 0.25;
    },
  });

  assert.equal(effects.scheduled.length, 7);
  const colors = new Set();

  for (let elapsed = 0; elapsed < 3; elapsed += 0.1) {
    effects.update(0.1);
    effects.particles.forEach((particle) => colors.add(particle.color));
  }

  assert.equal(draws.length, 14, 'x and y for each of the seven bursts');
  assert.ok(colors.has(`rgb(${THEME.side.player.rgb})`));
  assert.ok(colors.has(`rgb(${THEME.amber})`));
});

test('a curve earns its callout whichever way it bends', () => {
  assert.deepEqual(calloutFor(hit({ spin: -CURVE_SPIN }), GAME_CONFIG), { text: 'CURVE!', rgb: THEME.lime });
});

test('the sparks of a point spray into the court, away from the goal line', () => {
  const atTop = play([{ type: 'point', scorer: 'player', x: 250, y: 0 }]);
  const atBottom = play([{ type: 'point', scorer: 'opponent', x: 250, y: height }]);

  assert.ok(atTop.particles.every((particle) => particle.vy > 0), 'down from the top goal');
  assert.ok(atBottom.particles.every((particle) => particle.vy < 0), 'up from the bottom goal');
});

/** The first match seed whose finisher, for the player's win, passes the test. */
function seedFor(test) {
  for (let seed = 0; ; seed += 1) {
    const finisher = finisherFor({ winner: 'player', twoPlayers: false, rush: false, jokes: true, seed });
    if (finisher && test(finisher)) return seed;
  }
}

const SHATTER = seedFor((finisher) => finisher.kind === 'shatter');
const over = (seed = SHATTER, score = { player: 7, opponent: 3 }) => ({
  ...createInitialState(GAME_CONFIG, 1),
  seed,
  score,
  phase: 'game-over',
  opponent: { x: 250, vx: 0 },
  player: { x: 120, vx: 0 },
});
const finished = (winner, { config = GAME_CONFIG, jokes = true, seed = SHATTER, event = {}, score } = {}) => {
  const effects = new Effects({ random: () => 0.5 });
  playEvents(effects, [{ type: 'game-over', winner, ...event }], { config, random: () => 0.5, jokes, state: over(seed, score) });
  return effects;
};

test('with the fun extras on, the player\'s win destroys the computer\'s paddle under a red callout', () => {
  const effects = finished('player');

  assert.equal(effects.hiddenPaddle, 'opponent');
  assert.equal(effects.labels[0].text, 'PONGALITY');
  assert.equal(effects.labels[0].color, `rgb(${THEME.red})`);
  assert.ok(effects.shards.length > 0 || effects.particles.length > 50, 'the paddle comes apart');
  assert.equal(effects.scheduled.length, 1, 'the fireworks wait for the finisher');

  effects.update(0.6);
  assert.equal(effects.scheduled.length, 7, 'then they are on their way');
});

/** Plays one finisher to its end and records what the board showed along the way. */
function playFinisher(kind, { loser = 'opponent', superKind = null, perfect = false } = {}) {
  const effects = new Effects({ random: () => 0.5 });
  const state = over();
  const title = COMIC_TITLES[kind] ?? 'PONGALITY';
  const paddle = { x: state[loser].x, y: loser === 'player' ? 752 : 48 };
  const frames = [];
  let nearPaddle = false;

  finish(effects, { kind, loser, title, super: superKind, perfect }, state, GAME_CONFIG);

  for (let elapsed = 0; elapsed <= FINISHER_SECONDS + 1e-9; elapsed += 0.05) {
    frames.push(`${effects.shards.length}/${effects.bolts.length}/${effects.particles.length}/${effects.rings.length}/${effects.labels.length}`);
    nearPaddle ||= [...effects.shards, ...effects.particles, ...effects.rings]
      .some((thing) => Math.abs(thing.x - paddle.x) < 70 && Math.abs(thing.y - paddle.y) < 70);
    effects.update(0.05);
  }

  return { effects, signature: frames.join(' '), nearPaddle };
}

test('every kind of finisher comes apart in its own way, at the loser\'s paddle, within the agreed time', () => {
  const signatures = new Map();

  for (const kind of FINISHER_KINDS) {
    const { effects, signature, nearPaddle } = playFinisher(kind);

    assert.equal(effects.hiddenPaddle, 'opponent', `${kind} takes the paddle`);
    assert.ok(nearPaddle, `${kind} happens at the paddle`);
    assert.ok(!signatures.has(signature), `${kind} looks like ${signatures.get(signature)}`);
    signatures.set(signature, kind);
    assert.equal(effects.scheduled.length, 0, `${kind} is over within ${FINISHER_SECONDS} s`);
  }
});

test('a launched paddle leaves the court by its own end', () => {
  for (const [loser, direction] of [['opponent', -1], ['player', 1]]) {
    const effects = new Effects({ random: () => 0.5 });
    finish(effects, { kind: 'launch', loser, title: 'PONGALITY', super: null, perfect: false }, over(), GAME_CONFIG);

    assert.equal(effects.shards.length, 1);
    assert.equal(Math.sign(effects.shards[0].vy), direction, loser);
  }
});

test('a meteor lands before the paddle goes, and the ice holds before it shatters', () => {
  const meteor = new Effects({ random: () => 0.5 });
  finish(meteor, { kind: 'meteor', loser: 'opponent', title: 'PONGALITY', super: null, perfect: false }, over(), GAME_CONFIG);
  assert.equal(meteor.hiddenPaddle, null, 'the paddle is still there as the rock comes in');
  meteor.update(0.31);
  assert.equal(meteor.hiddenPaddle, 'opponent');

  const freeze = new Effects({ random: () => 0.5 });
  finish(freeze, { kind: 'freeze', loser: 'opponent', title: 'PONGALITY', super: null, perfect: false }, over(), GAME_CONFIG);
  assert.equal(freeze.shards.length, 1, 'one block of ice');
  freeze.update(0.46);
  assert.ok(freeze.shards.length > 1, 'then its pieces');
});

test('a match won with a super ends in its own finisher, under SUPER in its color', () => {
  for (const [superKind, kind] of Object.entries(SUPER_FINISHERS)) {
    const effects = finished('player', { event: { super: superKind } });
    const expected = playFinisher(kind, { superKind }).effects;

    assert.deepEqual(effects.labels.map((label) => label.text), ['PONGALITY', 'SUPER']);
    assert.equal(effects.labels[1].color, `rgb(${SUPER_STYLE[superKind].rgb})`);
    assert.equal(expected.hiddenPaddle, 'opponent');
  }

  const bolts = new Effects({ random: () => 0.5 });
  finish(bolts, { kind: 'electrocute', loser: 'opponent', title: 'PONGALITY', super: 'thunder', perfect: false }, over(), GAME_CONFIG);
  bolts.update(0.2);
  assert.equal(bolts.bolts.length, 3, 'three bolts of lightning');
});

test('the comic finishers go by their own titles in amber, each with an aside by the paddle', () => {
  const tiny = finished('player', { seed: seedFor((finisher) => finisher.kind === 'tiny') });
  const snooze = finished('player', { seed: seedFor((finisher) => finisher.kind === 'snooze') });

  assert.deepEqual(tiny.labels.map((label) => label.text), ['TINYALITY']);
  assert.equal(tiny.labels[0].color, `rgb(${THEME.amber})`);
  tiny.update(0.4);
  assert.deepEqual(tiny.labels.map((label) => label.text), ['TINYALITY', 'WAAAH!']);
  assert.ok(tiny.labels[1].y > 48, 'on the court, by the top paddle');

  assert.deepEqual(snooze.labels.map((label) => label.text), ['SNOOZALITY', 'Zzz']);
});

test('a win to nil is PERFECT!, a moment after the title', () => {
  const perfect = finished('player', { score: { player: 7, opponent: 0 } });

  assert.deepEqual(perfect.labels.map((label) => label.text), ['PONGALITY']);
  perfect.update(0.31);
  assert.deepEqual(perfect.labels.map((label) => label.text), ['PONGALITY', 'PERFECT!']);
  assert.ok(perfect.labels[1].y > perfect.labels[0].y);
  assert.ok(perfect.labels[1].life <= FINISHER_SECONDS - 0.3);

  const close = finished('player', { score: { player: 7, opponent: 6 } });
  close.update(0.31);
  assert.deepEqual(close.labels.map((label) => label.text), ['PONGALITY']);
});

test('between two people the winner finishes the other, and the bottom paddle goes off the bottom', () => {
  const effects = finished('opponent', { config: TWO_PLAYER_CONFIG, seed: 3 });

  assert.equal(effects.hiddenPaddle, 'player');
  for (const shard of effects.shards) {
    assert.ok(Math.abs(shard.x - 120) <= 60, 'at the player\'s paddle');
  }
});

test('no finisher without the fun extras, on the player\'s defeat, or at the end of a Rush run', () => {
  for (const effects of [finished('player', { jokes: false }), finished('opponent'), finished('opponent', { config: RUSH_CONFIG })]) {
    assert.equal(effects.hiddenPaddle, null);
    assert.equal(effects.shards.length, 0);
    assert.equal(effects.scheduled.length, 7, 'the fireworks start at once');
    assert.deepEqual(effects.labels, []);
  }
});

test('a boss\'s attacks are announced and land with effects of their own', () => {
  const drip = play([{ type: 'hazard-warn', kind: 'drip', x: 100 }]);
  assert.equal(drip.rings.length, 1);

  const lag = play([{ type: 'hazard-warn', kind: 'lag', x: 250 }]);
  assert.equal(lag.labels[0].text, 'PING 999');

  const beam = play([{ type: 'hazard-warn', kind: 'beam', x: 250 }]);
  assert.ok(beam.active);

  const splashed = play([{ type: 'hazard-hit', kind: 'drip', x: 120, y: 744 }]);
  assert.equal(splashed.labels[0].text, 'SHRUNK!');
  assert.ok(splashed.particles.length > 0);
  assert.equal(splashed.flashAlpha, 0, 'a drip does not flash');

  const zapped = play([{ type: 'hazard-hit', kind: 'beam', x: 250, y: 744 }]);
  assert.ok(zapped.flashAlpha > 0);

  const lagged = play([{ type: 'hazard-hit', kind: 'lag', x: 250, y: 400 }]);
  assert.equal(lagged.labels[0].text, 'LAG!');
});

// The final boss: the landlord who wants the arcade gone.
const LANDLORD = RIVALS.at(-1).config;
const landlordState = (overrides = {}) => ({ ...createInitialState(LANDLORD, 1), phase: GAME_PHASE.RUNNING, ...overrides });
const texts = (effects) => effects.labels.map((label) => label.text);

function against(events, { jokes = true, state = landlordState(), config = LANDLORD } = {}) {
  const effects = new Effects({ random: () => 0.5 });
  playEvents(effects, events, { config, random: () => 0.5, jokes, state });
  return effects;
}

test('the final boss opens the match with FIGHT! on the first serve', () => {
  const serve = { type: 'serve', x: width / 2, y: height / 2 };

  assert.deepEqual(texts(against([serve])), ['FIGHT!']);
  assert.deepEqual(texts(against([serve], { state: landlordState({ serveNumber: 3 }) })), [], 'not on later serves');
  assert.deepEqual(texts(against([serve], { config: RIVALS[8].config })), [], 'nor against any other rival');
});

test('the final boss flares into each new phase at its paddle, under the title of what it brings', () => {
  const titles = [1, 2, 3].map((phase) => {
    const effects = against([{ type: 'boss-phase', phase }]);
    assert.ok(effects.rings.some((ring) => Math.abs(ring.y - 48) < 1), 'at the boss\'s paddle');
    return texts(effects)[0];
  });

  assert.deepEqual(titles, ['BAD WIRING!', 'BAD WI-FI!', 'FINAL NOTICE!']);
  assert.equal(against([{ type: 'boss-phase', phase: 1 }], { state: null }).active, false, 'without the state it cannot place it');
  assert.equal(against([{ type: 'boss-phase', phase: 1 }], { config: GAME_CONFIG }).active, false);
});

test('with the fun extras on the landlord taunts every point it takes, and has the last word', () => {
  const point = { type: 'point', scorer: 'opponent', x: 250, y: height };
  const scored = (opponent, extra = []) => against([point, ...extra], { state: landlordState({ score: { player: 2, opponent } }) });

  assert.deepEqual(texts(scored(1)), [TAUNTS[0]]);
  assert.deepEqual(texts(scored(5)), [TAUNTS[4]]);
  assert.deepEqual(texts(scored(6, [{ type: 'match-point', side: 'opponent' }])), ['MATCH POINT', TAUNTS[5]], 'after the match point, not instead');
  assert.deepEqual(texts(against([point], { jokes: false, state: landlordState({ score: { player: 0, opponent: 1 } }) })), [], 'only with the fun extras');
  assert.deepEqual(texts(against([{ ...point, scorer: 'player', y: 0 }], { state: landlordState({ score: { player: 1, opponent: 0 } }) })), [], 'not on the player\'s points');
  assert.deepEqual(texts(against([point], { config: RIVALS[8].config, state: landlordState({ score: { player: 0, opponent: 1 } }) })), [], 'no other rival taunts');

  const over = landlordState({ phase: GAME_PHASE.GAME_OVER, score: { player: 3, opponent: 7 } });
  assert.deepEqual(texts(against([point, { type: 'game-over', winner: 'opponent' }], { state: over })), [LAST_WORD], 'the winning point gets the last word instead');
  assert.deepEqual(texts(against([{ type: 'game-over', winner: 'opponent' }], { jokes: false, state: over })), []);
});

test('beating the final boss with the fun extras on is an EVICTALITY', () => {
  const effects = against([{ type: 'game-over', winner: 'player' }], { state: landlordState({ phase: GAME_PHASE.GAME_OVER, score: { player: 7, opponent: 2 } }) });

  assert.deepEqual(texts(effects), ['EVICTALITY']);
  assert.equal(effects.labels[0].color, `rgb(${THEME.red})`);
  assert.equal(effects.hiddenPaddle, 'opponent');
});
