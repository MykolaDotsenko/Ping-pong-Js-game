import test from 'node:test';
import assert from 'node:assert/strict';

import { calloutFor, CURVE_SPIN, EDGE_OFFSET, playEvents } from '../src/adapters/canvas/event-effects.js';
import { THEME } from '../src/adapters/canvas/theme.js';
import { Effects } from '../src/adapters/effects.js';
import { GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG } from '../src/config.js';
import { createInitialState } from '../src/domain/game.js';

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

const over = (seed = 1) => ({ ...createInitialState(GAME_CONFIG, seed), phase: 'game-over', opponent: { x: 250, vx: 0 }, player: { x: 120, vx: 0 } });
const finished = (winner, { config = GAME_CONFIG, jokes = true, seed = 1 } = {}) => {
  const effects = new Effects({ random: () => 0.5 });
  playEvents(effects, [{ type: 'game-over', winner }], { config, random: () => 0.5, jokes, state: over(seed) });
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

test('every kind of finisher comes apart in its own way, at the loser\'s paddle', () => {
  const seen = new Set();

  for (let seed = 0; seed < 40; seed += 1) {
    const effects = finished('player', { seed });
    const shards = effects.shards;
    const kind = shards.length > 4 ? 'shatter' : shards.length === 2 ? 'slice' : shards.length === 1 ? 'launch' : 'vaporize';
    seen.add(kind);

    for (const shard of shards) {
      assert.ok(Math.abs(shard.x - 250) <= 60 && Math.abs(shard.y - (GAME_CONFIG.paddle.inset + 8)) < 1, `${kind} starts at the top paddle`);
    }

    if (kind === 'launch') {
      assert.ok(shards[0].vy < 0, 'the top paddle is launched off the top');
    }
  }

  assert.deepEqual([...seen].sort(), ['launch', 'shatter', 'slice', 'vaporize']);
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
