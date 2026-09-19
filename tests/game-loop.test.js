import test from 'node:test';
import assert from 'node:assert/strict';

import { FixedStepLoop } from '../src/application/game-loop.js';

function createScheduler() {
  let nextId = 1;
  const requested = [];
  const cancelled = [];

  return {
    requested,
    cancelled,
    request(callback) {
      const id = nextId++;
      requested.push({ id, callback });
      return id;
    },
    cancel(id) {
      cancelled.push(id);
    },
  };
}

test('fixed-step loop advances deterministic updates and exposes interpolation', () => {
  const scheduler = createScheduler();
  const updates = [];
  const renders = [];

  const loop = new FixedStepLoop({
    stepSeconds: 0.01,
    maxFrameSeconds: 0.1,
    scheduler,
    update: (deltaSeconds) => updates.push(deltaSeconds),
    render: (alpha) => renders.push(alpha),
  });

  loop.start();
  assert.equal(scheduler.requested.length, 1);

  loop.tick(1000);
  loop.tick(1025);

  assert.deepEqual(updates, [0.01, 0.01]);
  assert.equal(renders[0], 0);
  assert.ok(Math.abs(renders[1] - 0.5) < 1e-9);
});

test('start is idempotent and stop cancels the scheduled frame', () => {
  const scheduler = createScheduler();
  const loop = new FixedStepLoop({
    stepSeconds: 0.01,
    maxFrameSeconds: 0.1,
    scheduler,
    update: () => {},
    render: () => {},
  });

  loop.start();
  loop.start();

  assert.equal(scheduler.requested.length, 1);

  const scheduledId = loop.frameId;
  loop.stop();

  assert.deepEqual(scheduler.cancelled, [scheduledId]);
  assert.equal(loop.running, false);
  assert.equal(loop.accumulator, 0);
});
