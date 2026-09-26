import { GAME_COMMAND } from '../application/ports.js';

/**
 * @import { InputSnapshot } from '../domain/types.js'
 * @import { CommandHandler, InputPort } from '../application/ports.js'
 */

// Physical key codes rather than characters, so A/D also work on Cyrillic, AZERTY and other layouts.
const PLAYER_KEYS = Object.freeze({ left: new Set(['ArrowLeft', 'KeyA']), right: new Set(['ArrowRight', 'KeyD']) });
// A second person on the same keyboard uses the far side of it.
const OPPONENT_KEYS = Object.freeze({ left: new Set(['KeyJ', 'Numpad4']), right: new Set(['KeyL', 'Numpad6']) });
const INTERACTIVE_TAGS = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
const INTERACTIVE_SELECTOR = INTERACTIVE_TAGS.join(',').toLowerCase();

/**
 * Whether the event came from a control (or something inside one, like an icon), which keeps
 * its own meaning for Space and taps.
 *
 * @param {EventTarget | null} target
 */
function isInteractiveTarget(target) {
  const element = /** @type {{ tagName?: string, closest?: (selector: string) => unknown } | null} */ (target);

  if (!element) {
    return false;
  }

  if (typeof element.closest === 'function') {
    return element.closest(INTERACTIVE_SELECTOR) !== null;
  }

  return element.tagName !== undefined && INTERACTIVE_TAGS.includes(element.tagName);
}

/**
 * One paddle's steering: held keys and the pointer that last steered it.
 */
class PaddleInput {
  constructor() {
    this.leftPressed = false;
    this.rightPressed = false;
    /** @type {number | null} Board x of the pointer while it steers; null while the keyboard does. */
    this.pointerX = null;
    /** @type {number | null} */
    this.lastClientX = null;
    /** @type {number | null} The pointer this paddle follows, so two fingers stay with their own paddles. */
    this.pointerId = null;
  }

  release() {
    this.leftPressed = false;
    this.rightPressed = false;
    this.pointerX = null;
    this.pointerId = null;
  }

  get axis() {
    return Number(this.rightPressed) - Number(this.leftPressed);
  }
}

/** @implements {InputPort} */
export class InputController {
  /**
   * @param {object} options
   * @param {HTMLElement} options.surface area that listens for pointers, which may extend
   *   beyond the board so a thumb can steer from below it without covering the play
   * @param {HTMLElement} options.board element whose width maps pointer positions onto the court
   * @param {Window} options.window
   * @param {Document} options.document
   * @param {{ width: number }} options.config
   */
  constructor({ surface, board, window, document, config }) {
    this.surface = surface;
    this.board = board;
    this.window = window;
    this.document = document;
    this.config = config;
    this.players = 1;
    this.player = new PaddleInput();
    this.opponent = new PaddleInput();
    /** @type {Array<[EventTarget, string, EventListener]>} */
    this.listeners = [];
    /** @type {CommandHandler} */
    this.commandHandler = () => {};
  }

  /** @param {CommandHandler} handler */
  onCommand(handler) {
    this.commandHandler = handler;
  }

  /**
   * With two players, touches on the top half of the board steer the top paddle and the
   * rest steer the bottom one; with one, every touch steers the bottom paddle.
   *
   * @param {{ players: 1 | 2 }} layout
   */
  configure({ players }) {
    this.players = players;
    this.opponent.release();
  }

  connect() {
    this.listen(this.window, 'keydown', (event) => this.handleKeyDown(/** @type {KeyboardEvent} */ (event)));
    this.listen(this.window, 'keyup', (event) => this.handleKeyUp(/** @type {KeyboardEvent} */ (event)));
    this.listen(this.window, 'blur', () => this.handleFocusLoss());
    this.listen(this.document, 'visibilitychange', () => {
      if (this.document.visibilityState === 'hidden') {
        this.handleFocusLoss();
      }
    });
    this.listen(this.surface, 'pointerdown', (event) => this.handlePointer(/** @type {PointerEvent} */ (event), true));
    this.listen(this.surface, 'pointermove', (event) => this.handlePointer(/** @type {PointerEvent} */ (event), false));
    this.listen(this.surface, 'pointerup', (event) => this.releasePointer(/** @type {PointerEvent} */ (event)));
    this.listen(this.surface, 'pointercancel', (event) => this.releasePointer(/** @type {PointerEvent} */ (event)));
  }

  disconnect() {
    for (const [target, type, listener] of this.listeners) {
      target.removeEventListener(type, listener);
    }
    this.listeners = [];
  }

  /**
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListener} listener
   */
  listen(target, type, listener) {
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }

  /**
   * @param {KeyboardEvent} event
   * @param {boolean} pressed
   * @returns {boolean} whether the key steers a paddle
   */
  steerByKey(event, pressed) {
    const sides = /** @type {const} */ ([
      [this.player, PLAYER_KEYS],
      [this.opponent, this.players === 2 ? OPPONENT_KEYS : null],
    ]);

    for (const [paddle, keys] of sides) {
      if (!keys) {
        continue;
      }

      const isLeft = keys.left.has(event.code);

      if (!isLeft && !keys.right.has(event.code)) {
        continue;
      }

      if (isLeft) {
        paddle.leftPressed = pressed;
      } else {
        paddle.rightPressed = pressed;
      }

      if (pressed && !event.repeat) {
        paddle.pointerX = null; // The most recently used device steers.
        paddle.pointerId = null;
      }

      return true;
    }

    return false;
  }

  /**
   * Whether a dialog is open over the game, such as the tutorial. The page behind a modal
   * dialog takes no input, and its keys (Space, Escape, Enter) belong to the dialog.
   */
  dialogOpen() {
    return Boolean(this.document.querySelector?.('dialog[open]'));
  }

  /** @param {KeyboardEvent} event */
  handleKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return; // Leave browser and system shortcuts such as Ctrl+A or Alt+← alone.
    }

    if (this.dialogOpen()) {
      return;
    }

    if (this.steerByKey(event, true)) {
      event.preventDefault();
      return;
    }

    if (event.repeat) {
      return;
    }

    if (event.code === 'Space' && !isInteractiveTarget(event.target)) {
      this.commandHandler(GAME_COMMAND.PRIMARY);
      event.preventDefault();
    } else if (event.code === 'Escape') {
      this.commandHandler(GAME_COMMAND.TOGGLE_PAUSE);
    }
  }

  /** @param {KeyboardEvent} event */
  handleKeyUp(event) {
    // Releases are honored even while a modifier is held, so no key can get stuck.
    this.steerByKey(event, false);
  }

  // Key-up events are lost while the page is unfocused, so release everything and pause.
  handleFocusLoss() {
    this.player.release();
    this.opponent.release();
    this.commandHandler(GAME_COMMAND.PAUSE);
  }

  /**
   * Which paddle a pointer belongs to: the one already following it, else the one for the
   * half of the board it touched.
   *
   * @param {PointerEvent} event
   * @param {DOMRect} rect
   */
  paddleFor(event, rect) {
    if (this.players !== 2) {
      return this.player;
    }

    if (this.player.pointerId === event.pointerId) {
      return this.player;
    }

    if (this.opponent.pointerId === event.pointerId) {
      return this.opponent;
    }

    return event.clientY < rect.top + rect.height / 2 ? this.opponent : this.player;
  }

  /**
   * @param {PointerEvent} event
   * @param {boolean} isPress a press (click or tap) always takes over steering
   */
  handlePointer(event, isPress) {
    if (isInteractiveTarget(event.target) || this.dialogOpen()) {
      return; // Buttons on the surface, and any open dialog, keep their own meaning.
    }

    const rect = this.board.getBoundingClientRect();
    const paddle = this.paddleFor(event, rect);

    // Moves without horizontal travel (vertical or synthetic) must not take over from the keyboard.
    if (!isPress && event.clientX === paddle.lastClientX) {
      return;
    }

    // In a two-player match a finger commits to a paddle only by pressing, so a hover from
    // the other half cannot steal it.
    if (this.players === 2 && !isPress && paddle.pointerId !== event.pointerId && paddle.pointerId !== null) {
      return;
    }

    if (isPress || paddle.pointerId === null) {
      paddle.pointerId = event.pointerId;
    }

    paddle.lastClientX = event.clientX;
    paddle.pointerX = ((event.clientX - rect.left) / rect.width) * this.config.width;
  }

  /** @param {PointerEvent} event */
  releasePointer(event) {
    for (const paddle of [this.player, this.opponent]) {
      if (paddle.pointerId === event.pointerId) {
        // The paddle stays where the finger left it; only the binding is dropped.
        paddle.pointerId = null;
      }
    }
  }

  /** @returns {InputSnapshot} */
  snapshot() {
    return {
      horizontalAxis: this.player.axis,
      pointerX: this.player.pointerX,
      opponentAxis: this.opponent.axis,
      opponentPointerX: this.opponent.pointerX,
    };
  }
}
