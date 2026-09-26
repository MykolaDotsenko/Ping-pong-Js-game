import test from 'node:test';
import assert from 'node:assert/strict';

import { GameController } from '../src/application/game-controller.js';
import { GAME_COMMAND } from '../src/application/ports.js';
import { GAME_CONFIG } from '../src/config.js';
import { GAME_PHASE } from '../src/domain/game.js';

function createFrameScheduler() {
  let nextId = 1;
  const pending = new Map();

  return {
    pending,
    request(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    // Runs the frames requested so far, as the browser would on its next repaint.
    flush(timestamp) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(timestamp));
    },
  };
}

function createPort(extra = {}) {
  return {
    connected: false,
    handler: null,
    onCommand(handler) {
      this.handler = handler;
    },
    connect() {
      this.connected = true;
    },
    disconnect() {
      this.connected = false;
    },
    ...extra,
  };
}

function setup() {
  const scheduler = createFrameScheduler();
  const renderer = createPort({
    frames: [],
    render(state) {
      this.frames.push(state);
    },
  });
  const view = createPort({
    presentations: [],
    render(presentation) {
      this.presentations.push(presentation);
    },
  });
  const input = createPort({
    current: { horizontalAxis: 0, pointerX: null },
    snapshot() {
      return this.current;
    },
  });
  const controller = new GameController({ config: GAME_CONFIG, renderer, input, view, scheduler });
  controller.connect();

  return { controller, scheduler, renderer, view, input };
}

const lastOf = (items) => items[items.length - 1];

test('connecting draws the ready screen and leaves the loop idle', () => {
  const { scheduler, renderer, view, input } = setup();

  assert.ok(renderer.connected && view.connected && input.connected);
  assert.equal(renderer.frames.length, 1);
  assert.deepEqual(lastOf(view.presentations), {
    phase: GAME_PHASE.READY,
    status: 'First to 7. Start when ready.',
  });
  assert.equal(scheduler.pending.size, 0);
});

test('the loop runs only while a match is running', () => {
  const { controller, scheduler, view } = setup();

  view.handler(GAME_COMMAND.START);
  assert.equal(controller.state.phase, GAME_PHASE.RUNNING);
  assert.equal(scheduler.pending.size, 1);

  view.handler(GAME_COMMAND.TOGGLE_PAUSE);
  assert.equal(controller.state.phase, GAME_PHASE.PAUSED);
  assert.equal(scheduler.pending.size, 0);
  assert.equal(lastOf(view.presentations).status, 'Game paused.');

  view.handler(GAME_COMMAND.TOGGLE_PAUSE);
  assert.equal(controller.state.phase, GAME_PHASE.RUNNING);
  assert.equal(scheduler.pending.size, 1);

  view.handler(GAME_COMMAND.RESET);
  assert.equal(controller.state.phase, GAME_PHASE.READY);
  assert.equal(scheduler.pending.size, 0);
});

test('the primary command starts an idle match and toggles pause during one', () => {
  const { controller, input } = setup();

  input.handler(GAME_COMMAND.PRIMARY);
  assert.equal(controller.state.phase, GAME_PHASE.RUNNING);

  input.handler(GAME_COMMAND.PRIMARY);
  assert.equal(controller.state.phase, GAME_PHASE.PAUSED);

  input.handler(GAME_COMMAND.PRIMARY);
  assert.equal(controller.state.phase, GAME_PHASE.RUNNING);

  controller.state = { ...controller.state, phase: GAME_PHASE.GAME_OVER, score: { player: 7, opponent: 3 } };
  input.handler(GAME_COMMAND.PRIMARY);
  assert.equal(controller.state.phase, GAME_PHASE.RUNNING);
  assert.deepEqual(controller.state.score, { player: 0, opponent: 0 });
});

test('focus loss pauses a running match and never resumes a paused one', () => {
  const { controller, input } = setup();

  input.handler(GAME_COMMAND.START);
  input.handler(GAME_COMMAND.PAUSE);
  assert.equal(controller.state.phase, GAME_PHASE.PAUSED);

  input.handler(GAME_COMMAND.PAUSE);
  assert.equal(controller.state.phase, GAME_PHASE.PAUSED);
});

test('commands that change nothing do not redraw', () => {
  const { renderer, view, input } = setup();

  input.handler(GAME_COMMAND.PAUSE);
  assert.equal(renderer.frames.length, 1);

  view.handler(GAME_COMMAND.START);
  view.handler(GAME_COMMAND.START);
  assert.equal(renderer.frames.length, 2);
  assert.equal(view.presentations.length, 2);
});

test('frames blend the last two simulation steps', () => {
  const { controller, scheduler, renderer, view } = setup();

  view.handler(GAME_COMMAND.START);
  scheduler.flush(1000);
  scheduler.flush(1000 + GAME_CONFIG.fixedStepSeconds * 1500);

  const frame = lastOf(renderer.frames);
  const expectedY = (controller.previousState.ball.y + controller.state.ball.y) / 2;

  assert.notEqual(controller.previousState, controller.state);
  assert.ok(Math.abs(frame.ball.y - expectedY) < 1e-9);
});

test('the winning point shows the final frame and stops the loop', () => {
  const { controller, scheduler, renderer, view } = setup();

  view.handler(GAME_COMMAND.START);
  controller.state = {
    ...controller.state,
    score: { player: GAME_CONFIG.winningScore - 1, opponent: 0 },
    ball: { x: 400, y: -GAME_CONFIG.ball.radius - 1, vx: 0, vy: -300 },
  };

  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.equal(controller.state.phase, GAME_PHASE.GAME_OVER);
  assert.equal(scheduler.pending.size, 0);
  assert.strictEqual(lastOf(renderer.frames), controller.state);
  assert.deepEqual(lastOf(view.presentations), {
    phase: GAME_PHASE.GAME_OVER,
    status: 'Match complete — you won.',
  });
});

test('the status line reports the live score and a computer win', () => {
  const { controller } = setup();

  controller.state = { ...controller.state, phase: GAME_PHASE.RUNNING, score: { player: 2, opponent: 5 } };
  assert.equal(controller.statusText(), 'You 2 — 5 Computer');

  controller.state = { ...controller.state, phase: GAME_PHASE.GAME_OVER, score: { player: 2, opponent: 7 } };
  assert.equal(controller.statusText(), 'Match complete — computer won.');
});

test('disconnect stops the loop and releases every adapter', () => {
  const { controller, scheduler, renderer, view, input } = setup();

  view.handler(GAME_COMMAND.START);
  controller.disconnect();

  assert.equal(scheduler.pending.size, 0);
  assert.ok(!renderer.connected && !view.connected && !input.connected);
});
