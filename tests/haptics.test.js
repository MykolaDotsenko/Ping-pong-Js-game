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

test('firing a super thumps, answering one knocks, and a full meter taps twice, for the player only', () => {
  const { haptics, calls } = setup();
  const hit = (side, extra) => ({ type: 'paddle-hit', side, x: 0, y: 0, speed: 400, spin: 0, rally: 1, ...extra });

  haptics.handle([hit('player', { super: 'fireball' })]);
  haptics.handle([hit('player', { saved: 'zigzag' })]);
  haptics.handle([{ type: 'super-ready', side: 'player', kind: 'thunder' }]);
  haptics.handle([hit('opponent', { super: 'phantom' }), { type: 'super-ready', side: 'opponent', kind: 'zigzag' }]);

  assert.deepEqual(calls, [[25, 30, 45], 30, [12, 40, 24]]);
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

test('a boss\'s attack that lands is felt too', () => {
  const { haptics, calls } = setup();

  haptics.handle([{ type: 'hazard-warn', kind: 'drip', x: 0 }, { type: 'hazard-hit', kind: 'drip', x: 0, y: 0 }]);

  assert.deepEqual(calls, [35]);
});
