import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTick } from 'node:timers/promises';

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
    this.innerHTML = '';
    this.offsetWidth = 100;
    this.children = [];
    this.ownerDocument = { createElement: () => new FakeElement() };
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

  set className(value) {
    this.classes = new Set(value.split(' '));
  }

  get className() {
    return [...this.classes].join(' ');
  }

  appendChild(child) {
    this.children.push(child);
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
    ['playerLabel', { 'data-label': 'player' }],
    ['opponentLabel', { 'data-label': 'opponent' }],
    ['lives', { 'data-lives': '' }],
    ['matchPoint', { 'data-match-point': '' }],
    ['menu', { 'data-overlay': 'menu' }],
    ['tutorial', { 'data-overlay': 'tutorial' }],
    ['pause', { 'data-overlay': 'pause' }],
    ['over', { 'data-overlay': 'over' }],
    ['hudPause', { 'data-hud-pause': '', 'data-command': 'toggle-pause' }],
    ['fullscreen', { 'data-fullscreen': '' }],
    ['hudSound', { 'data-setting': 'sound' }],
    ['menuSound', { 'data-setting': 'sound' }],
    ['music', { 'data-setting': 'music' }],
    ['powerUps', { 'data-setting': 'powerUps', 'data-not-rush': '' }],
    ['vibration', { 'data-setting': 'vibration' }],
    ['solo', { 'data-mode': 'solo' }],
    ['rush', { 'data-mode': 'rush' }],
    ['duo', { 'data-mode': 'duo' }],
    ['difficultyGroup', { 'data-solo-only': '' }],
    ['easy', { 'data-difficulty': 'easy' }],
    ['normal', { 'data-difficulty': 'normal' }],
    ['hard', { 'data-difficulty': 'hard' }],
    ['play', { 'data-command': 'start' }],
    ['resume', { 'data-command': 'toggle-pause' }],
    ['restart', { 'data-command': 'restart' }],
    ['menuButton', { 'data-command': 'reset' }],
    ['bogus', { 'data-command': 'self-destruct' }],
    ['menuMeta', { 'data-menu-meta': '' }],
    ['stats', { 'data-stats': '' }],
    ['modeTip', { 'data-mode-tip': '' }],
    ['showTutorial', { 'data-show-tutorial': '' }],
    ['dismissTutorial', { 'data-dismiss-tutorial': '' }],
    ['share', { 'data-share': '' }],
    ['shareNote', { 'data-share-note': '' }],
    ['overTitle', { 'data-over-title': '' }],
    ['overScore', { 'data-over-score': '' }],
    ['overRally', { 'data-over-rally': '' }],
    ['overDifficulty', { 'data-over-difficulty': '' }],
    ['overBest', { 'data-over-best': '' }],
    ['overBestRush', { 'data-over-best-rush': '' }],
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
    get: () => values,
    set(changes) {
      values = { ...values, ...changes };
    },
  };
}

function createDevice(overrides = {}) {
  return {
    canShare: true,
    canFullscreen: true,
    shared: [],
    fullscreenToggles: 0,
    async share(text) {
      this.shared.push(text);
      return 'shared';
    },
    async toggleFullscreen() {
      this.fullscreenToggles += 1;
    },
    ...overrides,
  };
}

function setup({ canVibrate = true, preferences = createPreferences(), device = createDevice() } = {}) {
  const dom = createRoot();
  const board = {
    focusCalls: [],
    focus(options) {
      this.focusCalls.push(options);
    },
  };
  const view = new DomGameView({ root: dom.root, board, preferences, canVibrate, device });
  const commands = [];

  view.onCommand((command) => commands.push({ command, focusedBefore: board.focusCalls.length }));
  view.connect();

  return { view, dom, board, commands, preferences, device };
}

const click = (element) => element.dispatchEvent(new Event('click'));
const noModifiers = { wide: 0, tiny: 0, ghost: 0 };

function presentation(overrides = {}) {
  return {
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
    modifiers: { player: noModifiers, opponent: noModifiers },
    stats: DEFAULT_STATS,
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
  const visible = () => ['menu', 'tutorial', 'pause', 'over'].filter((name) => !dom[name].hidden);

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

test('mode buttons choose the next match, show the right options, and refresh the menu', () => {
  const { dom, preferences, commands } = setup();
  const pressed = () => ['solo', 'rush', 'duo'].filter((mode) => dom[mode].getAttribute('aria-pressed') === 'true');

  assert.deepEqual(pressed(), ['solo']);
  assert.equal(dom.difficultyGroup.hidden, false);
  assert.equal(dom.powerUps.hidden, false);

  click(dom.rush);

  assert.equal(preferences.get().mode, 'rush');
  assert.deepEqual(pressed(), ['rush']);
  assert.equal(dom.difficultyGroup.hidden, true);
  assert.equal(dom.powerUps.hidden, true);
  assert.equal(dom.root.dataset.mode, 'rush');
  assert.match(dom.modeTip.textContent, /faster/);
  assert.deepEqual(commands.map((entry) => entry.command), [GAME_COMMAND.RESET]);

  click(dom.duo);
  assert.equal(dom.difficultyGroup.hidden, true);
  assert.equal(dom.powerUps.hidden, false);
  assert.match(dom.modeTip.textContent, /Player 2/);
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

  click(dom.music);
  click(dom.powerUps);
  click(dom.vibration);
  assert.equal(preferences.get().music, false);
  assert.equal(preferences.get().powerUps, false);
  assert.equal(preferences.get().vibration, false);
});

test('the vibration switch is hidden where the device cannot vibrate', () => {
  assert.equal(setup({ canVibrate: false }).dom.vibration.hidden, true);
  assert.equal(setup({ canVibrate: true }).dom.vibration.hidden, false);
});

test('share and full-screen buttons appear only where the browser supports them', () => {
  const capable = setup();
  assert.equal(capable.dom.share.hidden, false);
  assert.equal(capable.dom.fullscreen.hidden, false);

  click(capable.dom.fullscreen);
  assert.equal(capable.device.fullscreenToggles, 1);

  const limited = setup({ device: createDevice({ canShare: false, canFullscreen: false }) });
  assert.equal(limited.dom.share.hidden, true);
  assert.equal(limited.dom.fullscreen.hidden, true);
});

test('the tutorial opens on a first visit, and dismissing it remembers that', () => {
  const preferences = createPreferences({ tutorialSeen: false });
  const { view, dom } = setup({ preferences });

  view.render(presentation());
  assert.equal(dom.tutorial.hidden, false);
  assert.equal(dom.menu.hidden, true);

  click(dom.dismissTutorial);
  assert.equal(preferences.get().tutorialSeen, true);
  assert.equal(dom.tutorial.hidden, true);
  assert.equal(dom.menu.hidden, false);

  click(dom.showTutorial);
  assert.equal(dom.tutorial.hidden, false);
});

test('a returning player goes straight to the menu', () => {
  const { view, dom } = setup();

  view.render(presentation());

  assert.equal(dom.tutorial.hidden, true);
  assert.equal(dom.menu.hidden, false);
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

test('in Rush the scoreboard counts hits and shows the lives as hearts', () => {
  const { view, dom } = setup();

  view.render(presentation({ phase: GAME_PHASE.RUNNING, mode: 'rush', hits: { player: 12, opponent: 11 }, lives: 2, maxLives: 3 }));

  assert.equal(dom.playerScore.textContent, '12');
  assert.equal(dom.playerLabel.textContent, 'Hits');
  assert.equal(dom.lives.hidden, false);
  assert.deepEqual(dom.lives.children.map((heart) => heart.className), ['lives__heart', 'lives__heart', 'lives__heart lives__heart--lost']);

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  assert.equal(dom.lives.hidden, true);
});

test('match point is announced on the side that is one point away', () => {
  const { view, dom } = setup();

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  assert.equal(dom.matchPoint.hidden, true);

  view.render(presentation({ phase: GAME_PHASE.RUNNING, matchPoint: 'opponent' }));
  assert.equal(dom.matchPoint.hidden, false);
  assert.equal(dom.matchPoint.dataset.side, 'opponent');
});

test('the menu shows the record for the chosen mode and the Solo win statistics', () => {
  const { view, dom } = setup();

  view.render(presentation({ bestRally: 14, stats: { matches: 5, wins: 3, streak: 2, bestStreak: 2 } }));
  assert.match(dom.menuMeta.innerHTML, /Best rally <strong[^>]*>14</);
  assert.equal(dom.stats.hidden, false);
  assert.equal(dom.stats.textContent, '3/5 won (60%) · 2 in a row 🔥');

  view.render(presentation({ mode: 'rush', bestRush: 27 }));
  assert.match(dom.menuMeta.innerHTML, /Best run <strong[^>]*>27</);
  assert.equal(dom.stats.hidden, true);
});

test('the result screen shows the winner, score, rally, difficulty and a new record', () => {
  const { view, dom } = setup({ preferences: createPreferences({ difficulty: 'hard' }) });

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  view.render(presentation({
    phase: GAME_PHASE.GAME_OVER,
    difficulty: 'hard',
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
  assert.equal(dom.overBestRush.hidden, true);

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  view.render(presentation({ phase: GAME_PHASE.GAME_OVER, score: { player: 2, opponent: 7 }, winner: 'opponent' }));
  assert.equal(dom.overTitle.textContent, 'Defeat');
  assert.equal(dom.overBest.hidden, true);
});

test('a Rush result reports the run and its record', () => {
  const { view, dom } = setup();

  view.render(presentation({ phase: GAME_PHASE.RUNNING, mode: 'rush' }));
  view.render(presentation({ phase: GAME_PHASE.GAME_OVER, mode: 'rush', hits: { player: 31, opponent: 30 }, winner: 'opponent', newBestRush: true }));

  assert.equal(dom.overTitle.textContent, 'Run over');
  assert.equal(dom.overScore.textContent, '31 hits');
  assert.equal(dom.overDifficulty.textContent, 'Rush');
  assert.equal(dom.overBestRush.hidden, false);
});

test('sharing sends a summary of the last result and reports what happened', async () => {
  const { view, dom, device } = setup();

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  view.render(presentation({ phase: GAME_PHASE.GAME_OVER, score: { player: 7, opponent: 3 }, longestRally: 9, winner: 'player' }));
  click(dom.share);
  await nextTick();

  assert.match(device.shared[0], /won 7:3 on Normal/);
  assert.match(device.shared[0], /Longest rally: 9/);
  assert.equal(dom.shareNote.textContent, '');

  device.share = async () => 'copied';
  click(dom.share);
  await nextTick();
  assert.equal(dom.shareNote.textContent, 'Copied to clipboard');
});

test('disconnect unbinds every control', () => {
  const { view, dom, commands, preferences } = setup();

  view.disconnect();
  click(dom.play);
  click(dom.hard);
  click(dom.rush);

  assert.deepEqual(commands, []);
  assert.equal(preferences.get().difficulty, 'normal');
  assert.equal(preferences.get().mode, 'solo');
});

test('a missing element is reported by name', () => {
  const { root } = createRoot();
  const incomplete = { ...root, querySelector: (selector) => (selector === '[data-game-status]' ? null : root.querySelector(selector)) };

  assert.throws(
    () => new DomGameView({ root: incomplete, board: { focus() {} }, preferences: createPreferences(), canVibrate: true, device: createDevice() }),
    /\[data-game-status\] is missing/,
  );
});
