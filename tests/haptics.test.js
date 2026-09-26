import test from 'node:test';
import assert from 'node:assert/strict';

import { Haptics } from '../src/adapters/haptics.js';

function setup({ vibration = true, supported = true } = {}) {
  const calls = [];
  const navigator = supported ? { vibrate: (pattern) => calls.push(pattern) } : {};
  const haptics = new Haptics({ navigator, preferences: { get: () => ({ vibration }) } });

  return { haptics, calls };
}

test('the player feels their own hits, points and the end of a match', () => {
  const { haptics, calls } = setup();

  haptics.handle([
    { type: 'paddle-hit', side: 'player', x: 0, y: 0, speed: 400, spin: 0, rally: 1 },
    { type: 'paddle-hit', side: 'opponent', x: 0, y: 0, speed: 400, spin: 0, rally: 2 },
    { type: 'wall-bounce', x: 0, y: 0, speed: 400 },
    { type: 'point', scorer: 'player', x: 0, y: 0 },
    { type: 'point', scorer: 'opponent', x: 0, y: 0 },
    { type: 'game-over', winner: 'player' },
    { type: 'game-over', winner: 'opponent' },
  ]);

  assert.deepEqual(calls, [12, [18, 40, 18], 45, [30, 60, 30, 60, 120], [160]]);
});

test('vibration can be switched off', () => {
  const { haptics, calls } = setup({ vibration: false });

  haptics.handle([{ type: 'point', scorer: 'player', x: 0, y: 0 }]);

  assert.deepEqual(calls, []);
});

test('devices without vibration are left alone', () => {
  const { haptics } = setup({ supported: false });

  assert.equal(haptics.supported, false);
  assert.doesNotThrow(() => haptics.handle([{ type: 'point', scorer: 'player', x: 0, y: 0 }]));
});
