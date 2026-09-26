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
  track: 'neon',
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
    track: 'iron',
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
  const stored = { mode: 'battle-royale', difficulty: 'impossible', track: 'polka', sound: 'yes', vibration: null, bestRally: -3, bestRush: '12', stats: 'lots' };
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

/** A window whose tabs share one localStorage and hear each other's saves. */
function createTab(storage) {
  const events = new EventTarget();
  const window = {
    localStorage: storage,
    addEventListener: (type, listener) => events.addEventListener(type, (event) => listener(event.detail)),
    removeEventListener: () => {},
    // What the browser does in the other tabs after one of them saves.
    hearSave: (key = KEY) => events.dispatchEvent(Object.assign(new Event('storage'), { detail: { key } })),
  };
  const preferences = new LocalPreferences(window);
  preferences.connect();
  return { window, preferences };
}

test('a tab merges its change into what another tab saved, so records are never rolled back', () => {
  const storage = createStorage();
  const first = createTab(storage);
  const second = createTab(storage);

  first.preferences.set({ stats: { matches: 4, wins: 4, streak: 4, bestStreak: 4 } });
  // The second tab has not heard of that save yet, and records a rally of its own.
  second.preferences.set({ bestRally: 5 });

  const stored = JSON.parse(storage.entries.get(KEY));
  assert.deepEqual(stored.stats, { matches: 4, wins: 4, streak: 4, bestStreak: 4 });
  assert.equal(stored.bestRally, 5);
});

test('a tab follows another tab\'s saves through the storage event', () => {
  const storage = createStorage();
  const first = createTab(storage);
  const second = createTab(storage);

  first.preferences.set({ difficulty: 'hard', bestRush: 30 });
  second.window.hearSave('some-other-key');
  assert.equal(second.preferences.get().difficulty, 'normal', 'other keys are not ours');

  second.window.hearSave();
  assert.equal(second.preferences.get().difficulty, 'hard');
  assert.equal(second.preferences.get().bestRush, 30);

  // Clearing the site's storage in one tab reaches the others as a null key.
  storage.entries.clear();
  second.window.hearSave(null);
  assert.deepEqual(second.preferences.get(), DEFAULTS);
});

test('after a save fails, the tab trusts its own newer values over what storage still holds', () => {
  const storage = createStorage({ [KEY]: JSON.stringify({ sound: true }) });
  storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  const preferences = new LocalPreferences({ localStorage: storage });

  preferences.set({ sound: false });
  preferences.set({ music: false });

  assert.equal(preferences.get().sound, false, 'not reverted by the stale stored value');
  assert.equal(preferences.get().music, false);
});

test('after a save fails, another tab\'s save does not roll back this tab\'s newer values', () => {
  const storage = createStorage({ [KEY]: JSON.stringify({ bestRally: 2 }) });
  const tab = createTab(storage);
  const write = storage.setItem;

  storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  tab.preferences.set({ bestRally: 9 });

  // Storage recovers in another tab, which saves an older record.
  storage.setItem = write;
  storage.setItem(KEY, JSON.stringify({ bestRally: 3 }));
  tab.window.hearSave();

  assert.equal(tab.preferences.get().bestRally, 9);
});
