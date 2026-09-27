import test from 'node:test';
import assert from 'node:assert/strict';

import { Effects } from '../src/adapters/effects.js';

// A repeatable random source, so every run spawns the same sparks.
function seededRandom(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function createContext() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);

  return {
    calls,
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    stroke: record('stroke'),
    translate: record('translate'),
    rotate: record('rotate'),
    fillRect: record('fillRect'),
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
  };
}

const spark = { x: 100, y: 200, color: '#22d3ee', count: 20, speed: 300 };

test('a burst spawns sparks that fly out, fade and disappear', () => {
  const effects = new Effects({ random: seededRandom() });

  effects.burst(spark);

  assert.equal(effects.particles.length, 20);
  assert.ok(effects.active);

  effects.update(0.1);
  assert.ok(effects.particles.some((particle) => particle.x !== 100 || particle.y !== 200));

  for (let i = 0; i < 40; i += 1) {
    effects.update(0.05);
  }

  assert.equal(effects.particles.length, 0);
  assert.equal(effects.active, false);
});

test('bursts respect the particle budget', () => {
  const effects = new Effects({ random: seededRandom(), maxParticles: 30 });

  effects.burst(spark);
  effects.burst(spark);

  assert.equal(effects.particles.length, 30);
});

test('gravity pulls sparks down', () => {
  const effects = new Effects({ random: seededRandom() });

  effects.burst({ ...spark, speed: 0.0001, gravity: 400, drag: 0 });
  effects.update(0.2);

  assert.ok(effects.particles.every((particle) => particle.vy > 70));
});

test('rings grow and fade', () => {
  const effects = new Effects();

  effects.ring({ x: 0, y: 0, color: 'red', radius: 5, growth: 100, life: 0.3 });
  effects.update(0.1);

  assert.ok(Math.abs(effects.rings[0].radius - 15) < 1e-9);

  effects.update(0.25);
  assert.equal(effects.rings.length, 0);
});

test('shake, flash, squash, pulse and pop decay to rest', () => {
  const effects = new Effects({ random: seededRandom() });

  effects.shake(0.8);
  effects.flash('#fff', 0.4);
  effects.kick('player');
  effects.pulse(0.6);
  effects.pop();

  const offset = effects.shakeOffset(10);
  assert.ok(Math.abs(offset.x) <= 10 && Math.abs(offset.y) <= 10);
  assert.ok(offset.x !== 0 || offset.y !== 0);

  for (let i = 0; i < 60; i += 1) {
    effects.update(0.05);
  }

  assert.deepEqual(effects.shakeOffset(10), { x: 0, y: 0 });
  assert.equal(effects.flashAlpha, 0);
  assert.equal(effects.squash.player, 0);
  assert.equal(effects.active, false);
});

test('reduced motion removes shake, softens flashes and thins bursts', () => {
  const effects = new Effects({ random: seededRandom(), reducedMotion: true });

  effects.shake(1);
  effects.flash('#fff', 0.5);
  effects.burst(spark);

  assert.equal(effects.shakeAmount, 0);
  assert.ok(Math.abs(effects.flashAlpha - 0.15) < 1e-9);
  assert.equal(effects.particles.length, 8);
});

test('scheduled effects fire once their delay has passed', () => {
  const effects = new Effects();
  const fired = [];

  effects.schedule(0.3, () => fired.push('first'));
  effects.schedule(0.5, () => fired.push('second'));
  effects.update(0.35);

  assert.deepEqual(fired, ['first']);
  assert.ok(effects.active);

  effects.update(0.2);
  assert.deepEqual(fired, ['first', 'second']);
  assert.equal(effects.scheduled.length, 0);
});

test('drawing strokes sparks and rings additively, and skips work when idle', () => {
  const effects = new Effects({ random: seededRandom() });
  const idle = createContext();

  effects.draw(idle);
  assert.deepEqual(idle.calls, []);

  const busy = createContext();
  effects.burst({ ...spark, count: 3 });
  effects.ring({ x: 0, y: 0, color: 'red' });
  effects.draw(busy);

  const strokes = busy.calls.filter(([name]) => name === 'stroke');
  assert.equal(strokes.length, 4);
  assert.equal(busy.calls.filter(([name]) => name === 'arc').length, 1);
  assert.deepEqual(busy.calls[0], ['save']);
  assert.deepEqual(busy.calls[busy.calls.length - 1], ['restore']);
});

test('a callout replaces the previous one, then fades away', () => {
  const effects = new Effects();

  effects.label({ text: 'EDGE!', x: 10, y: 20, color: 'red' });
  effects.label({ text: 'CURVE!', x: 30, y: 40, color: 'lime', life: 0.5 });

  assert.equal(effects.labels.length, 1);
  assert.equal(effects.labels[0].text, 'CURVE!');
  assert.ok(effects.active);

  effects.update(0.6);
  assert.equal(effects.labels.length, 0);
  assert.equal(effects.active, false);
});

test('clear removes everything at once', () => {
  const effects = new Effects({ random: seededRandom() });

  effects.burst(spark);
  effects.ring({ x: 0, y: 0, color: 'red' });
  effects.schedule(1, () => {});
  effects.shake(1);
  effects.clear();

  assert.equal(effects.active, false);
});

test('updating with no elapsed time changes nothing', () => {
  const effects = new Effects({ random: seededRandom() });

  effects.burst(spark);
  const before = structuredClone(effects.particles);
  effects.update(0);

  assert.deepEqual(effects.particles, before);
});

test('a step backwards in time, from a misbehaving clock, changes nothing either', () => {
  const effects = new Effects({ random: seededRandom() });

  effects.burst(spark);
  const before = structuredClone(effects.particles);
  effects.update(-0.1);

  assert.deepEqual(effects.particles, before);
});

test('shakes add up, but never beyond a firm jolt', () => {
  const effects = new Effects({ random: seededRandom() });

  effects.shake(1);
  effects.shake(1);
  effects.shake(1);

  assert.equal(effects.shakeAmount, 1.2);
});

test('a shattered paddle flies out in tumbling pieces that fall, then are gone', () => {
  const effects = new Effects({ random: seededRandom() });

  effects.shatter({ x: 250, y: 744, width: 100, height: 16, color: '#22d3ee', count: 10, speed: 300 });
  effects.hidePaddle('player');

  assert.equal(effects.shards.length, 10);
  assert.equal(effects.hiddenPaddle, 'player');
  assert.ok(effects.active);
  assert.ok(effects.shards.every((shard) => shard.vy < 0), 'every piece is kicked up first');
  assert.ok(Math.abs(effects.shards.reduce((sum, shard) => sum + shard.width, 0) - 100) < 20, 'the pieces add up to about the paddle');

  const velocities = effects.shards.map((shard) => shard.vy);
  effects.update(0.1);
  assert.ok(effects.shards.every((shard, index) => shard.vy > velocities[index]), 'gravity pulls the pieces down');
  assert.ok(effects.shards.some((shard) => shard.angle !== 0), 'the pieces tumble');

  for (let i = 0; i < 40; i += 1) {
    effects.update(0.05);
  }

  assert.equal(effects.shards.length, 0);
  assert.equal(effects.hiddenPaddle, 'player', 'the paddle stays gone until the next match clears the effects');
  effects.clear();
  assert.equal(effects.hiddenPaddle, null);
});

test('with reduced motion a paddle breaks into fewer pieces', () => {
  const effects = new Effects({ random: seededRandom(), reducedMotion: true });

  effects.shatter({ x: 250, y: 744, width: 100, height: 16, color: '#22d3ee', count: 10, speed: 300 });

  assert.equal(effects.shards.length, 4);
});

test('pieces are drawn as rotated solid rectangles, before the additive light', () => {
  const effects = new Effects({ random: seededRandom() });
  const context = createContext();

  effects.shard({ x: 10, y: 20, vx: 0, vy: 0, width: 30, height: 8, color: '#f472b6', spin: 2, life: 1 });
  effects.update(0.5);
  effects.draw(context);

  const names = context.calls.map(([name]) => name);
  assert.deepEqual(names.slice(0, 6), ['save', 'save', 'translate', 'rotate', 'fillRect', 'restore']);
  assert.deepEqual(context.calls.find(([name]) => name === 'translate').slice(1), [10, 20]);
  assert.ok(Math.abs(context.calls.find(([name]) => name === 'rotate')[1] - 1) < 1e-9);
  assert.deepEqual(context.calls.find(([name]) => name === 'fillRect').slice(1), [-15, -4, 30, 8]);
});
