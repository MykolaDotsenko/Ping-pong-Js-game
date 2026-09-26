import test from 'node:test';
import assert from 'node:assert/strict';

import { InputController } from '../src/adapters/input-controller.js';
import { GAME_COMMAND } from '../src/application/ports.js';

// The pointer surface (board plus thumb rail) listens for events; the board, 800 units wide
// and displayed 400px wide 100px from the left edge, maps them onto the court.
const board = {
  getBoundingClientRect: () => ({ left: 100, width: 400, top: 50, height: 640 }),
};

function setup() {
  const window = new EventTarget();
  // openDialog stands for a <dialog open> somewhere on the page, such as the tutorial.
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    openDialog: null,
    querySelector(selector) {
      return selector === 'dialog[open]' ? this.openDialog : null;
    },
  });
  const input = new InputController({ surface: new EventTarget(), board, window, document, config: { width: 800 } });
  const commands = [];

  input.onCommand((command) => commands.push(command));
  input.connect();

  return { input, window, document, surface: input.surface, commands };
}

function keyEvent(type, init) {
  return Object.assign(new Event(type, { cancelable: true }), {
    key: '',
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...init,
  });
}

function pointerEvent(type, clientX, { clientY = 600, pointerId = 1 } = {}) {
  return Object.assign(new Event(type), { clientX, clientY, pointerId });
}

function press(target, init) {
  const event = keyEvent('keydown', init);
  target.dispatchEvent(event);
  return event;
}

function release(target, init) {
  target.dispatchEvent(keyEvent('keyup', init));
}

test('A and D steer by physical key, so they work on a Ukrainian layout too', () => {
  const { input, window } = setup();

  const left = press(window, { code: 'KeyA', key: 'ф' });
  assert.equal(input.snapshot().horizontalAxis, -1);
  assert.ok(left.defaultPrevented);

  release(window, { code: 'KeyA', key: 'ф' });
  press(window, { code: 'KeyD', key: 'в' });
  assert.equal(input.snapshot().horizontalAxis, 1);

  press(window, { code: 'ArrowLeft', key: 'ArrowLeft' });
  assert.equal(input.snapshot().horizontalAxis, 0);

  release(window, { code: 'KeyD', key: 'в' });
  assert.equal(input.snapshot().horizontalAxis, -1);
});

test('shortcuts with Ctrl, Meta or Alt are left to the browser', () => {
  const { input, window, commands } = setup();

  for (const init of [
    { code: 'KeyA', key: 'a', ctrlKey: true },
    { code: 'KeyD', key: 'd', metaKey: true },
    { code: 'ArrowLeft', key: 'ArrowLeft', altKey: true },
    { code: 'Space', key: ' ', ctrlKey: true },
  ]) {
    const event = press(window, init);
    assert.equal(event.defaultPrevented, false, JSON.stringify(init));
  }

  assert.equal(input.snapshot().horizontalAxis, 0);
  assert.deepEqual(commands, []);
});

test('a key released while a modifier is held does not stay stuck', () => {
  const { input, window } = setup();

  press(window, { code: 'KeyA' });
  release(window, { code: 'KeyA', ctrlKey: true });

  assert.equal(input.snapshot().horizontalAxis, 0);
});

test('Space sends the primary command unless it repeats or a control has focus', () => {
  const { input, window, commands } = setup();

  const space = press(window, { code: 'Space', key: ' ' });
  press(window, { code: 'Space', key: ' ', repeat: true });

  // A focused button keeps its native Space activation.
  input.handleKeyDown({
    code: 'Space',
    key: ' ',
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: { tagName: 'BUTTON' },
    preventDefault: () => assert.fail('native button activation must be kept'),
  });

  assert.ok(space.defaultPrevented);
  assert.deepEqual(commands, [GAME_COMMAND.PRIMARY]);
});

test('Escape toggles pause, once per press', () => {
  const { window, commands } = setup();

  press(window, { code: 'Escape', key: 'Escape' });
  press(window, { code: 'Escape', key: 'Escape', repeat: true });

  assert.deepEqual(commands, [GAME_COMMAND.TOGGLE_PAUSE]);
});

test('taps on controls, or icons inside them, do not move the paddle', () => {
  const { input } = setup();
  const insideButton = { closest: (selector) => (selector.includes('button') ? {} : null) };
  const plainElement = { closest: () => null };

  input.handlePointer({ clientX: 150, target: insideButton }, true);
  assert.equal(input.snapshot().pointerX, null);

  input.handlePointer({ clientX: 150, target: plainElement }, true);
  assert.equal(input.snapshot().pointerX, 100);
});

test('the most recently used device steers the paddle', () => {
  const { input, window, surface } = setup();

  surface.dispatchEvent(pointerEvent('pointermove', 300));
  assert.equal(input.snapshot().pointerX, 400);

  press(window, { code: 'ArrowLeft' });
  assert.deepEqual(input.snapshot(), { horizontalAxis: -1, pointerX: null, opponentAxis: 0, opponentPointerX: null });
  release(window, { code: 'ArrowLeft' });

  // A move without horizontal travel, such as a vertical nudge, keeps the keyboard in charge.
  surface.dispatchEvent(pointerEvent('pointermove', 300));
  assert.equal(input.snapshot().pointerX, null);

  surface.dispatchEvent(pointerEvent('pointermove', 450));
  assert.equal(input.snapshot().pointerX, 700);
});

test('key auto-repeat does not take steering back from a moving pointer', () => {
  const { input, window, surface } = setup();

  press(window, { code: 'ArrowRight' });
  surface.dispatchEvent(pointerEvent('pointermove', 200));
  press(window, { code: 'ArrowRight', repeat: true });

  assert.equal(input.snapshot().pointerX, 200);
});

test('a tap steers the paddle even without any movement', () => {
  const { input, window, surface } = setup();

  surface.dispatchEvent(pointerEvent('pointerdown', 150));
  assert.equal(input.snapshot().pointerX, 100);

  press(window, { code: 'KeyD' });
  surface.dispatchEvent(pointerEvent('pointerdown', 150));
  assert.equal(input.snapshot().pointerX, 100);
});

test('losing window focus releases held input and pauses', () => {
  const { input, window, surface, commands } = setup();

  press(window, { code: 'KeyA' });
  surface.dispatchEvent(pointerEvent('pointermove', 250));
  window.dispatchEvent(new Event('blur'));

  assert.deepEqual(input.snapshot(), { horizontalAxis: 0, pointerX: null, opponentAxis: 0, opponentPointerX: null });
  assert.deepEqual(commands, [GAME_COMMAND.PAUSE]);
});

test('hiding the page pauses, showing it again does nothing', () => {
  const { document, commands } = setup();

  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(commands, [GAME_COMMAND.PAUSE], 'paused as the page is hidden');

  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(commands, [GAME_COMMAND.PAUSE], 'nothing more when it comes back');
});

test('losing focus lets go of Player 2 keys too', () => {
  const { input, window } = setup();

  input.configure({ players: 2 });
  press(window, { code: 'KeyJ' });
  window.dispatchEvent(new Event('blur'));

  assert.equal(input.snapshot().opponentAxis, 0);
});

test('disconnect removes every listener', () => {
  const { input, window, surface, commands } = setup();

  input.disconnect();
  press(window, { code: 'KeyA' });
  press(window, { code: 'Space' });
  surface.dispatchEvent(pointerEvent('pointerdown', 300));
  window.dispatchEvent(new Event('blur'));

  assert.deepEqual(input.snapshot(), { horizontalAxis: 0, pointerX: null, opponentAxis: 0, opponentPointerX: null });
  assert.deepEqual(commands, []);
});

test('with two players, each half of the board and its own keys steer a different paddle', () => {
  const { input, window, surface } = setup();

  input.configure({ players: 2 });

  // A finger on the top half takes the top paddle; another on the bottom half takes the bottom one.
  surface.dispatchEvent(pointerEvent('pointerdown', 150, { clientY: 100, pointerId: 7 }));
  surface.dispatchEvent(pointerEvent('pointerdown', 450, { clientY: 600, pointerId: 8 }));
  assert.deepEqual(input.snapshot(), { horizontalAxis: 0, pointerX: 700, opponentAxis: 0, opponentPointerX: 100 });

  // Each finger keeps its paddle even when it drifts across the middle.
  surface.dispatchEvent(pointerEvent('pointermove', 200, { clientY: 500, pointerId: 7 }));
  assert.equal(input.snapshot().opponentPointerX, 200);
  assert.equal(input.snapshot().pointerX, 700);

  // Player 2's keys move the top paddle; Player 1's keys still move the bottom one.
  press(window, { code: 'KeyJ' });
  press(window, { code: 'ArrowRight' });
  assert.deepEqual(input.snapshot(), { horizontalAxis: 1, pointerX: null, opponentAxis: -1, opponentPointerX: null });
  release(window, { code: 'KeyJ' });
  release(window, { code: 'ArrowRight' });
});

test('with one player, Player 2 keys and the top half do nothing special', () => {
  const { input, window, surface } = setup();

  press(window, { code: 'KeyJ' });
  surface.dispatchEvent(pointerEvent('pointerdown', 150, { clientY: 100 }));

  assert.deepEqual(input.snapshot(), { horizontalAxis: 0, pointerX: 100, opponentAxis: 0, opponentPointerX: null });
  release(window, { code: 'KeyJ' });
});

test('lifting a finger keeps the paddle where it was and frees the paddle for the next touch', () => {
  const { input, surface } = setup();

  input.configure({ players: 2 });
  surface.dispatchEvent(pointerEvent('pointerdown', 150, { clientY: 100, pointerId: 7 }));
  surface.dispatchEvent(pointerEvent('pointerup', 150, { clientY: 100, pointerId: 7 }));
  assert.equal(input.snapshot().opponentPointerX, 100);

  surface.dispatchEvent(pointerEvent('pointerdown', 350, { clientY: 100, pointerId: 9 }));
  assert.equal(input.snapshot().opponentPointerX, 500);
});

test('with two players, a mouse that let go of its paddle steers it no more by hovering', () => {
  const { input, surface } = setup();

  input.configure({ players: 2 });
  surface.dispatchEvent(pointerEvent('pointerdown', 150, { clientY: 100, pointerId: 1 }));
  surface.dispatchEvent(pointerEvent('pointerup', 150, { clientY: 100, pointerId: 1 }));
  surface.dispatchEvent(pointerEvent('pointermove', 450, { clientY: 100, pointerId: 1 }));

  assert.equal(input.snapshot().opponentPointerX, 100);
});

test('with two players a hovering mouse steers nothing, and clicking takes the half it clicks', () => {
  const { input, surface } = setup();

  input.configure({ players: 2 });
  // The mouse enters over the top half and hovers there without pressing.
  surface.dispatchEvent(pointerEvent('pointermove', 150, { clientY: 100, pointerId: 1 }));
  surface.dispatchEvent(pointerEvent('pointermove', 180, { clientY: 110, pointerId: 1 }));
  assert.deepEqual(input.snapshot(), { horizontalAxis: 0, pointerX: null, opponentAxis: 0, opponentPointerX: null });

  // A click in Player 1's half steers Player 1's paddle, not the one it hovered over.
  surface.dispatchEvent(pointerEvent('pointerdown', 250, { clientY: 600, pointerId: 1 }));
  assert.equal(input.snapshot().pointerX, 300);
  assert.equal(input.snapshot().opponentPointerX, null);
});

test('switching back to one player releases the second paddle', () => {
  const { input, surface } = setup();

  input.configure({ players: 2 });
  surface.dispatchEvent(pointerEvent('pointerdown', 150, { clientY: 100, pointerId: 7 }));
  input.configure({ players: 1 });

  assert.equal(input.snapshot().opponentPointerX, null);
});

test('while a dialog is open the game takes no keys or touches, so Space cannot start a match behind it', () => {
  const { input, window, document, surface, commands } = setup();
  document.openDialog = { tagName: 'DIALOG' };

  const space = press(window, { code: 'Space', key: ' ' });
  press(window, { code: 'Escape', key: 'Escape' });
  press(window, { code: 'ArrowLeft', key: 'ArrowLeft' });
  surface.dispatchEvent(pointerEvent('pointerdown', 300));

  assert.deepEqual(commands, []);
  assert.equal(space.defaultPrevented, false, 'Space stays with the dialog');
  assert.deepEqual(input.snapshot(), { horizontalAxis: 0, pointerX: null, opponentAxis: 0, opponentPointerX: null });

  // Once it closes, the same keys drive the game again.
  document.openDialog = null;
  press(window, { code: 'Space', key: ' ' });
  assert.deepEqual(commands, [GAME_COMMAND.PRIMARY]);
});

test('a key released while a dialog is open is still let go, so it cannot get stuck', () => {
  const { input, window, document } = setup();

  press(window, { code: 'KeyD', key: 'd' });
  document.openDialog = { tagName: 'DIALOG' };
  release(window, { code: 'KeyD', key: 'd' });

  assert.equal(input.snapshot().horizontalAxis, 0);
});
