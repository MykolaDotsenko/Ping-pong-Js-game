import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMIC_TITLES,
  FINAL_TITLE,
  FINISHER_KINDS,
  FINISHER_SECONDS,
  finisherApplies,
  finisherAt,
  finisherFor,
  REGULAR_FINISHERS,
  SUPER_FINISHERS,
} from '../src/adapters/finisher.js';
import { RIVALS } from '../src/catalog.js';
import { GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG } from '../src/config.js';
import { createInitialState } from '../src/domain/game.js';

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

test('the kind follows from the match seed, every ordinary kind turns up, and the loser is named', () => {
  const first = finisherFor({ ...solo, winner: 'player', seed: 77 });
  assert.deepEqual(first, finisherFor({ ...solo, winner: 'player', seed: 77 }));
  assert.equal(first?.loser, 'opponent');
  assert.equal(finisherFor({ ...solo, twoPlayers: true, winner: 'opponent', seed: 77 })?.loser, 'player');
  assert.equal(finisherFor({ ...solo, winner: 'opponent', seed: 77 }), null);

  const kinds = new Map();
  for (let seed = 0; seed < 2000; seed += 1) {
    const { kind } = finisherFor({ ...solo, winner: 'player', seed });
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }

  assert.deepEqual([...kinds.keys()].sort(), [...REGULAR_FINISHERS, ...Object.keys(COMIC_TITLES)].sort());
  const comic = (kinds.get('tiny') + kinds.get('snooze')) / 2000;
  assert.ok(comic > 0.1 && comic < 0.2, `now and then comic: ${comic}`);
  assert.ok(FINISHER_SECONDS <= 1.2, 'never keeps the result screen waiting longer than agreed');
});

test('ordinary finishers are a PONGALITY, comic ones go by their own names', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const finisher = finisherFor({ ...solo, winner: 'player', seed });
    assert.equal(finisher.title, COMIC_TITLES[finisher.kind] ?? 'PONGALITY');
    assert.equal(finisher.super, null);
  }
});

test('a match won with a super ends in that super\'s own finisher, whatever the seed', () => {
  for (const [superKind, kind] of Object.entries(SUPER_FINISHERS)) {
    for (const seed of [1, 2, 3]) {
      assert.deepEqual(finisherFor({ ...solo, winner: 'player', seed, super: superKind }), {
        kind,
        loser: 'opponent',
        title: 'PONGALITY',
        super: superKind,
        perfect: false,
      });
    }
  }

  assert.equal(finisherFor({ ...solo, winner: 'opponent', seed: 1, super: 'zigzag' }), null, 'still none on the player');
  assert.equal(new Set(FINISHER_KINDS).size, FINISHER_KINDS.length);
  assert.equal(FINISHER_KINDS.length, 14);
});

test('beating the final boss is an EVICTALITY, whatever won the match', () => {
  for (const seed of [1, 2, 3]) {
    assert.deepEqual(finisherFor({ ...solo, final: true, winner: 'player', seed }), {
      kind: 'evict',
      loser: 'opponent',
      title: FINAL_TITLE,
      super: null,
      perfect: false,
    });
  }

  assert.equal(FINAL_TITLE, 'EVICTALITY');
  assert.deepEqual(finisherFor({ ...solo, final: true, winner: 'player', seed: 1, super: 'fireball', perfect: true })?.super, 'fireball', 'a super still gets its due');
  assert.equal(finisherFor({ ...solo, final: true, winner: 'opponent', seed: 1 }), null, 'the landlord does not evict the player like that');
  assert.equal(finisherFor({ ...solo, final: true, jokes: false, winner: 'player', seed: 1 }), null);

  const landlord = RIVALS.at(-1).config;
  const over = { ...createInitialState(landlord, 1), score: { player: 7, opponent: 4 } };
  assert.equal(finisherAt({ type: 'game-over', winner: 'player' }, over, landlord, true)?.kind, 'evict');
  assert.notEqual(finisherAt({ type: 'game-over', winner: 'player' }, over, RIVALS[8].config, true)?.kind, 'evict', 'the other bosses go the usual way');
});

test('the finisher is read from the game-over event and the final score: a super, and a win to nil', () => {
  const state = (score) => ({ ...createInitialState(GAME_CONFIG, 1), seed: 5, score });
  const perfect = finisherAt({ type: 'game-over', winner: 'player', super: 'phantom' }, state({ player: 7, opponent: 0 }), GAME_CONFIG, true);

  assert.equal(perfect.kind, 'derez');
  assert.equal(perfect.perfect, true);
  assert.equal(finisherAt({ type: 'game-over', winner: 'player' }, state({ player: 7, opponent: 1 }), GAME_CONFIG, true).perfect, false);
  assert.equal(finisherAt({ type: 'game-over', winner: 'opponent' }, state({ player: 0, opponent: 7 }), TWO_PLAYER_CONFIG, true).perfect, true);
  assert.equal(finisherAt({ type: 'game-over', winner: 'player' }, state({ player: 7, opponent: 0 }), GAME_CONFIG, false), null);
  assert.equal(finisherAt({ type: 'game-over', winner: 'opponent' }, state({ player: 0, opponent: 3 }), RUSH_CONFIG, true), null);
});
