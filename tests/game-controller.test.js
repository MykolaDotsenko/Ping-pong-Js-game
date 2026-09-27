import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMatchConfig, GameController } from '../src/application/game-controller.js';
import { NICKNAMES } from '../src/application/nicknames.js';
import { GAME_COMMAND } from '../src/application/ports.js';
import { MATCH_CATALOG, RIVALS } from '../src/catalog.js';
import { DIFFICULTY_CONFIGS, GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG } from '../src/config.js';
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
    rival: 0,
    careerStars: [],
    careerLosses: [],
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
    configs: [],
    handle(events, state, config) {
      this.received.push({ types: events.map((event) => event.type), phase: state.phase });
      this.configs.push(config);
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
    rules: GAME_CONFIG.rules,
    opponent: { label: 'CPU', name: 'Computer', proper: false },
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
    modifiers: { player: { wide: 0, tiny: 0, ghost: 0, lag: 0 }, opponent: { wide: 0, tiny: 0, ghost: 0, lag: 0 } },
    stats: DEFAULT_STATS,
    winner: null,
    career: null,
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

test('a command draws the new state as it is, not blended with the frame before it', () => {
  const { controller, scheduler, renderer, view } = setup();

  view.handler(GAME_COMMAND.START);
  inPlay(controller, { ball: { ...ballAtPlayerPaddle, y: 300 } });
  scheduler.flush(1000);
  scheduler.flush(1030);
  view.handler(GAME_COMMAND.RESTART);
  assert.deepEqual(lastOf(renderer.frames).state.ball, controller.state.ball);

  // A frame that comes before the next simulation step blends nothing old into it.
  scheduler.flush(1030);
  assert.deepEqual(lastOf(renderer.frames).state.ball, controller.state.ball);
});

test('Space on the menu sets up a match from the current choices, like the Play button', () => {
  const { controller, input, preferences } = setup();

  preferences.set({ mode: 'rush' });
  input.handler(GAME_COMMAND.PRIMARY);

  assert.strictEqual(controller.config, RUSH_CONFIG);
  assert.equal(controller.state.lives, RUSH_CONFIG.rules.lives);
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
  assert.ok(feedback.configs.every((config) => config === controller.config), 'each with the match\'s tuning');
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

test('a firm hit short of top speed also freezes the picture', () => {
  const { controller, scheduler, view, feedback } = setup();
  const { initialSpeed, maxSpeed } = GAME_CONFIG.ball;

  view.handler(GAME_COMMAND.START);
  // Leaves the paddle at about three quarters of the way from serve speed to top speed.
  inPlay(controller, { ball: { ...ballAtPlayerPaddle, vy: initialSpeed + 0.68 * (maxSpeed - initialSpeed) } });
  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.ok(sawHit(feedback));
  assert.ok(controller.loop.holdSeconds > 0);
});

test('slow motion waits for a fast ball in the last stretch, never during a serve pause', () => {
  const winning = GAME_CONFIG.rules.winningScore;
  const matchPoint = { score: { player: winning - 1, opponent: 0 } };
  const closing = { ...ballAtPlayerPaddle, y: ballAtPlayerPaddle.y - 100, vy: 900 };
  const cases = [
    ['a serve pause', { ...matchPoint, serveCountdown: 1, ball: closing }],
    ['a ball far from the paddle', { ...matchPoint, ball: { ...closing, y: GAME_CONFIG.height * 0.3 } }],
    ['a slow ball', { ...matchPoint, ball: { ...closing, vy: GAME_CONFIG.ball.initialSpeed } }],
  ];

  for (const [name, overrides] of cases) {
    const { controller, scheduler, view } = setup();

    view.handler(GAME_COMMAND.START);
    inPlay(controller, overrides);
    scheduler.flush(1000);
    scheduler.flush(1020);
    assert.equal(controller.loop.timeScale, 1, name);
  }
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

test('during a Rush run the status line counts the lives actually left', () => {
  const { controller, view } = setup({ mode: 'rush' });

  view.handler(GAME_COMMAND.START);
  controller.state = { ...controller.state, lives: 2, hits: { player: 4, opponent: 3 } };

  assert.equal(controller.statusText(), '4 hits, 2 lives left');
});

test('a Rush record is celebrated for that run only', () => {
  const { controller, scheduler, view } = setup({ mode: 'rush', bestRush: 5 });

  view.handler(GAME_COMMAND.START);
  inPlay(controller, {
    lives: 1,
    hits: { player: 9, opponent: 8 },
    ball: { x: 250, y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1, vx: 0, vy: 300, spin: 0 },
  });
  scheduler.flush(1000);
  scheduler.flush(1020);
  assert.equal(controller.presentation().newBestRush, true);

  view.handler(GAME_COMMAND.START);
  assert.equal(controller.presentation().newBestRush, false);
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

test('rallies in Rush and two-player matches do not touch the Solo best rally', () => {
  for (const mode of ['rush', 'duo']) {
    const { controller, scheduler, view, preferences } = setup({ mode, bestRally: 2 });

    view.handler(GAME_COMMAND.START);
    inPlay(controller, { rally: 9, longestRally: 9, ball: ballAtPlayerPaddle });
    scheduler.flush(1000);
    scheduler.flush(1020);

    assert.equal(controller.state.longestRally, 10, mode);
    assert.ok(preferences.writes.every((write) => !('bestRally' in write)), mode);
    assert.equal(lastOf(view.presentations).newBest, false, mode);
  }
});

test('records are read fresh, so a higher one saved by another tab is not overwritten', () => {
  const { controller, scheduler, view, preferences } = setup({ bestRally: 3 });

  view.handler(GAME_COMMAND.START);
  // Meanwhile another tab raised the record to 12.
  preferences.set({ bestRally: 12 });
  preferences.writes.length = 0;
  inPlay(controller, { rally: 3, longestRally: 3, ball: ballAtPlayerPaddle });
  scheduler.flush(1000);
  scheduler.flush(1020);

  assert.deepEqual(preferences.writes, []);
  assert.equal(lastOf(view.presentations).bestRally, 12);
});

test('leaving a Solo match after a point has been played counts as a loss', () => {
  for (const command of [GAME_COMMAND.RESTART, GAME_COMMAND.RESET]) {
    const { controller, view, preferences } = setup({ stats: { matches: 9, wins: 9, streak: 9, bestStreak: 9 } });

    view.handler(GAME_COMMAND.START);
    inPlay(controller, { score: { player: 0, opponent: 6 } });
    view.handler(GAME_COMMAND.TOGGLE_PAUSE);
    view.handler(command);

    assert.deepEqual(preferences.get().stats, { matches: 10, wins: 9, streak: 0, bestStreak: 9 }, command);
  }
});

test('a Solo match left before its first point, or a finished one, is not counted again', () => {
  const { controller, scheduler, view, preferences } = setup();

  view.handler(GAME_COMMAND.START);
  view.handler(GAME_COMMAND.RESTART);
  assert.deepEqual(preferences.get().stats, DEFAULT_STATS, 'no point played yet');

  inPlay(controller, {
    score: { player: 0, opponent: GAME_CONFIG.rules.winningScore - 1 },
    ball: { x: 250, y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1, vx: 0, vy: 300, spin: 0 },
  });
  scheduler.flush(1000);
  scheduler.flush(1020);
  view.handler(GAME_COMMAND.RESTART);

  assert.equal(preferences.get().stats.matches, 1, 'the finished match counts once');
});

test('leaving a Rush run or a two-player match records no Solo statistics', () => {
  for (const mode of ['rush', 'duo']) {
    const { controller, view, preferences } = setup({ mode });

    view.handler(GAME_COMMAND.START);
    inPlay(controller, { score: { player: 2, opponent: 3 } });
    view.handler(GAME_COMMAND.RESET);

    assert.deepEqual(preferences.get().stats, DEFAULT_STATS, mode);
  }
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

test('with the fun extras on, the computer signs in under a nickname for the whole match', () => {
  const { controller, view, input } = setup({ jokes: true });

  const first = controller.presentation().opponent;
  assert.equal(first.proper, true);
  assert.ok(NICKNAMES.includes(first.name), first.name);
  assert.equal(first.label, first.name);

  view.handler(GAME_COMMAND.START);
  controller.state = { ...controller.state, score: { player: 1, opponent: 2 } };
  assert.deepEqual(controller.presentation().opponent, first, 'the same rival all match');
  assert.equal(controller.statusText(), `You 1 — 2 ${first.name}`);

  controller.state = { ...controller.state, phase: GAME_PHASE.GAME_OVER, score: { player: 1, opponent: 7 } };
  assert.equal(controller.statusText(), `Match complete — ${first.name} won.`);

  // Over a run of matches the rival changes: the nickname comes from the seed.
  const seen = new Set([first.name]);
  for (let match = 0; match < 40; match += 1) {
    input.handler(GAME_COMMAND.RESTART);
    seen.add(controller.presentation().opponent.name);
  }
  assert.ok(seen.size >= 5, `saw ${seen.size} nicknames`);
});

test('a second person and the plain computer keep their usual names', () => {
  const duo = setup({ jokes: true, mode: 'duo' });
  assert.deepEqual(duo.controller.presentation().opponent, { label: 'P2', name: 'Player 2', proper: false });

  const plain = setup({ jokes: false });
  assert.deepEqual(plain.controller.presentation().opponent, { label: 'CPU', name: 'Computer', proper: false });
  plain.view.handler(GAME_COMMAND.START);
  assert.equal(plain.controller.statusText(), 'You 0 — 0 Computer');
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

// The career: a ladder of rivals, stars, and rivals that play tired after two wins in a row.

/** Plays the current career match to its last point, won 7 to `conceded` or lost 0 to 7. */
function finishCareerMatch({ controller, scheduler }, { won, conceded = 0 }) {
  inPlay(controller, won
    ? { score: { player: 6, opponent: conceded }, ball: { x: 250, y: -GAME_CONFIG.ball.radius - 1, vx: 0, vy: -300, spin: 0 } }
    : { score: { player: 0, opponent: 6 }, ball: { x: 250, y: GAME_CONFIG.height + GAME_CONFIG.ball.radius + 1, vx: 0, vy: 300, spin: 0 } });
  scheduler.flush(1000);
  scheduler.flush(1020);
}

test('a career match is built from the chosen rival, which plays tired after beating the player twice', () => {
  const choose = (choices) => buildMatchConfig(MATCH_CATALOG, { mode: 'career', difficulty: 'hard', powerUps: false, ...choices });

  assert.strictEqual(choose({ rival: 3 }), RIVALS[3].config);
  assert.strictEqual(choose({}), RIVALS[0].config);
  assert.strictEqual(choose({ rival: 99 }), RIVALS[0].config);
  assert.strictEqual(choose({ rival: 3, losses: 1 }), RIVALS[3].config);
  assert.ok(choose({ rival: 3, losses: 2 }).opponent.maxSpeed < RIVALS[3].config.opponent.maxSpeed);
});

test('the career menu names the rival and shows where the player stands on the ladder', () => {
  const { controller, renderer, view } = setup({ mode: 'career', rival: 1, careerStars: [3], careerLosses: [0, 2] });
  const presentation = lastOf(view.presentations);

  assert.strictEqual(lastOf(renderer.frames).config.opponent.maxSpeed, RIVALS[1].config.opponent.maxSpeed * 0.9, 'tired');
  assert.deepEqual(presentation.opponent, { label: 'Halyna', name: 'Aunt Halyna', proper: true });
  assert.equal(presentation.status, 'Career, 2 of 9: Aunt Halyna. First to 7.');
  assert.deepEqual(presentation.career, {
    index: 1,
    count: 9,
    unlocked: 1,
    rival: { name: 'Aunt Halyna', short: 'Halyna', story: RIVALS[1].story, boss: false },
    stars: 0,
    earned: 0,
    eased: true,
    next: null,
    totalStars: 3,
    beaten: 1,
  });
  assert.equal(controller.presentation().rules, RIVALS[1].config.rules);
});

test('the ladder stays closed past the first rival not yet beaten', () => {
  const { view } = setup({ mode: 'career', rival: 7, careerStars: [2, 1] });

  assert.equal(lastOf(view.presentations).career.index, 2);
  assert.equal(lastOf(view.presentations).opponent.name, RIVALS[2].name);
});

test('a career win earns stars, keeps the best, and moves the ladder on to the next rival', () => {
  const context = setup({ mode: 'career', rival: 0, careerStars: [1], careerLosses: [1] });

  context.view.handler(GAME_COMMAND.START);
  finishCareerMatch(context, { won: true, conceded: 1 });

  assert.deepEqual(lastOf(context.preferences.writes), {
    careerStars: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    careerLosses: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    rival: 1,
  });

  const result = lastOf(context.view.presentations);
  assert.equal(result.status, 'Match complete — you won.');
  assert.equal(result.career.earned, 3);
  assert.equal(result.career.next, 'Aunt Halyna');
  assert.equal(result.career.index, 0, 'the result is about the match just played');

  // Play again takes on the next rival.
  context.view.handler(GAME_COMMAND.START);
  assert.equal(lastOf(context.view.presentations).opponent.name, 'Aunt Halyna');
  assert.equal(lastOf(context.view.presentations).career.next, null);
});

test('a career loss earns nothing, counts toward a tired rival, and keeps the rival', () => {
  const context = setup({ mode: 'career', rival: 1, careerStars: [2], careerLosses: [0, 1] });

  context.view.handler(GAME_COMMAND.START);
  finishCareerMatch(context, { won: false });

  assert.deepEqual(lastOf(context.preferences.writes), {
    careerStars: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    careerLosses: [0, 2, 0, 0, 0, 0, 0, 0, 0],
    rival: 1,
  });
  assert.equal(lastOf(context.view.presentations).status, 'Match complete — Aunt Halyna won.');
  assert.equal(lastOf(context.view.presentations).career.eased, true);
  assert.equal(lastOf(context.view.presentations).career.next, null);

  // The next match is against the same rival, now tired.
  context.view.handler(GAME_COMMAND.START);
  assert.equal(context.controller.config.opponent.maxSpeed, RIVALS[1].config.opponent.maxSpeed * 0.9);
});

test('a replayed win keeps the better stars, and beating the final boss leaves it chosen', () => {
  const beaten = [3, 3, 3, 3, 3, 3, 3, 3, 1];
  const context = setup({ mode: 'career', rival: 8, careerStars: beaten });

  context.view.handler(GAME_COMMAND.START);
  finishCareerMatch(context, { won: true, conceded: 5 });

  assert.deepEqual(lastOf(context.preferences.writes).careerStars, beaten, 'one star does not replace a better result');
  assert.equal(lastOf(context.preferences.writes).rival, 8);
  assert.equal(lastOf(context.view.presentations).career.next, null);
});

test('the career keeps its own records: no Solo streak, no best rally, and leaving costs nothing', () => {
  const context = setup({ mode: 'career', stats: { matches: 3, wins: 3, streak: 3, bestStreak: 3 }, bestRally: 2 });

  context.view.handler(GAME_COMMAND.START);
  inPlay(context.controller, { score: { player: 2, opponent: 3 }, rally: 9, longestRally: 9 });
  context.scheduler.flush(1000);
  context.view.handler(GAME_COMMAND.RESET);

  assert.deepEqual(context.preferences.get().stats, { matches: 3, wins: 3, streak: 3, bestStreak: 3 });
  assert.equal(context.preferences.get().bestRally, 2);
  assert.deepEqual(context.preferences.get().careerLosses, []);
});

test('in a career match the Fun switch never renames the rival', () => {
  const { view } = setup({ mode: 'career', jokes: true, rival: 0 });

  assert.deepEqual(lastOf(view.presentations).opponent, { label: 'Roma', name: 'Rookie Roma', proper: true });
});
