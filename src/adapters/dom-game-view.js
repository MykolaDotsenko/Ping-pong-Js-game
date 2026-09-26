import { DIFFICULTIES, GAME_COMMAND } from '../application/ports.js';
import { GAME_PHASE } from '../domain/game.js';

/**
 * @import { GamePhase, Side } from '../domain/types.js'
 * @import {
 *   CommandHandler,
 *   Difficulty,
 *   GameCommand,
 *   Presentation,
 *   PreferencesPort,
 *   ViewPort,
 * } from '../application/ports.js'
 */

/** @type {readonly string[]} */
const COMMANDS = Object.values(GAME_COMMAND);
const DIFFICULTY_LABELS = Object.freeze({ easy: 'Easy', normal: 'Normal', hard: 'Hard' });

/**
 * The HTML around the board: the HUD, the menu, pause and result overlays, and the
 * settings. Controls declare what they do with data attributes: data-command sends a game
 * command, data-difficulty picks the next match's difficulty, and data-setting toggles a
 * preference such as sound.
 *
 * @implements {ViewPort}
 */
export class DomGameView {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root element containing the whole game UI
   * @param {HTMLElement} options.board receives focus after a command, so Space and arrows reach the game
   * @param {PreferencesPort} options.preferences
   * @param {boolean} options.canVibrate hides the vibration setting where it would do nothing
   */
  constructor({ root, board, preferences, canVibrate }) {
    this.root = root;
    this.board = board;
    this.preferences = preferences;
    this.canVibrate = canVibrate;
    this.status = this.find('[data-game-status]');
    this.scores = { player: this.find('[data-score="player"]'), opponent: this.find('[data-score="opponent"]') };
    this.overlays = {
      menu: this.find('[data-overlay="menu"]'),
      pause: this.find('[data-overlay="pause"]'),
      over: this.find('[data-overlay="over"]'),
    };
    this.pauseButton = this.find('[data-hud-pause]');
    /** @type {Presentation | null} */
    this.rendered = null;
    /** @type {Array<[HTMLElement, EventListener]>} */
    this.listeners = [];
    /** @type {CommandHandler} */
    this.commandHandler = () => {};
  }

  /**
   * @param {string} selector
   * @returns {HTMLElement}
   */
  find(selector) {
    const element = this.root.querySelector(selector);

    if (!element) {
      throw new Error(`Ping Pong could not start because ${selector} is missing from the page.`);
    }

    return /** @type {HTMLElement} */ (element);
  }

  /** @param {string} selector */
  findAll(selector) {
    return /** @type {HTMLElement[]} */ ([...this.root.querySelectorAll(selector)]);
  }

  /** @param {CommandHandler} handler */
  onCommand(handler) {
    this.commandHandler = handler;
  }

  connect() {
    for (const button of this.findAll('[data-command]')) {
      const command = button.dataset.command ?? '';

      if (COMMANDS.includes(command)) {
        this.listen(button, () => {
          // Bring the whole court into view, since scrolling locks while a match runs.
          this.root.scrollIntoView?.({ block: 'nearest' });
          // Hand focus back to the board. A focused button would otherwise swallow Space
          // (re-activating itself) instead of letting it pause or resume the match.
          this.board.focus({ preventScroll: true });
          this.commandHandler(/** @type {GameCommand} */ (command));
        });
      }
    }

    for (const button of this.findAll('[data-difficulty]')) {
      const level = DIFFICULTIES.find((difficulty) => difficulty === button.dataset.difficulty);

      if (level) {
        this.listen(button, () => {
          this.preferences.set({ difficulty: level });
          this.showDifficulty();
        });
      }
    }

    for (const button of this.findAll('[data-setting]')) {
      const setting = button.dataset.setting;

      if (setting === 'sound' || setting === 'vibration') {
        this.listen(button, () => {
          this.preferences.set({ [setting]: !this.preferences.get()[setting] });
          this.showSettings();
        });
      }
    }

    for (const element of this.findAll('[data-setting="vibration"]')) {
      element.hidden = !this.canVibrate;
    }

    this.showDifficulty();
    this.showSettings();
  }

  disconnect() {
    for (const [button, listener] of this.listeners) {
      button.removeEventListener('click', listener);
    }
    this.listeners = [];
  }

  /**
   * @param {HTMLElement} button
   * @param {EventListener} listener
   */
  listen(button, listener) {
    button.addEventListener('click', listener);
    this.listeners.push([button, listener]);
  }

  showDifficulty() {
    const { difficulty } = this.preferences.get();

    for (const button of this.findAll('[data-difficulty]')) {
      button.setAttribute('aria-pressed', String(button.dataset.difficulty === difficulty));
    }
  }

  showSettings() {
    const preferences = this.preferences.get();

    for (const button of this.findAll('[data-setting]')) {
      const setting = button.dataset.setting;

      if (setting === 'sound' || setting === 'vibration') {
        button.setAttribute('aria-pressed', String(preferences[setting]));
      }
    }
  }

  /** @param {Presentation} presentation */
  render(presentation) {
    // render() runs every frame during a match. Only touch the DOM when something changed:
    // the status element is an aria-live region, and rewriting it could spam screen readers.
    const previous = this.rendered;

    if (presentation.phase !== previous?.phase) {
      this.showPhase(presentation.phase);
    }

    if (presentation.status !== previous?.status) {
      this.status.textContent = presentation.status;
    }

    for (const side of /** @type {Side[]} */ (['player', 'opponent'])) {
      const score = presentation.score[side];

      if (score !== previous?.score[side]) {
        this.scores[side].textContent = String(score);

        if (previous && score > previous.score[side]) {
          restartAnimation(this.scores[side], 'is-popping');
        }
      }
    }

    if (presentation.bestRally !== previous?.bestRally) {
      for (const element of this.findAll('[data-best-rally]')) {
        element.textContent = String(presentation.bestRally);
      }
    }

    if (presentation.phase === GAME_PHASE.GAME_OVER && previous?.phase !== GAME_PHASE.GAME_OVER) {
      this.showResult(presentation);
    }

    this.rendered = presentation;
  }

  /** @param {GamePhase} phase */
  showPhase(phase) {
    const inMatch = phase === GAME_PHASE.RUNNING || phase === GAME_PHASE.PAUSED;

    this.root.dataset.phase = phase;
    this.overlays.menu.hidden = phase !== GAME_PHASE.READY;
    this.overlays.pause.hidden = phase !== GAME_PHASE.PAUSED;
    this.overlays.over.hidden = phase !== GAME_PHASE.GAME_OVER;
    this.pauseButton.toggleAttribute('disabled', !inMatch);
    this.pauseButton.setAttribute('aria-label', phase === GAME_PHASE.PAUSED ? 'Resume' : 'Pause');
  }

  /** @param {Presentation} presentation */
  showResult({ winner, score, longestRally, newBest }) {
    const title = this.find('[data-over-title]');
    const difficulty = /** @type {Difficulty} */ (this.preferences.get().difficulty);

    title.textContent = winner === 'player' ? 'Victory' : 'Defeat';
    title.dataset.winner = winner ?? '';
    this.find('[data-over-score]').textContent = `${score.player} : ${score.opponent}`;
    this.find('[data-over-rally]').textContent = String(longestRally);
    this.find('[data-over-difficulty]').textContent = DIFFICULTY_LABELS[difficulty];
    this.find('[data-over-best]').hidden = !newBest;
  }
}

/**
 * Replays a CSS animation by removing and re-adding its class. Reduced-motion styles can
 * switch the animation off without any script changes.
 *
 * @param {HTMLElement} element
 * @param {string} className
 */
function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
