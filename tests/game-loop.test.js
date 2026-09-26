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

test('a stop requested during update draws the final frame and schedules nothing more', () => {
  const scheduler = createScheduler();
  const renders = [];
  let updates = 0;

  const loop = new FixedStepLoop({
    stepSeconds: 0.01,
    maxFrameSeconds: 0.1,
    scheduler,
    update: () => {
      updates += 1;
      loop.stop();
    },
    render: (alpha) => renders.push(alpha),
  });

  loop.start();
  loop.tick(1000);
  loop.tick(1050);

  assert.equal(updates, 1);
  assert.deepEqual(renders, [0, 0]);
  assert.equal(loop.running, false);
  assert.equal(loop.frameId, null);
  assert.equal(scheduler.requested.length, 2);
});

test('restarting after a stop schedules exactly one frame and ignores stale callbacks', () => {
  const scheduler = createScheduler();
  const renders = [];
  const loop = new FixedStepLoop({
    stepSeconds: 0.01,
    maxFrameSeconds: 0.1,
    scheduler,
    update: () => {},
    render: (alpha) => renders.push(alpha),
  });

  loop.start();
  const staleTick = scheduler.requested[0].callback;
  loop.stop();
  staleTick(1000);

  assert.equal(renders.length, 0);

  loop.start();

  assert.equal(scheduler.requested.length, 2);
  assert.equal(loop.frameId, scheduler.requested[1].id);
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
