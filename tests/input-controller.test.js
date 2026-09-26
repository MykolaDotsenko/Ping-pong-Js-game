import test from 'node:test';
import assert from 'node:assert/strict';

import { InputController } from '../src/adapters/input-controller.js';
import { GAME_COMMAND } from '../src/application/ports.js';

// The pointer surface (board plus thumb rail) listens for events; the board, 800 units wide
// and displayed 400px wide 100px from the left edge, maps them onto the court.
const board = {
  getBoundingClientRect: () => ({ left: 100, width: 400 }),
};

function setup() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
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

function pointerEvent(type, clientX) {
  return Object.assign(new Event(type), { clientX });
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
  assert.deepEqual(input.snapshot(), { horizontalAxis: -1, pointerX: null });
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

  assert.deepEqual(input.snapshot(), { horizontalAxis: 0, pointerX: null });
  assert.deepEqual(commands, [GAME_COMMAND.PAUSE]);
});

test('hiding the page pauses, showing it again does nothing', () => {
  const { document, commands } = setup();

  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));

  assert.deepEqual(commands, [GAME_COMMAND.PAUSE]);
});

test('disconnect removes every listener', () => {
  const { input, window, surface, commands } = setup();

  input.disconnect();
  press(window, { code: 'KeyA' });
  press(window, { code: 'Space' });
  surface.dispatchEvent(pointerEvent('pointerdown', 300));
  window.dispatchEvent(new Event('blur'));

  assert.deepEqual(input.snapshot(), { horizontalAxis: 0, pointerX: null });
  assert.deepEqual(commands, []);
});
