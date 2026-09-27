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
    this.focusCalls = [];
    this.ownerDocument = { createElement: () => new FakeElement() };
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      toggle: (name, force) => (force ? this.classes.add(name) : this.classes.delete(name)),
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

  replaceChildren(...nodes) {
    this.children = nodes;
    this.textContent = nodes.map((node) => (typeof node === 'string' ? node : node.textContent)).join('');
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  focus(options) {
    this.focusCalls.push(options);
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

// A <dialog>: showModal() opens it as a modal, close() closes it and announces 'close',
// as browsers do for the close button and for Escape alike.
class FakeDialog extends FakeElement {
  showModal() {
    this.modal = true;
    this.setAttribute('open', '');
  }

  close() {
    this.modal = false;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  }
}

function createRoot({ modalDialogs = true } = {}) {
  const elements = [
    ['status', { 'data-game-status': '' }],
    ['scoreboard', { 'data-scoreboard': '' }],
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
    ['menuTrack', { 'data-track': '' }],
    ['pauseTrack', { 'data-track': '' }],
    ['powerUps', { 'data-setting': 'powerUps', 'data-not-rush': '' }],
    ['vibration', { 'data-setting': 'vibration' }],
    ['jokes', { 'data-setting': 'jokes' }],
    ['solo', { 'data-mode': 'solo' }],
    ['rush', { 'data-mode': 'rush' }],
    ['duo', { 'data-mode': 'duo' }],
    ['difficultyGroup', { 'data-solo-only': '' }],
    ['easy', { 'data-difficulty': 'easy' }],
    ['normal', { 'data-difficulty': 'normal' }],
    ['hard', { 'data-difficulty': 'hard' }],
    ['play', { 'data-command': 'start' }],
    ['resume', { 'data-command': 'toggle-pause', 'data-focus': 'pause' }],
    ['playAgain', { 'data-command': 'start', 'data-focus': 'over' }],
    ['restart', { 'data-command': 'restart' }],
    ['menuButton', { 'data-command': 'reset' }],
    ['bogus', { 'data-command': 'self-destruct' }],
    ['menuMeta', { 'data-menu-meta': '' }],
    ['rushLives', { 'data-rush-lives': '' }],
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
  ].map(([name, attributes]) => [
    name,
    name === 'tutorial' && modalDialogs ? new FakeDialog(attributes) : new FakeElement(attributes),
  ]);
  const byName = Object.fromEntries(elements);
  const all = elements.map(([, element]) => element);
  const board = new FakeElement({ 'data-game-canvas': '' });
  const document = { body: new FakeElement(), activeElement: null };

  return {
    ...byName,
    board,
    document,
    root: Object.assign(new EventTarget(), {
      dataset: {},
      scrolls: [],
      ownerDocument: document,
      scrollIntoView(options) {
        this.scrolls.push(options);
      },
      contains: (element) => element === board || all.includes(element),
      querySelector: (selector) => all.find((element) => element.matches(selector)) ?? null,
      querySelectorAll: (selector) => all.filter((element) => element.matches(selector)),
    }),
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
    track: 'neon',
    jokes: true,
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

const TRACKS = [{ id: 'neon', label: 'Neon' }, { id: 'arena', label: 'Arena' }, { id: 'iron', label: 'Iron' }];

function createTimers() {
  const pending = new Map();
  let nextId = 1;

  return {
    pending,
    setTimeout(callback, ms) {
      pending.set(nextId, { callback, ms });
      return nextId++;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    fire() {
      const due = [...pending.values()];
      pending.clear();
      due.forEach(({ callback }) => callback());
    },
  };
}

function setup({ canVibrate = true, preferences = createPreferences(), device = createDevice(), modalDialogs = true } = {}) {
  const dom = createRoot({ modalDialogs });
  const { board } = dom;
  const previews = [];
  const timers = createTimers();
  const view = new DomGameView({
    root: dom.root,
    board,
    preferences,
    canVibrate,
    device,
    rushLives: 3,
    tracks: TRACKS,
    previewTrack: (track) => previews.push(track),
    timers,
  });
  const commands = [];

  view.onCommand((command) => commands.push({ command, focusedBefore: board.focusCalls.length }));
  view.connect();

  return { view, dom, board, commands, preferences, device, previews, timers };
}

const click = (element) => element.dispatchEvent(new Event('click'));
const noModifiers = { wide: 0, tiny: 0, ghost: 0 };

function presentation(overrides = {}) {
  return {
    phase: GAME_PHASE.READY,
    mode: 'solo',
    difficulty: 'normal',
    rules: { kind: 'match', winningScore: 7 },
    opponent: { label: 'CPU', name: 'Computer', nickname: false },
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

const tutorialOpen = (dom) => dom.tutorial.hasAttribute('open');

test('overlays and the pause button follow the match phase', () => {
  const { view, dom, timers } = setup();
  const visible = () => ['menu', 'pause', 'over'].filter((name) => !dom[name].hidden)
    .concat(tutorialOpen(dom) ? ['tutorial'] : []);

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
  assert.ok(dom.hudPause.attributes.has('disabled'), 'disabled already while the finisher plays');
  timers.fire();
  assert.deepEqual(visible(), ['over']);
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
  click(dom.jokes);
  assert.equal(preferences.get().music, false);
  assert.equal(preferences.get().powerUps, false);
  assert.equal(preferences.get().vibration, false);
  assert.equal(preferences.get().jokes, false);
  assert.equal(dom.jokes.getAttribute('aria-pressed'), 'false');
});

test('the scoreboard names the rival: a nickname in its own style, else CPU or P2', () => {
  const { view, dom } = setup();
  const nick = { label: 'Vitalik95', name: 'Vitalik95', nickname: true };

  view.render(presentation({ opponent: nick }));
  assert.equal(dom.opponentLabel.textContent, 'Vitalik95');
  assert.ok(dom.opponentLabel.classes.has('scoreboard__label--nick'));
  assert.ok(dom.scoreboard.classes.has('scoreboard--nick'), 'the scoreboard makes room');

  view.render(presentation({ mode: 'duo', opponent: { label: 'P2', name: 'Player 2', nickname: false } }));
  assert.equal(dom.opponentLabel.textContent, 'P2');
  assert.equal(dom.playerLabel.textContent, 'P1');
  assert.equal(dom.opponentLabel.classes.has('scoreboard__label--nick'), false);
  assert.equal(dom.scoreboard.classes.has('scoreboard--nick'), false);

  view.render(presentation({ phase: GAME_PHASE.GAME_OVER, winner: 'opponent', opponent: nick }));
  assert.equal(dom.overDifficulty.textContent, 'Normal · vs Vitalik95');
});

test('the track button shows the saved track and every tap moves on, turns music on and plays a sample', () => {
  const { dom, preferences, previews } = setup({ preferences: createPreferences({ track: 'arena', music: false }) });

  assert.equal(dom.menuTrack.textContent, 'Arena');
  assert.equal(dom.pauseTrack.getAttribute('aria-label'), 'Music track: Arena');

  click(dom.menuTrack);
  assert.equal(preferences.get().track, 'iron');
  assert.equal(preferences.get().music, true, 'a picked track is meant to be heard');
  assert.equal(dom.music.getAttribute('aria-pressed'), 'true');
  assert.equal(dom.pauseTrack.textContent, 'Iron', 'both pickers follow');

  click(dom.pauseTrack);
  assert.equal(preferences.get().track, 'neon', 'wraps around to the first track');
  assert.deepEqual(previews, ['iron', 'neon']);
});

test('an unknown saved track shows as the first one', () => {
  const { dom } = setup({ preferences: createPreferences({ track: 'polka' }) });

  assert.equal(dom.menuTrack.textContent, 'Neon');
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

test('the tutorial opens as a modal dialog on a first visit, and dismissing it remembers that', () => {
  const preferences = createPreferences({ tutorialSeen: false });
  const { view, dom } = setup({ preferences });

  view.render(presentation());
  assert.equal(tutorialOpen(dom), true);
  assert.equal(dom.tutorial.modal, true, 'the page behind it is inert');
  assert.equal(dom.menu.hidden, false, 'the menu waits, dimmed, behind the dialog');
  assert.equal(preferences.get().tutorialSeen, false);

  click(dom.dismissTutorial);
  assert.equal(tutorialOpen(dom), false);
  assert.equal(preferences.get().tutorialSeen, true);

  click(dom.showTutorial);
  assert.equal(tutorialOpen(dom), true);
  assert.equal(dom.tutorial.modal, true);
});

test('closing the tutorial with Escape counts as having seen it, saved before it even closes', () => {
  const preferences = createPreferences({ tutorialSeen: false });
  const { dom } = setup({ preferences });

  // Escape fires 'cancel' right away; the browser announces 'close' only in a later task.
  dom.tutorial.dispatchEvent(new Event('cancel'));
  assert.equal(preferences.get().tutorialSeen, true);

  const other = createPreferences({ tutorialSeen: false });
  setup({ preferences: other }).dom.tutorial.close();
  assert.equal(other.get().tutorialSeen, true, 'any other way of closing it counts too');
});

test('without modal dialog support the tutorial still opens and closes', () => {
  const preferences = createPreferences({ tutorialSeen: false });
  const { dom } = setup({ preferences, modalDialogs: false });

  assert.equal(tutorialOpen(dom), true);

  click(dom.dismissTutorial);
  assert.equal(tutorialOpen(dom), false);
  assert.equal(preferences.get().tutorialSeen, true);
});

test('a returning player goes straight to the menu', () => {
  const { view, dom } = setup();

  view.render(presentation());

  assert.equal(tutorialOpen(dom), false);
  assert.equal(dom.menu.hidden, false);
});

test('the pause and result screens take keyboard focus, and play hands it back to the board', () => {
  const { view, dom, board } = setup();

  view.render(presentation());
  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  assert.equal(board.focusCalls.length, 1, 'a match started from the keyboard focuses the board');

  view.render(presentation({ phase: GAME_PHASE.PAUSED }));
  assert.deepEqual(dom.resume.focusCalls, [{ preventScroll: true }]);

  dom.document.activeElement = dom.resume;
  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  assert.equal(board.focusCalls.length, 2);

  dom.document.activeElement = board;
  view.render(presentation({ phase: GAME_PHASE.GAME_OVER, winner: 'opponent' }));
  assert.deepEqual(dom.playAgain.focusCalls, [{ preventScroll: true }]);
});

test('focus the player moved elsewhere on the page is left alone', () => {
  const { view, dom, board } = setup();
  const elsewhere = new FakeElement();

  view.render(presentation());
  dom.document.activeElement = elsewhere;
  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  view.render(presentation({ phase: GAME_PHASE.PAUSED }));

  assert.equal(board.focusCalls.length, 0);
  assert.deepEqual(dom.resume.focusCalls, []);
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

test('the menu states the rules and the record for the chosen mode, from the match config', () => {
  const { view, dom } = setup();
  const record = () => dom.menuMeta.children.find((child) => typeof child !== 'string');

  view.render(presentation({ bestRally: 14, rules: { kind: 'match', winningScore: 11 } }));
  assert.equal(dom.menuMeta.textContent, 'First to 11 · Best rally 14');
  assert.equal(record().textContent, '14', 'the record stands out');

  view.render(presentation({ mode: 'rush', bestRush: 27, rules: { kind: 'rush', lives: 5 } }));
  assert.equal(dom.menuMeta.textContent, '5 lives · Best run 27 hits');
  assert.equal(record().textContent, '27');

  view.render(presentation({ mode: 'duo', bestRally: 14 }));
  assert.equal(dom.menuMeta.textContent, 'First to 7 · Two players, one screen', 'a Solo record is not a two-player one');
});

test('the Rush button names its lives from the configuration', () => {
  assert.equal(setup().dom.rushLives.textContent, '3 lives');
});

test('the menu shows Solo win statistics, with the streak flame hidden from screen readers', () => {
  const { view, dom } = setup();

  view.render(presentation({ stats: { matches: 5, wins: 3, streak: 2, bestStreak: 2 } }));
  assert.equal(dom.stats.hidden, false);
  assert.equal(dom.stats.textContent, '3/5 won (60%) · 2 in a row 🔥');
  const flame = dom.stats.children.find((child) => typeof child !== 'string');
  assert.equal(flame.getAttribute('aria-hidden'), 'true');

  view.render(presentation({ stats: { matches: 5, wins: 3, streak: 0, bestStreak: 2 } }));
  assert.equal(dom.stats.textContent, '3/5 won (60%)');

  view.render(presentation({ mode: 'rush' }));
  assert.equal(dom.stats.hidden, true);
});

test('win statistics stay hidden until a Solo match has been played', () => {
  const { view, dom } = setup();

  view.render(presentation({ stats: DEFAULT_STATS }));

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

test('a won match keeps the result screen back while the finisher plays, then brings it with focus', () => {
  const { view, dom, timers } = setup();

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  view.render(presentation({ phase: GAME_PHASE.GAME_OVER, winner: 'player' }));

  assert.equal(dom.over.hidden, true);
  assert.equal(timers.pending.size, 1);
  assert.ok([...timers.pending.values()][0].ms <= 1200);

  timers.fire();
  assert.equal(dom.over.hidden, false);
  assert.equal(dom.playAgain.focusCalls.length, 1);
});

/** A key press as the court sees it, recording whether the view kept it from going further. */
function keyPress(overrides = {}) {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    code: 'Space', repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...overrides,
  });
  event.stopped = false;
  event.stopPropagation = () => {
    event.stopped = true;
  };
  return event;
}

function finishing() {
  const context = setup();
  context.view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  context.view.render(presentation({ phase: GAME_PHASE.GAME_OVER, winner: 'player' }));
  return context;
}

test('a tap on the court or a key skips the finisher and shows the result at once', () => {
  for (const event of [() => new Event('click'), () => keyPress()]) {
    const { dom, timers } = finishing();
    const type = event().type;

    dom.root.dispatchEvent(event());
    assert.equal(dom.over.hidden, false, type);
    assert.equal(timers.pending.size, 0, `${type} cancels the wait`);
    assert.equal(dom.playAgain.focusCalls.length, 1, `${type} hands focus to Play again`);

    dom.root.dispatchEvent(event());
    assert.equal(dom.playAgain.focusCalls.length, 1, 'a second one changes nothing');
  }
});

test('a key that skips the finisher goes no further, so Space cannot also start the next match', () => {
  const { dom } = finishing();
  const space = keyPress();

  dom.root.dispatchEvent(space);
  assert.equal(space.defaultPrevented, true);
  assert.equal(space.stopped, true);

  // Once the result screen is up, keys mean what they always do.
  const next = keyPress();
  dom.root.dispatchEvent(next);
  assert.equal(next.defaultPrevented, false);
  assert.equal(next.stopped, false);
});

test('a held key and shortcuts with a modifier do not skip the finisher', () => {
  for (const overrides of [{ repeat: true, code: 'ArrowLeft' }, { ctrlKey: true, code: 'KeyR' }, { metaKey: true }, { altKey: true }]) {
    const { dom, timers } = finishing();
    const key = keyPress(overrides);

    dom.root.dispatchEvent(key);
    assert.equal(dom.over.hidden, true, JSON.stringify(overrides));
    assert.equal(timers.pending.size, 1);
    assert.equal(key.defaultPrevented, false);
    assert.equal(key.stopped, false);
  }
});

test('the result comes at once when no finisher plays: a defeat, a Rush run, or the fun extras off', () => {
  const cases = [
    [createPreferences(), presentation({ phase: GAME_PHASE.GAME_OVER, winner: 'opponent' })],
    [createPreferences({ mode: 'rush' }), presentation({ phase: GAME_PHASE.GAME_OVER, mode: 'rush', winner: 'opponent' })],
    [createPreferences({ jokes: false }), presentation({ phase: GAME_PHASE.GAME_OVER, winner: 'player' })],
  ];

  for (const [preferences, result] of cases) {
    const { view, dom, timers } = setup({ preferences });
    view.render(presentation({ phase: GAME_PHASE.RUNNING, mode: result.mode }));
    view.render(result);
    assert.equal(dom.over.hidden, false);
    assert.equal(timers.pending.size, 0);
  }

  // Between two people the second player's win is finished too.
  const duo = { mode: 'duo', opponent: { label: 'P2', name: 'Player 2', nickname: false } };
  const { view, dom, timers } = setup({ preferences: createPreferences({ mode: 'duo' }) });
  view.render(presentation({ ...duo, phase: GAME_PHASE.RUNNING }));
  view.render(presentation({ ...duo, phase: GAME_PHASE.GAME_OVER, winner: 'opponent' }));
  assert.equal(dom.over.hidden, true);
  assert.equal(timers.pending.size, 1);
});

test('leaving for the menu during the finisher drops the wait, so the result never pops up over the menu', () => {
  const { view, dom, timers } = setup();

  view.render(presentation({ phase: GAME_PHASE.RUNNING }));
  view.render(presentation({ phase: GAME_PHASE.GAME_OVER, winner: 'player' }));
  view.render(presentation({ phase: GAME_PHASE.READY }));

  assert.equal(timers.pending.size, 0);
  assert.equal(dom.over.hidden, true);
  assert.equal(dom.menu.hidden, false);

  view.disconnect();
  assert.equal(timers.pending.size, 0);
});
