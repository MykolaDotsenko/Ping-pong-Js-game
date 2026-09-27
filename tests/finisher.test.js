import test from 'node:test';
import assert from 'node:assert/strict';

import { FINISHER_KINDS, FINISHER_SECONDS, finisherApplies, finisherFor } from '../src/adapters/finisher.js';

const solo = { twoPlayers: false, rush: false, jokes: true };

test('a finisher plays for the player\'s wins and for either person in a two-player match', () => {
  assert.equal(finisherApplies({ ...solo, winner: 'player' }), true);
  assert.equal(finisherApplies({ ...solo, winner: 'opponent' }), false, 'no finisher on the player');
  assert.equal(finisherApplies({ ...solo, twoPlayers: true, winner: 'opponent' }), true);
  assert.equal(finisherApplies({ ...solo, twoPlayers: true, winner: 'player' }), true);
});

test('no finisher without the fun extras, at the end of a Rush run, or before a match is over', () => {
  assert.equal(finisherApplies({ ...solo, winner: 'player', jokes: false }), false);
  assert.equal(finisherApplies({ ...solo, winner: 'opponent', rush: true }), false);
  assert.equal(finisherApplies({ ...solo, winner: null }), false);
});

test('the kind follows from the match seed, every kind turns up, and the loser is named', () => {
  const first = finisherFor({ ...solo, winner: 'player', seed: 77 });
  assert.deepEqual(first, finisherFor({ ...solo, winner: 'player', seed: 77 }));
  assert.equal(first?.loser, 'opponent');
  assert.equal(finisherFor({ ...solo, twoPlayers: true, winner: 'opponent', seed: 77 })?.loser, 'player');
  assert.equal(finisherFor({ ...solo, winner: 'opponent', seed: 77 }), null);

  const kinds = new Set();
  for (let seed = 0; seed < 100; seed += 1) {
    kinds.add(finisherFor({ ...solo, winner: 'player', seed })?.kind);
  }
  assert.deepEqual([...kinds].sort(), [...FINISHER_KINDS].sort());
  assert.ok(FINISHER_SECONDS <= 1.2, 'never keeps the result screen waiting longer than agreed');
});
