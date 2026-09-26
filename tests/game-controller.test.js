import test from 'node:test';
import assert from 'node:assert/strict';

import { GameController } from '../src/application/game-controller.js';
import { GAME_COMMAND } from '../src/application/ports.js';
import { DIFFICULTY_CONFIGS, GAME_CONFIG } from '../src/config.js';
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

function createPreferences(initial = {}) {
  let values = { difficulty: 'normal', sound: true, vibration: true, bestRally: 0, ...initial };

  return {
    writes: [],
    get: () => values,
    set(changes) {
      this.writes.push(changes);
      values = { ...values, ...changes };
    },
  };
}

function setup(preferenceValues) {
  const scheduler = createFrameScheduler();
  const preferences = createPreferences(preferenceValues);
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
  const feedback = {
    received: [],
    handle(events, state) {
      this.received.push({ types: events.map((event) => event.type), phase: state.phase });
    },
  };
  const controller = new GameController({
    configs: DIFFICULTY_CONFIGS,
    preferences,
    renderer,
    input,
    view,
    scheduler,
    feedback: [feedback],
  });
  controller.connect();

  return { controller, scheduler, renderer, view, input, feedback, preferences };
}

const lastOf = (items) => items[items.length - 1];

// A ball a few units above the player's paddle, about to be returned.
const ballAtPlayerPaddle = {
  x: GAME_CONFIG.width / 2,
  y: GAME_CONFIG.height - GAME_CONFIG.paddle.inset - GAME_CONFIG.paddle.height - GAME_CONFIG.ball.radius - 3,
  vx: 0,
  vy: 400,
  spin: 0,
};

// Puts the ball in play, skipping the serve pause.
function inPlay(controller, overrides = {}) {
  controller.state = { ...controller.state, serveCountdown: 0, ...overrides };
  controller.previousState = controller.state;
}

test('connecting draws the ready screen and leaves the loop idle', () => {
  const { scheduler, renderer, view, input } = setup();

  assert.ok(renderer.connected && view.connected && input.connected);
  assert.equal(renderer.frames.length, 1);
  assert.deepEqual(lastOf(view.presentations), {
    phase: GAME_PHASE.READY,
    status: 'First to 7. Start when ready.',
    score: { player: 0, opponent: 0 },
    rally: 0,
    longestRally: 0,
    bestRally: 0,
    newBest: false,
    winner: null,
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

test('restart abandons the current match for a fresh one', () => {
  const { controller, view, scheduler } = setup();

  view.handler(GAME_COMMAND.START);
  controller.state = { ...controller.state, score: { player: 3, opponent: 5 } };
  view.handler(GAME_COMMAND.TOGGLE_PAUSE);
  view.handler(GAME_COMMAND.RESTART);

  assert.equal(controller.state.phase, GAME_PHASE.RUNNING);
  assert.deepEqual(controller.state.score, { player: 0, opponent: 0 });
  assert.equal(scheduler.pending.size, 1);
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

test('a new match uses the difficulty chosen in the preferences at that moment', () => {
  const { controller, view, preferences } = setup({ difficulty: 'easy' });

  assert.strictEqual(controller.config, DIFFICULTY_CONFIGS.easy);

  preferences.set({ difficulty: 'hard' });
  view.handler(GAME_COMMAND.START);
  assert.strictEqual(controller.config, DIFFICULTY_CONFIGS.hard);

  // Changing it mid-match waits for the next match.
  preferences.set({ difficulty: 'easy' });
  view.handler(GAME_COMMAND.TOGGLE_PAUSE);
  view.handler(GAME_COMMAND.START);
  assert.strictEqual(controller.config, DIFFICULTY_CONFIGS.hard);
});

test('an unknown stored difficulty falls back to normal', () => {
  const { controller } = setup({ difficulty: 'impossible' });

  assert.strictEqual(controller.config, GAME_CONFIG);
});

test('events reach every feedback adapter once, from commands and from simulation steps', () => {
  const { controller, scheduler, view, feedback } = setup();

  view.handler(GAME_COMMAND.START);
  inPlay(controller, { ball: ballAtPlayerPaddle });
  scheduler.flush(1000);
  scheduler.flush(1020);
  view.handler(GAME_COMMAND.TOGGLE_PAUSE);

  assert.deepEqual(feedback.received, [
    { types: ['match-start'], phase: GAME_PHASE.RUNNING },
    { types: ['paddle-hit'], phase: GAME_PHASE.RUNNING },
    { types: ['paused'], phase: GAME_PHASE.PAUSED },
  ]);
});

test('frames blend the last two simulation steps', () => {
  const { controller, scheduler, renderer, view } = setup();

  view.handler(GAME_COMMAND.START);
  inPlay(controller);
  scheduler.flush(1000);
  scheduler.flush(1000 + GAME_CONFIG.fixedStepSeconds * 1500);

  const frame = lastOf(renderer.frames);
  const expectedY = (controller.previousState.ball.y + controller.state.ball.y) / 2;

  assert.notEqual(controller.previousState, controller.state);
  assert.ok(Math.abs(frame.ball.y - expectedY) < 1e-9);
});

test('the winning point shows the final frame and stops the loop', () => {
  const { controller, scheduler, renderer, view, feedback } = setup();

  view.handler(GAME_COMMAND.START);
  inPlay(controller, {
    score: { player: GAME_CONFIG.winningScore - 1, opponent: 0 },
    ball: { x: 250, y: -GAME_CONFIG.ball.radius - 1, vx: 0, vy: -300, spin: 0 },
  });

  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.equal(controller.state.phase, GAME_PHASE.GAME_OVER);
  assert.equal(scheduler.pending.size, 0);
  assert.strictEqual(lastOf(renderer.frames), controller.state);
  assert.deepEqual(lastOf(feedback.received).types, ['point', 'game-over']);
  assert.deepEqual(lastOf(view.presentations), {
    phase: GAME_PHASE.GAME_OVER,
    status: 'Match complete — you won.',
    score: { player: GAME_CONFIG.winningScore, opponent: 0 },
    rally: 0,
    longestRally: 0,
    bestRally: 0,
    newBest: false,
    winner: 'player',
  });
});

test('a longer rally than ever before is remembered and flagged for this match', () => {
  const { controller, scheduler, view, preferences } = setup({ bestRally: 3 });

  view.handler(GAME_COMMAND.START);
  inPlay(controller, { rally: 3, longestRally: 3, ball: ballAtPlayerPaddle });
  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.deepEqual(preferences.writes, [{ bestRally: 4 }]);
  assert.equal(lastOf(view.presentations).bestRally, 4);
  assert.equal(lastOf(view.presentations).newBest, true);

  view.handler(GAME_COMMAND.RESTART);
  assert.equal(lastOf(view.presentations).newBest, false);
  assert.equal(lastOf(view.presentations).bestRally, 4);
});

test('a short first rally is saved as the record without being celebrated', () => {
  const { controller, scheduler, view, preferences } = setup();

  view.handler(GAME_COMMAND.START);
  inPlay(controller, { ball: ballAtPlayerPaddle });
  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.deepEqual(preferences.writes, [{ bestRally: 1 }]);
  assert.equal(lastOf(view.presentations).bestRally, 1);
  assert.equal(lastOf(view.presentations).newBest, false);
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
