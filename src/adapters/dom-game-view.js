import { GAME_COMMAND } from '../application/ports.js';
import { GAME_PHASE } from '../domain/game.js';

/**
 * @import { CommandHandler, GameCommand, Presentation, ViewPort } from '../application/ports.js'
 */

/** @implements {ViewPort} */
export class DomGameView {
  /**
   * @param {object} elements
   * @param {HTMLButtonElement} elements.startButton
   * @param {HTMLButtonElement} elements.pauseButton
   * @param {HTMLButtonElement} elements.resetButton
   * @param {HTMLElement} elements.status
   * @param {HTMLElement} elements.board receives focus after a control is used
   */
  constructor({ startButton, pauseButton, resetButton, status, board }) {
    this.startButton = startButton;
    this.pauseButton = pauseButton;
    this.resetButton = resetButton;
    this.status = status;
    this.board = board;
    /** @type {Presentation | null} */
    this.rendered = null;
    /** @type {Array<[HTMLButtonElement, EventListener]>} */
    this.listeners = [];
    /** @type {CommandHandler} */
    this.commandHandler = () => {};
  }

  /** @param {CommandHandler} handler */
  onCommand(handler) {
    this.commandHandler = handler;
  }

  connect() {
    this.bind(this.startButton, GAME_COMMAND.START);
    this.bind(this.pauseButton, GAME_COMMAND.TOGGLE_PAUSE);
    this.bind(this.resetButton, GAME_COMMAND.RESET);
  }

  disconnect() {
    for (const [button, listener] of this.listeners) {
      button.removeEventListener('click', listener);
    }
    this.listeners = [];
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {GameCommand} command
   */
  bind(button, command) {
    const listener = () => {
      // Hand focus back to the board. A focused button would otherwise swallow Space
      // (re-activating itself) instead of letting it pause or resume the match.
      this.board.focus({ preventScroll: true });
      this.commandHandler(command);
    };

    button.addEventListener('click', listener);
    this.listeners.push([button, listener]);
  }

  /** @param {Presentation} presentation */
  render({ phase, status }) {
    // render() runs every frame during a match. Only touch the DOM when something changed:
    // the status element is an aria-live region, and rewriting it could spam screen readers.
    if (this.rendered?.status !== status) {
      this.status.textContent = status;
    }

    if (this.rendered?.phase !== phase) {
      const inMatch = phase === GAME_PHASE.RUNNING || phase === GAME_PHASE.PAUSED;
      this.startButton.disabled = inMatch;
      this.pauseButton.disabled = !inMatch;
      this.pauseButton.textContent = phase === GAME_PHASE.PAUSED ? 'Resume' : 'Pause';
    }

    this.rendered = { phase, status };
  }
}
