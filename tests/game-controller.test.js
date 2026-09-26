import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMatchConfig, GameController } from '../src/application/game-controller.js';
import { GAME_COMMAND } from '../src/application/ports.js';
import { DIFFICULTY_CONFIGS, GAME_CONFIG, MATCH_CATALOG, RUSH_CONFIG, TWO_PLAYER_CONFIG } from '../src/config.js';
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

const DEFAULT_STATS = { matches: 0, wins: 0, streak: 0, bestStreak: 0 };

function createPreferences(initial = {}) {
  let values = {
    mode: 'solo',
    difficulty: 'normal',
    powerUps: true,
    sound: true,
    music: true,
    vibration: true,
    tutorialSeen: true,
    bestRally: 0,
    bestRush: 0,
    stats: DEFAULT_STATS,
    ...initial,
  };

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
    render(state, config) {
      this.frames.push({ state, config });
    },
  });
  const view = createPort({
    presentations: [],
    render(presentation) {
      this.presentations.push(presentation);
    },
  });
  const input = createPort({
    current: { horizontalAxis: 0, pointerX: null, opponentAxis: 0, opponentPointerX: null },
    layouts: [],
    configure(layout) {
      this.layouts.push(layout);
    },
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
  let nextSeed = 100;
  const controller = new GameController({
    catalog: MATCH_CATALOG,
    preferences,
    renderer,
    input,
    view,
    scheduler,
    feedback: [feedback],
    seed: () => nextSeed++,
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

// Puts the ball in play, skipping the serve pause, with power-ups out of the way.
function inPlay(controller, overrides = {}) {
  controller.state = { ...controller.state, serveCountdown: 0, nextPickupIn: 999, ...overrides };
  controller.previousState = controller.state;
}

test('buildMatchConfig picks the tuning for the chosen mode, difficulty and options', () => {
  const choose = (choices) => buildMatchConfig(MATCH_CATALOG, { mode: 'solo', difficulty: 'normal', powerUps: true, ...choices });

  assert.strictEqual(choose({}), GAME_CONFIG);
  assert.strictEqual(choose({ difficulty: 'hard' }), DIFFICULTY_CONFIGS.hard);
  assert.strictEqual(choose({ difficulty: 'nonsense' }), GAME_CONFIG);
  assert.strictEqual(choose({ mode: 'rush', powerUps: true }), RUSH_CONFIG);
  assert.strictEqual(choose({ mode: 'duo' }), TWO_PLAYER_CONFIG);

  const quiet = choose({ powerUps: false });
  assert.equal(quiet.powerUps.enabled, false);
  assert.equal(quiet.ball, GAME_CONFIG.ball);
});

test('connecting draws the ready screen, sets up one player, and leaves the loop idle', () => {
  const { scheduler, renderer, view, input } = setup();

  assert.ok(renderer.connected && view.connected && input.connected);
  assert.equal(renderer.frames.length, 1);
  assert.strictEqual(renderer.frames[0].config, GAME_CONFIG);
  assert.deepEqual(input.layouts, [{ players: 1 }]);
  assert.deepEqual(lastOf(view.presentations), {
    phase: GAME_PHASE.READY,
    mode: 'solo',
    difficulty: 'normal',
    status: 'First to 7. Start when ready.',
    score: { player: 0, opponent: 0 },
    hits: { player: 0, opponent: 0 },
    lives: 0,
    maxLives: 0,
    rally: 0,
    longestRally: 0,
    bestRally: 0,
    newBest: false,
    bestRush: 0,
    newBestRush: false,
    matchPoint: null,
    modifiers: { player: { wide: 0, tiny: 0, ghost: 0 }, opponent: { wide: 0, tiny: 0, ghost: 0 } },
    stats: DEFAULT_STATS,
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

test('every match gets a fresh seed', () => {
  const { controller, view } = setup();

  view.handler(GAME_COMMAND.START);
  const first = controller.state.seed;
  view.handler(GAME_COMMAND.RESTART);

  assert.notEqual(controller.state.seed, first);
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

test('a new match uses the mode and difficulty chosen in the preferences at that moment', () => {
  const { controller, view, input, preferences } = setup({ difficulty: 'easy' });

  assert.strictEqual(controller.config, DIFFICULTY_CONFIGS.easy);

  preferences.set({ difficulty: 'hard' });
  view.handler(GAME_COMMAND.START);
  assert.strictEqual(controller.config, DIFFICULTY_CONFIGS.hard);

  // Changing it mid-match waits for the next match.
  preferences.set({ mode: 'duo' });
  view.handler(GAME_COMMAND.TOGGLE_PAUSE);
  view.handler(GAME_COMMAND.START);
  assert.strictEqual(controller.config, DIFFICULTY_CONFIGS.hard);
  assert.deepEqual(lastOf(input.layouts), { players: 1 });

  // Going back to the menu applies the new mode right away, so the menu shows the right layout.
  view.handler(GAME_COMMAND.RESET);
  assert.strictEqual(controller.config, TWO_PLAYER_CONFIG);
  assert.equal(lastOf(view.presentations).mode, 'duo');
  assert.deepEqual(lastOf(input.layouts), { players: 2 });
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

  const frame = lastOf(renderer.frames).state;
  const expectedY = (controller.previousState.ball.y + controller.state.ball.y) / 2;

  assert.notEqual(controller.previousState, controller.state);
  assert.ok(Math.abs(frame.ball.y - expectedY) < 1e-9);
});

// A frame may run several steps; the hit lands on the first, so check the feedback log
// rather than the events of whichever step came last.
const sawHit = (feedback) => feedback.received.some((entry) => entry.types.includes('paddle-hit'));

test('a hard hit freezes the picture for an instant', () => {
  const { controller, scheduler, view, feedback } = setup();

  view.handler(GAME_COMMAND.START);
  inPlay(controller, { ball: { ...ballAtPlayerPaddle, vy: GAME_CONFIG.ball.maxSpeed } });
  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.ok(sawHit(feedback));
  assert.ok(controller.loop.holdSeconds > 0);
});

test('a soft hit does not freeze the picture', () => {
  const { controller, scheduler, view, feedback } = setup();

  view.handler(GAME_COMMAND.START);
  inPlay(controller, { ball: ballAtPlayerPaddle });
  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.ok(sawHit(feedback));
  assert.equal(controller.loop.holdSeconds, 0);
});

test('a fast ball closing on a paddle at match point plays in slow motion', () => {
  const { controller, scheduler, view } = setup();
  const winning = GAME_CONFIG.rules.winningScore;

  view.handler(GAME_COMMAND.START);
  inPlay(controller, {
    score: { player: winning - 1, opponent: 0 },
    ball: { ...ballAtPlayerPaddle, y: ballAtPlayerPaddle.y - 100, vy: 900 },
  });
  scheduler.flush(1000);
  scheduler.flush(1020);
  assert.ok(controller.loop.timeScale < 1);

  // Nothing dramatic about the same ball in an ordinary rally.
  inPlay(controller, { score: { player: 0, opponent: 0 }, ball: { ...ballAtPlayerPaddle, y: ballAtPlayerPaddle.y - 100, vy: 900 } });
  scheduler.flush(1040);
  assert.equal(controller.loop.timeScale, 1);
});

test('the winning point shows the final frame, stops the loop, and records a Solo win', () => {
  const { controller, scheduler, renderer, view, feedback, preferences } = setup({ stats: { matches: 2, wins: 1, streak: 1, bestStreak: 1 } });

  view.handler(GAME_COMMAND.START);
  inPlay(controller, {
    score: { player: GAME_CONFIG.rules.winningScore - 1, opponent: 0 },
    ball: { x: 250, y: -GAME_CONFIG.ball.radius - 1, vx: 0, vy: -300, spin: 0 },
  });

  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.equal(controller.state.phase, GAME_PHASE.GAME_OVER);
  assert.equal(scheduler.pending.size, 0);
  assert.strictEqual(lastOf(renderer.frames).state, controller.state);
  assert.deepEqual(lastOf(feedback.received).types, ['point', 'game-over']);
  assert.deepEqual(lastOf(preferences.writes), { stats: { matches: 3, wins: 2, streak: 2, bestStreak: 2 } });

  const presentation = lastOf(view.presentations);
  assert.equal(presentation.status, 'Match complete — you won.');
  assert.equal(presentation.winner, 'player');
  assert.deepEqual(presentation.stats, { matches: 3, wins: 2, streak: 2, bestStreak: 2 });
});

test('a lost Solo match resets the streak but keeps the best one', () => {
  const { controller, scheduler, view, preferences } = setup({ stats: { matches: 4, wins: 3, streak: 3, bestStreak: 3 } });

  view.handler(GAME_COMMAND.START);
  inPlay(controller, {
    score: { player: 0, opponent: GAME_CONFIG.rules.winningScore - 1 },
    ball: { x: 250, y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1, vx: 0, vy: 300, spin: 0 },
  });
  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.deepEqual(lastOf(preferences.writes), { stats: { matches: 5, wins: 3, streak: 0, bestStreak: 3 } });
  assert.equal(lastOf(view.presentations).status, 'Match complete — computer won.');
});

test('a Rush run ends when the lives run out and records the hit count', () => {
  const { controller, scheduler, view, preferences } = setup({ mode: 'rush', bestRush: 5 });

  assert.strictEqual(controller.config, RUSH_CONFIG);
  view.handler(GAME_COMMAND.START);
  assert.equal(lastOf(view.presentations).maxLives, RUSH_CONFIG.rules.lives);

  inPlay(controller, {
    lives: 1,
    hits: { player: 9, opponent: 8 },
    ball: { x: 250, y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1, vx: 0, vy: 300, spin: 0 },
  });
  scheduler.flush(1000);
  scheduler.flush(1020);

  const presentation = lastOf(view.presentations);
  assert.equal(controller.state.phase, GAME_PHASE.GAME_OVER);
  assert.equal(presentation.status, 'Run over — 9 hits.');
  assert.equal(presentation.bestRush, 9);
  assert.equal(presentation.newBestRush, true);
  assert.equal(presentation.stats.matches, 0);
  assert.deepEqual(lastOf(preferences.writes), { bestRush: 9 });
});

test('a two-player match names the second player and keeps Solo statistics untouched', () => {
  const { controller, scheduler, view, input, preferences } = setup({ mode: 'duo' });

  assert.deepEqual(input.layouts, [{ players: 2 }]);
  view.handler(GAME_COMMAND.START);
  assert.equal(lastOf(view.presentations).status, 'You 0 — 0 Player 2');

  inPlay(controller, {
    score: { player: 0, opponent: GAME_CONFIG.rules.winningScore - 1 },
    ball: { x: 250, y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1, vx: 0, vy: 300, spin: 0 },
  });
  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.equal(lastOf(view.presentations).status, 'Match complete — player 2 won.');
  assert.ok(preferences.writes.every((write) => !('stats' in write)));
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

test('the status line reports the live score, match point, and a Rush run', () => {
  const { controller } = setup();

  controller.state = { ...controller.state, phase: GAME_PHASE.RUNNING, score: { player: 2, opponent: 5 } };
  assert.equal(controller.statusText(), 'You 2 — 5 Computer');
  assert.equal(controller.presentation().matchPoint, null);

  controller.state = { ...controller.state, score: { player: 6, opponent: 5 } };
  assert.equal(controller.presentation().matchPoint, 'player');

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
