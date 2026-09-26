import test from 'node:test';
import assert from 'node:assert/strict';

import { nextBetween, nextRandom } from '../src/domain/random.js';

test('the same seed always gives the same value and next seed', () => {
  assert.deepEqual(nextRandom(42), nextRandom(42));
  assert.notEqual(nextRandom(42).value, nextRandom(43).value);
});

test('values stay in [0, 1) and spread across the range', () => {
  let seed = 1;
  const buckets = new Array(10).fill(0);

  for (let i = 0; i < 10000; i += 1) {
    const next = nextRandom(seed);
    seed = next.seed;
    assert.ok(next.value >= 0 && next.value < 1);
    buckets[Math.floor(next.value * 10)] += 1;
  }

  assert.ok(buckets.every((count) => count > 800 && count < 1200), JSON.stringify(buckets));
});

test('nextBetween scales into the requested range', () => {
  const { value } = nextBetween(9, 5, 9);

  assert.ok(value >= 5 && value < 9);
});
