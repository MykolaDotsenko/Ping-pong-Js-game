import test from 'node:test';
import assert from 'node:assert/strict';

import { nicknameFor, NICKNAMES } from '../src/application/nicknames.js';

test('every nickname is short, plain ASCII and unique, so it fits a narrow scoreboard', () => {
  assert.ok(NICKNAMES.length >= 12);
  assert.equal(new Set(NICKNAMES).size, NICKNAMES.length);

  for (const nickname of NICKNAMES) {
    assert.ok(nickname.length >= 6 && nickname.length <= 9, nickname);
    assert.match(nickname, /^[\x21-\x7e]+$/, nickname);
  }
});

test('the nickname follows from the match seed, and every nickname turns up', () => {
  assert.equal(nicknameFor(12345), nicknameFor(12345));
  assert.equal(nicknameFor(12345.9), nicknameFor(12345), 'a fractional seed is truncated');

  const seen = new Set();
  for (let seed = 0; seed < 400; seed += 1) {
    seen.add(nicknameFor(seed));
  }
  assert.equal(seen.size, NICKNAMES.length);

  // Neighbouring seeds do not walk the list in order.
  const order = [0, 1, 2, 3, 4, 5].map(nicknameFor);
  assert.notDeepEqual(order, NICKNAMES.slice(0, 6));
});
