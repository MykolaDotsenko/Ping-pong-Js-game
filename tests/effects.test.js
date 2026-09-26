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
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    strokeStyle: '',
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
