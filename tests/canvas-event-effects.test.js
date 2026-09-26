import test from 'node:test';
import assert from 'node:assert/strict';

import { calloutFor, CURVE_SPIN, EDGE_OFFSET, playEvents } from '../src/adapters/canvas/event-effects.js';
import { THEME } from '../src/adapters/canvas/theme.js';
import { Effects } from '../src/adapters/effects.js';
import { GAME_CONFIG } from '../src/config.js';

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

test('every fifth hit of a rally pulses the whole court', () => {
  const ordinary = play([hit({ rally: 4 })]);
  const milestone = play([hit({ rally: 5 })]);

  assert.equal(milestone.rings.length, ordinary.rings.length + 1);
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
