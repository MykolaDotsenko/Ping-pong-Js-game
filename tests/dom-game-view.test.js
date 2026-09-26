import test from 'node:test';
import assert from 'node:assert/strict';

import { DomGameView } from '../src/adapters/dom-game-view.js';
import { GAME_COMMAND } from '../src/application/ports.js';
import { GAME_PHASE } from '../src/domain/game.js';

// A small stand-in for the DOM: elements with attributes, found by [name] or [name="value"].
class FakeElement extends EventTarget {
  constructor(attributes = {}) {
    super();
    this.attributes = new Map(Object.entries(attributes));
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.offsetWidth = 100;
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
    };

    for (const [name, value] of this.attributes) {
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        this.dataset[key] = value;
      }
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, '');
    else this.attributes.delete(name);
  }

  matches(selector) {
    const [, name, value] = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) ?? [];
    return this.attributes.has(name) && (value === undefined || this.attributes.get(name) === value);
  }
}

function createRoot() {
  const elements = [
    ['status', { 'data-game-status': '' }],
    ['playerScore', { 'data-score': 'player' }],
    ['opponentScore', { 'data-score': 'opponent' }],
    ['menu', { 'data-overlay': 'menu' }],
    ['pause', { 'data-overlay': 'pause' }],
    ['over', { 'data-overlay': 'over' }],
    ['hudPause', { 'data-hud-pause': '', 'data-command': 'toggle-pause' }],
    ['hudSound', { 'data-setting': 'sound' }],
    ['menuSound', { 'data-setting': 'sound' }],
    ['vibration', { 'data-setting': 'vibration' }],
    ['easy', { 'data-difficulty': 'easy' }],
    ['normal', { 'data-difficulty': 'normal' }],
    ['hard', { 'data-difficulty': 'hard' }],
    ['play', { 'data-command': 'start' }],
    ['resume', { 'data-command': 'toggle-pause' }],
    ['restart', { 'data-command': 'restart' }],
    ['menuButton', { 'data-command': 'reset' }],
    ['bogus', { 'data-command': 'self-destruct' }],
    ['bestRally', { 'data-best-rally': '' }],
    ['overTitle', { 'data-over-title': '' }],
    ['overScore', { 'data-over-score': '' }],
    ['overRally', { 'data-over-rally': '' }],
    ['overDifficulty', { 'data-over-difficulty': '' }],
    ['overBest', { 'data-over-best': '' }],
  ].map(([name, attributes]) => [name, new FakeElement(attributes)]);
  const byName = Object.fromEntries(elements);
  const all = elements.map(([, element]) => element);

  return {
    ...byName,
    root: {
      dataset: {},
      scrolls: [],
      scrollIntoView(options) {
        this.scrolls.push(options);
      },
      querySelector: (selector) => all.find((element) => element.matches(selector)) ?? null,
      querySelectorAll: (selector) => all.filter((element) => element.matches(selector)),
    },
  };
}

function createPreferences(initial = {}) {
  let values = { difficulty: 'normal', sound: true, vibration: true, bestRally: 0, ...initial };
  return {
    get: () => values,
    set(changes) {
      values = { ...values, ...changes };
    },
  };
}

function setup({ canVibrate = true, preferences = createPreferences() } = {}) {
  const dom = createRoot();
  const board = {
    focusCalls: [],
    focus(options) {
      this.focusCalls.push(options);
    },
  };
  const view = new DomGameView({ root: dom.root, board, preferences, canVibrate });
  const commands = [];

  view.onCommand((command) => commands.push({ command, focusedBefore: board.focusCalls.length }));
  view.connect();

  return { view, dom, board, commands, preferences };
}

const click = (element) => element.dispatchEvent(new Event('click'));

function presentation(overrides = {}) {
  return {
    phase: GAME_PHASE.READY,
    status: 'First to 7. Start when ready.',
    score: { player: 0, opponent: 0 },
    rally: 0,
    longestRally: 0,
    bestRally: 0,
    newBest: false,
    winner: null,
    ...overrides,
  };
}

test('a command button brings the whole court into view', () => {
  const { dom } = setup();

  click(dom.play);

  assert.deepEqual(dom.root.scrolls, [{ block: 'nearest' }]);
});

test('command buttons hand focus back to the board before sending their command', () => {
  const { dom, board, commands } = setup();

  click(dom.play);
  click(dom.hudPause);
  click(dom.restart);
  click(dom.menuButton);
  click(dom.bogus);

  assert.deepEqual(commands, [
    { command: GAME_COMMAND.START, focusedBefore: 1 },
    { command: GAME_COMMAND.TOGGLE_PAUSE, focusedBefore: 2 },
    { command: GAME_COMMAND.RESTART, focusedBefore: 3 },
    { command: GAME_COMMAND.RESET, focusedBefore: 4 },
  ]);
  assert.deepEqual(board.focusCalls[0], { preventScroll: true });
});

test('overlays and the pause button follow the match phase', () => {
  const { view, dom } = setup();
  const visible = () => ['menu', 'pause', 'over'].filter((name) => !dom[name].hidden);

  view.render(presentation());
  assert.deepEqual(visible(), ['menu']);
  assert.equal(dom.root.dataset.phase, 'ready');
  assert.ok(dom.hudPause.attributes.has('disabled'));

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  assert.deepEqual(visible(), []);
  assert.ok(!dom.hudPause.attributes.has('disabled'));
  assert.equal(dom.hudPause.getAttribute('aria-label'), 'Pause');

  view.render(presentation({ phase: GAME_PHASE.PAUSED }));
  assert.deepEqual(visible(), ['pause']);
  assert.equal(dom.hudPause.getAttribute('aria-label'), 'Resume');

  view.render(presentation({ phase: GAME_PHASE.GAME_OVER, winner: 'player' }));
  assert.deepEqual(visible(), ['over']);
  assert.ok(dom.hudPause.attributes.has('disabled'));
});

test('difficulty buttons choose the next match and show the choice', () => {
  const { dom, preferences } = setup();
  const pressed = () => ['easy', 'normal', 'hard'].filter((level) => dom[level].getAttribute('aria-pressed') === 'true');

  assert.deepEqual(pressed(), ['normal']);

  click(dom.hard);

  assert.equal(preferences.get().difficulty, 'hard');
  assert.deepEqual(pressed(), ['hard']);
});

test('setting toggles flip the preference and every matching switch', () => {
  const { dom, preferences } = setup();

  click(dom.hudSound);

  assert.equal(preferences.get().sound, false);
  assert.equal(dom.hudSound.getAttribute('aria-pressed'), 'false');
  assert.equal(dom.menuSound.getAttribute('aria-pressed'), 'false');

  click(dom.vibration);
  assert.equal(preferences.get().vibration, false);
});

test('the vibration switch is hidden where the device cannot vibrate', () => {
  assert.equal(setup({ canVibrate: false }).dom.vibration.hidden, true);
  assert.equal(setup({ canVibrate: true }).dom.vibration.hidden, false);
});

test('an unchanged status is not rewritten, keeping the live region quiet', () => {
  const { view, dom } = setup();
  let writes = 0;
  let text = '';
  Object.defineProperty(dom.status, 'textContent', {
    get: () => text,
    set: (value) => {
      writes += 1;
      text = value;
    },
  });

  for (let frame = 0; frame < 3; frame += 1) {
    view.render(presentation({ phase: GAME_PHASE.RUNNING, status: 'You 0 — 0 Computer' }));
  }
  view.render(presentation({ phase: GAME_PHASE.RUNNING, status: 'You 1 — 0 Computer' }));

  assert.equal(writes, 2);
  assert.equal(text, 'You 1 — 0 Computer');
});

test('a new point updates the scoreboard with a pop', () => {
  const { view, dom } = setup();

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  assert.equal(dom.playerScore.classes.has('is-popping'), false);

  view.render(presentation({ phase: GAME_PHASE.RUNNING, score: { player: 1, opponent: 0 } }));

  assert.equal(dom.playerScore.textContent, '1');
  assert.ok(dom.playerScore.classes.has('is-popping'));
  assert.equal(dom.opponentScore.classes.has('is-popping'), false);
});

test('the result screen shows the winner, score, rally, difficulty and a new record', () => {
  const { view, dom } = setup({ preferences: createPreferences({ difficulty: 'hard' }) });

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  view.render(presentation({
    phase: GAME_PHASE.GAME_OVER,
    score: { player: 7, opponent: 5 },
    longestRally: 12,
    bestRally: 12,
    newBest: true,
    winner: 'player',
  }));

  assert.equal(dom.overTitle.textContent, 'Victory');
  assert.equal(dom.overTitle.dataset.winner, 'player');
  assert.equal(dom.overScore.textContent, '7 : 5');
  assert.equal(dom.overRally.textContent, '12');
  assert.equal(dom.overDifficulty.textContent, 'Hard');
  assert.equal(dom.overBest.hidden, false);
  assert.equal(dom.bestRally.textContent, '12');

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  view.render(presentation({ phase: GAME_PHASE.GAME_OVER, score: { player: 2, opponent: 7 }, winner: 'opponent' }));
  assert.equal(dom.overTitle.textContent, 'Defeat');
  assert.equal(dom.overBest.hidden, true);
});

test('disconnect unbinds every control', () => {
  const { view, dom, commands, preferences } = setup();

  view.disconnect();
  click(dom.play);
  click(dom.hard);

  assert.deepEqual(commands, []);
  assert.equal(preferences.get().difficulty, 'normal');
});

test('a missing element is reported by name', () => {
  const { root } = createRoot();
  const incomplete = { ...root, querySelector: (selector) => (selector === '[data-game-status]' ? null : root.querySelector(selector)) };

  assert.throws(
    () => new DomGameView({ root: incomplete, board: { focus() {} }, preferences: createPreferences(), canVibrate: true }),
    /\[data-game-status\] is missing/,
  );
});
