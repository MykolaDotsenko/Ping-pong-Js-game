import test from 'node:test';
import assert from 'node:assert/strict';

import { DomGameView } from '../src/adapters/dom-game-view.js';
import { GAME_COMMAND } from '../src/application/ports.js';
import { GAME_PHASE } from '../src/domain/game.js';

class FakeButton extends EventTarget {
  disabled = false;
  textContent = '';
}

class FakeStatus {
  writes = 0;
  #text = '';

  get textContent() {
    return this.#text;
  }

  set textContent(text) {
    this.writes += 1;
    this.#text = text;
  }
}

function setup() {
  const board = {
    focusCalls: [],
    focus(options) {
      this.focusCalls.push(options);
    },
  };
  const elements = {
    startButton: new FakeButton(),
    pauseButton: new FakeButton(),
    resetButton: new FakeButton(),
    status: new FakeStatus(),
    board,
  };
  const view = new DomGameView(elements);
  const commands = [];

  view.onCommand((command) => commands.push({ command, focusedBefore: board.focusCalls.length }));
  view.connect();

  return { view, commands, ...elements };
}

test('a control hands focus back to the board before sending its command', () => {
  const { startButton, pauseButton, resetButton, board, commands } = setup();

  startButton.dispatchEvent(new Event('click'));
  pauseButton.dispatchEvent(new Event('click'));
  resetButton.dispatchEvent(new Event('click'));

  assert.deepEqual(commands, [
    { command: GAME_COMMAND.START, focusedBefore: 1 },
    { command: GAME_COMMAND.TOGGLE_PAUSE, focusedBefore: 2 },
    { command: GAME_COMMAND.RESET, focusedBefore: 3 },
  ]);
  assert.deepEqual(board.focusCalls[0], { preventScroll: true });
});

test('the controls follow the match phase', () => {
  const { view, startButton, pauseButton } = setup();
  const controls = () => ({
    start: !startButton.disabled,
    pause: !pauseButton.disabled,
    pauseLabel: pauseButton.textContent,
  });

  view.render({ phase: GAME_PHASE.READY, status: 'ready' });
  assert.deepEqual(controls(), { start: true, pause: false, pauseLabel: 'Pause' });

  view.render({ phase: GAME_PHASE.RUNNING, status: 'running' });
  assert.deepEqual(controls(), { start: false, pause: true, pauseLabel: 'Pause' });

  view.render({ phase: GAME_PHASE.PAUSED, status: 'paused' });
  assert.deepEqual(controls(), { start: false, pause: true, pauseLabel: 'Resume' });

  view.render({ phase: GAME_PHASE.GAME_OVER, status: 'over' });
  assert.deepEqual(controls(), { start: true, pause: false, pauseLabel: 'Pause' });
});

test('an unchanged status is not rewritten, keeping the live region quiet', () => {
  const { view, status } = setup();

  for (let frame = 0; frame < 3; frame += 1) {
    view.render({ phase: GAME_PHASE.RUNNING, status: 'You 0 — 0 Computer' });
  }
  view.render({ phase: GAME_PHASE.RUNNING, status: 'You 1 — 0 Computer' });

  assert.equal(status.writes, 2);
  assert.equal(status.textContent, 'You 1 — 0 Computer');
});

test('disconnect unbinds the controls', () => {
  const { view, startButton, commands } = setup();

  view.disconnect();
  startButton.dispatchEvent(new Event('click'));

  assert.deepEqual(commands, []);
});
