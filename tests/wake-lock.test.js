import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';

import { WakeLock } from '../src/adapters/wake-lock.js';

/**
 * A Screen Wake Lock API whose requests the test answers by hand, so it can let events
 * happen while a request is still in flight, as they do on a real phone.
 */
function createWakeLockApi() {
  const api = {
    requests: 0,
    pending: [],
    held: new Set(),
    request(type) {
      assert.equal(type, 'screen');
      api.requests += 1;
      return new Promise((resolve, reject) => {
        api.pending.push({ resolve, reject });
      });
    },
    grant() {
      const sentinel = Object.assign(new EventTarget(), {
        released: false,
        async release() {
          sentinel.released = true;
          api.held.delete(sentinel);
          sentinel.dispatchEvent(new Event('release'));
        },
      });
      api.held.add(sentinel);
      api.pending.shift().resolve(sentinel);
      return sentinel;
    },
    deny() {
      api.pending.shift().reject(new Error('NotAllowedError'));
    },
  };
  return api;
}

const event = (type) => [{ type }];

test('the screen stays on while a match runs, and may sleep on pause, at the menu and after the match', async () => {
  for (const ending of ['paused', 'menu', 'game-over']) {
    const api = createWakeLockApi();
    const lock = new WakeLock({ wakeLock: api });

    lock.handle(event('match-start'));
    api.grant();
    await settle();
    assert.equal(api.held.size, 1, ending);

    lock.handle(event(ending));
    await settle();
    assert.equal(api.held.size, 0, ending);
  }
});

test('a lock that arrives after the match was paused is let go at once', async () => {
  const api = createWakeLockApi();
  const lock = new WakeLock({ wakeLock: api });

  lock.handle(event('match-start'));
  lock.handle(event('paused'));
  const late = api.grant();
  await settle();

  assert.equal(late.released, true);
  assert.equal(api.held.size, 0);
});

test('pausing and resuming before the first lock arrives asks only once, so no lock is left behind', async () => {
  const api = createWakeLockApi();
  const lock = new WakeLock({ wakeLock: api });

  lock.handle(event('match-start'));
  lock.handle(event('paused'));
  lock.handle(event('resumed'));
  assert.equal(api.requests, 1, 'the request in flight serves the resume too');

  api.grant();
  await settle();
  assert.equal(api.held.size, 1);

  lock.handle(event('game-over'));
  await settle();
  assert.equal(api.held.size, 0, 'nothing keeps the screen on after the match');
});

test('after the system drops the lock, for example when the page is hidden, resuming asks again', async () => {
  const api = createWakeLockApi();
  const lock = new WakeLock({ wakeLock: api });

  lock.handle(event('match-start'));
  const first = api.grant();
  await settle();
  await first.release();

  lock.handle(event('resumed'));
  assert.equal(api.requests, 2);
  api.grant();
  await settle();
  assert.equal(api.held.size, 1);
});

test('a refused lock does not stop the game, and the next match asks again', async () => {
  const api = createWakeLockApi();
  const lock = new WakeLock({ wakeLock: api });

  lock.handle(event('match-start'));
  api.deny();
  await settle();
  assert.equal(api.held.size, 0);

  lock.handle(event('match-start'));
  assert.equal(api.requests, 2);
});

test('without the Screen Wake Lock API nothing is attempted', () => {
  const lock = new WakeLock({});

  assert.equal(lock.supported, false);
  lock.handle([...event('match-start'), ...event('paused')]);
});
