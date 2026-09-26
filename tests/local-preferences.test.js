import test from 'node:test';
import assert from 'node:assert/strict';

import { LocalPreferences } from '../src/adapters/local-preferences.js';

const KEY = 'ping-pong-lab:preferences';
const NO_STATS = { matches: 0, wins: 0, streak: 0, bestStreak: 0 };
const DEFAULTS = {
  mode: 'solo',
  difficulty: 'normal',
  powerUps: true,
  sound: true,
  music: true,
  vibration: true,
  tutorialSeen: false,
  bestRally: 0,
  bestRush: 0,
  stats: NO_STATS,
};

function createStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));

  return {
    entries,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, value),
  };
}

test('starts from sensible defaults when nothing is stored', () => {
  assert.deepEqual(new LocalPreferences({ localStorage: createStorage() }).get(), DEFAULTS);
  assert.deepEqual(new LocalPreferences({}).get(), DEFAULTS);
});

test('restores stored choices', () => {
  const stored = {
    mode: 'rush',
    difficulty: 'hard',
    powerUps: false,
    sound: false,
    music: false,
    vibration: false,
    tutorialSeen: true,
    bestRally: 17,
    bestRush: 40,
    stats: { matches: 9, wins: 6, streak: 2, bestStreak: 4 },
  };
  const preferences = new LocalPreferences({ localStorage: createStorage({ [KEY]: JSON.stringify(stored) }) });

  assert.deepEqual(preferences.get(), stored);
});

test('ignores malformed or outdated stored values', () => {
  const stored = { mode: 'battle-royale', difficulty: 'impossible', sound: 'yes', vibration: null, bestRally: -3, bestRush: '12', stats: 'lots' };
  const preferences = new LocalPreferences({ localStorage: createStorage({ [KEY]: JSON.stringify(stored) }) });

  assert.deepEqual(preferences.get(), DEFAULTS);
  assert.deepEqual(new LocalPreferences({ localStorage: createStorage({ [KEY]: '{broken' }) }).get(), DEFAULTS);
  assert.deepEqual(new LocalPreferences({ localStorage: createStorage({ [KEY]: '42' }) }).get(), DEFAULTS);
  assert.equal(new LocalPreferences({ localStorage: createStorage({ [KEY]: '{"bestRally":2.5}' }) }).get().bestRally, 0);
});

test('statistics that cannot be true are brought back into range', () => {
  const stored = { stats: { matches: 2, wins: 5, streak: 9, bestStreak: 1 } };
  const { stats } = new LocalPreferences({ localStorage: createStorage({ [KEY]: JSON.stringify(stored) }) }).get();

  // Wins cannot exceed matches, and a streak cannot exceed the wins or the best streak.
  assert.deepEqual(stats, { matches: 5, wins: 5, streak: 1, bestStreak: 1 });
});

test('changes are merged and saved', () => {
  const storage = createStorage();
  const preferences = new LocalPreferences({ localStorage: storage });

  preferences.set({ difficulty: 'easy' });
  preferences.set({ bestRally: 9 });

  assert.deepEqual(preferences.get(), { ...DEFAULTS, difficulty: 'easy', bestRally: 9 });
  assert.deepEqual(JSON.parse(storage.entries.get(KEY)), preferences.get());
});

test('keeps working in memory when storage is blocked', () => {
  const blocked = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const preferences = new LocalPreferences({ localStorage: blocked });

  preferences.set({ sound: false });

  assert.equal(preferences.get().sound, false);
});

test('a window whose localStorage getter throws still gets defaults', () => {
  const hostile = Object.defineProperty({}, 'localStorage', {
    get() {
      throw new Error('SecurityError');
    },
  });
  const preferences = new LocalPreferences(hostile);

  preferences.set({ difficulty: 'hard' });

  assert.equal(preferences.get().difficulty, 'hard');
});
