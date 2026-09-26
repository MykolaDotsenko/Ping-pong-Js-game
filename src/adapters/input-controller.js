import { GAME_COMMAND } from '../application/ports.js';

/**
 * @import { InputSnapshot } from '../domain/types.js'
 * @import { CommandHandler, InputPort } from '../application/ports.js'
 */

// Physical key codes rather than characters, so A/D also work on Cyrillic, AZERTY and other layouts.
const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

/**
 * @param {EventTarget | null} target
 */
function isInteractiveTarget(target) {
  const { tagName } = /** @type {{ tagName?: string } | null} */ (target) ?? {};
  return tagName !== undefined && INTERACTIVE_TAGS.has(tagName);
}

/** @implements {InputPort} */
export class InputController {
  /**
   * @param {object} options
   * @param {HTMLElement} options.surface element that receives pointer input
   * @param {Window} options.window
   * @param {Document} options.document
   * @param {{ width: number }} options.config
   */
  constructor({ surface, window, document, config }) {
    this.surface = surface;
    this.window = window;
    this.document = document;
    this.config = config;
    this.leftPressed = false;
    this.rightPressed = false;
    /** @type {number | null} Board x of the pointer while it steers; null while the keyboard does. */
    this.pointerX = null;
    /** @type {number | null} */
    this.lastClientX = null;
    /** @type {Array<[EventTarget, string, EventListener]>} */
    this.listeners = [];
    /** @type {CommandHandler} */
    this.commandHandler = () => {};
  }

  /** @param {CommandHandler} handler */
  onCommand(handler) {
    this.commandHandler = handler;
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

  /** @param {KeyboardEvent} event */
  handleKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return; // Leave browser and system shortcuts such as Ctrl+A or Alt+← alone.
    }

    const isLeft = LEFT_KEYS.has(event.code);

    if (isLeft || RIGHT_KEYS.has(event.code)) {
      if (isLeft) {
        this.leftPressed = true;
      } else {
        this.rightPressed = true;
      }

      if (!event.repeat) {
        this.pointerX = null; // The most recently used device steers.
      }

      event.preventDefault();
      return;
    }

    if (event.code === 'Space' && !event.repeat && !isInteractiveTarget(event.target)) {
      this.commandHandler(GAME_COMMAND.PRIMARY);
      event.preventDefault();
    }
  }

  /** @param {KeyboardEvent} event */
  handleKeyUp(event) {
    // Releases are honored even while a modifier is held, so no key can get stuck.
    if (LEFT_KEYS.has(event.code)) {
      this.leftPressed = false;
    }

    if (RIGHT_KEYS.has(event.code)) {
      this.rightPressed = false;
    }
  }

  // Key-up events are lost while the page is unfocused, so release everything and pause.
  handleFocusLoss() {
    this.leftPressed = false;
    this.rightPressed = false;
    this.pointerX = null;
    this.commandHandler(GAME_COMMAND.PAUSE);
  }

  /**
   * @param {PointerEvent} event
   * @param {boolean} isPress a press (click or tap) always takes over steering
   */
  handlePointer(event, isPress) {
    // Moves without horizontal travel (vertical or synthetic) must not take over from the keyboard.
    if (!isPress && event.clientX === this.lastClientX) {
      return;
    }

    this.lastClientX = event.clientX;
    const rect = this.surface.getBoundingClientRect();
    this.pointerX = ((event.clientX - rect.left) / rect.width) * this.config.width;
  }

  /** @returns {InputSnapshot} */
  snapshot() {
    return {
      horizontalAxis: Number(this.rightPressed) - Number(this.leftPressed),
      pointerX: this.pointerX,
    };
  }
}
