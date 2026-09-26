import { DIFFICULTIES, GAME_COMMAND, MODES } from '../application/ports.js';
import { GAME_PHASE } from '../domain/game.js';

/**
 * @import { GamePhase, Side } from '../domain/types.js'
 * @import {
 *   CommandHandler,
 *   Difficulty,
 *   GameCommand,
 *   Mode,
 *   Presentation,
 *   PreferencesPort,
 *   TrackId,
 *   ViewPort,
 * } from '../application/ports.js'
 */

/** @type {readonly string[]} */
const COMMANDS = Object.values(GAME_COMMAND);
const DIFFICULTY_LABELS = Object.freeze({ easy: 'Easy', normal: 'Normal', hard: 'Hard' });
const MODE_TIPS = Object.freeze({
  solo: 'Flick the paddle as you hit to curve the ball.',
  rush: 'The ball only gets faster. Curve it past the computer to keep your lives.',
  duo: 'Player 1 steers from the bottom half, Player 2 from the top.',
});
const TOGGLE_SETTINGS = /** @type {const} */ (['sound', 'music', 'vibration', 'powerUps']);

/**
 * @typedef {typeof TOGGLE_SETTINGS[number]} ToggleSetting
 * @typedef {object} Device
 * @property {boolean} canShare
 * @property {boolean} canFullscreen
 * @property {(text: string) => Promise<'shared' | 'copied' | 'cancelled' | 'failed'>} share
 * @property {() => Promise<void>} toggleFullscreen
 */

/**
 * The HTML around the board: the HUD, the menu with its modes and settings, the tutorial,
 * pause and result overlays. Controls declare what they do with data attributes:
 * data-command sends a game command, data-mode and data-difficulty pick the next match,
 * data-setting toggles a preference such as sound, and data-track picks the next music track.
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
   * @param {Device} options.device sharing and full screen, hidden where unsupported
   * @param {number} options.rushLives shown on the Rush button before that mode is chosen
   * @param {readonly { id: TrackId, label: string }[]} options.tracks the music tracks, in the order the track button cycles
   * @param {(track: TrackId) => void} options.previewTrack plays a short sample of the chosen track
   */
  constructor({ root, board, preferences, canVibrate, device, rushLives, tracks, previewTrack }) {
    this.root = root;
    this.board = board;
    this.preferences = preferences;
    this.canVibrate = canVibrate;
    this.device = device;
    this.rushLives = rushLives;
    this.tracks = tracks;
    this.previewTrack = previewTrack;
    this.status = this.find('[data-game-status]');
    this.scores = { player: this.find('[data-score="player"]'), opponent: this.find('[data-score="opponent"]') };
    this.overlays = {
      menu: this.find('[data-overlay="menu"]'),
      tutorial: this.find('[data-overlay="tutorial"]'),
      pause: this.find('[data-overlay="pause"]'),
      over: this.find('[data-overlay="over"]'),
    };
    this.pauseButton = this.find('[data-hud-pause]');
    this.lives = this.find('[data-lives]');
    this.matchPoint = this.find('[data-match-point]');
    /** @type {Presentation | null} */
    this.rendered = null;
    /** @type {Presentation | null} */
    this.lastResult = null;
    /** @type {Array<[HTMLElement, string, EventListener]>} */
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

    for (const button of this.findAll('[data-mode]')) {
      const mode = MODES.find((candidate) => candidate === button.dataset.mode);

      if (mode) {
        this.listen(button, () => {
          this.preferences.set({ mode });
          this.showChoices();
          // The menu's status line and layout depend on the mode, so redraw it right away.
          this.commandHandler(GAME_COMMAND.RESET);
        });
      }
    }

    for (const button of this.findAll('[data-difficulty]')) {
      const level = DIFFICULTIES.find((difficulty) => difficulty === button.dataset.difficulty);

      if (level) {
        this.listen(button, () => {
          this.preferences.set({ difficulty: level });
          this.showChoices();
        });
      }
    }

    for (const button of this.findAll('[data-setting]')) {
      const setting = TOGGLE_SETTINGS.find((candidate) => candidate === button.dataset.setting);

      if (setting) {
        this.listen(button, () => {
          this.preferences.set({ [setting]: !this.preferences.get()[setting] });
          this.showSettings();
        });
      }
    }

    for (const button of this.findAll('[data-track]')) {
      this.listen(button, () => this.nextTrack());
    }

    for (const button of this.findAll('[data-show-tutorial]')) {
      this.listen(button, () => this.showTutorial(true));
    }

    for (const button of this.findAll('[data-dismiss-tutorial]')) {
      this.listen(button, () => this.showTutorial(false));
    }

    // Escape closes the dialog natively, the button through showTutorial; either way the
    // player has seen it. Escape fires 'cancel' at once and 'close' only in a later task, so
    // listening to both saves the choice even if the page is left right away.
    this.listen(this.overlays.tutorial, () => this.markTutorialSeen(), 'cancel');
    this.listen(this.overlays.tutorial, () => this.markTutorialSeen(), 'close');

    for (const button of this.findAll('[data-share]')) {
      button.hidden = !this.device.canShare;
      this.listen(button, () => this.shareResult());
    }

    for (const button of this.findAll('[data-fullscreen]')) {
      button.hidden = !this.device.canFullscreen;
      this.listen(button, () => {
        this.device.toggleFullscreen();
      });
    }

    for (const element of this.findAll('[data-setting="vibration"]')) {
      element.hidden = !this.canVibrate;
    }

    for (const element of this.findAll('[data-rush-lives]')) {
      element.textContent = `${this.rushLives} lives`;
    }

    this.showChoices();
    this.showSettings();

    // First visit: explain the controls before the first match. Otherwise make sure the
    // tutorial is closed, whatever state the markup arrived in.
    this.showTutorial(!this.preferences.get().tutorialSeen);
  }

  disconnect() {
    for (const [target, type, listener] of this.listeners) {
      target.removeEventListener(type, listener);
    }
    this.listeners = [];
  }

  /**
   * @param {HTMLElement} target
   * @param {EventListener} listener
   * @param {string} [type]
   */
  listen(target, listener, type = 'click') {
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }

  /** Reflects the chosen mode and difficulty on their buttons and the menu. */
  showChoices() {
    const { mode, difficulty } = this.preferences.get();

    for (const button of this.findAll('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }

    for (const button of this.findAll('[data-difficulty]')) {
      button.setAttribute('aria-pressed', String(button.dataset.difficulty === difficulty));
    }

    for (const element of this.findAll('[data-solo-only]')) {
      element.hidden = mode !== 'solo';
    }

    for (const element of this.findAll('[data-not-rush]')) {
      element.hidden = mode === 'rush';
    }

    for (const element of this.findAll('[data-mode-tip]')) {
      element.textContent = MODE_TIPS[mode];
    }

    this.root.dataset.mode = mode;
  }

  showSettings() {
    const preferences = this.preferences.get();

    for (const button of this.findAll('[data-setting]')) {
      const setting = TOGGLE_SETTINGS.find((candidate) => candidate === button.dataset.setting);

      if (setting) {
        button.setAttribute('aria-pressed', String(preferences[setting]));
      }
    }

    const track = this.currentTrack();

    for (const button of this.findAll('[data-track]')) {
      button.textContent = track.label;
      button.setAttribute('aria-label', `Music track: ${track.label}`);
    }
  }

  currentTrack() {
    const { track } = this.preferences.get();
    return this.tracks.find((candidate) => candidate.id === track) ?? this.tracks[0];
  }

  /** Moves to the next track, turns the music on so it can be heard, and plays a sample. */
  nextTrack() {
    const next = this.tracks[(this.tracks.indexOf(this.currentTrack()) + 1) % this.tracks.length];

    this.preferences.set({ track: next.id, music: true });
    this.showSettings();
    this.previewTrack(next.id);
  }

  /**
   * Opens the tutorial as a modal dialog, which makes the page behind it inert and moves focus
   * to its button, or closes it. Browsers without modal dialogs still show it.
   *
   * @param {boolean} visible
   */
  showTutorial(visible) {
    const dialog = /** @type {HTMLDialogElement} */ (this.overlays.tutorial);
    const open = dialog.hasAttribute('open');

    if (visible && !open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    } else if (!visible && open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }

      this.markTutorialSeen();
    }
  }

  markTutorialSeen() {
    if (!this.preferences.get().tutorialSeen) {
      this.preferences.set({ tutorialSeen: true });
    }
  }

  /**
   * Keeps keyboard focus where the game can use it: on the pause and result screens' main
   * button when they appear, and back on the board when play resumes. Focus elsewhere on the
   * page, such as a link the player moved to, is left alone.
   *
   * @param {GamePhase} phase
   */
  guideFocus(phase) {
    const document = this.root.ownerDocument;
    const active = document?.activeElement;
    const inGame = !active || active === document.body || this.root.contains(active);

    if (!inGame) {
      return;
    }

    if (phase === GAME_PHASE.PAUSED || phase === GAME_PHASE.GAME_OVER) {
      this.find(`[data-focus="${phase === GAME_PHASE.PAUSED ? 'pause' : 'over'}"]`).focus({ preventScroll: true });
    } else if (phase === GAME_PHASE.RUNNING && active !== this.board) {
      this.board.focus({ preventScroll: true });
    }
  }

  async shareResult() {
    const result = this.lastResult;
    const note = this.find('[data-share-note]');

    if (!result) {
      return;
    }

    const text = result.mode === 'rush'
      ? `I survived ${result.hits.player} hits in Rush mode of Ping Pong Architecture Lab. Beat that!`
      : `I ${result.winner === 'player' ? 'won' : 'lost'} ${result.score.player}:${result.score.opponent} on ${DIFFICULTY_LABELS[result.difficulty]} in Ping Pong Architecture Lab. Longest rally: ${result.longestRally}.`;
    const outcome = await this.device.share(text);

    note.textContent = { shared: '', copied: 'Copied to clipboard', cancelled: '', failed: 'Sharing is not available here' }[outcome];
  }

  /** @param {Presentation} presentation */
  render(presentation) {
    // render() runs every frame during a match. Only touch the DOM when something changed:
    // the status element is an aria-live region, and rewriting it could spam screen readers.
    const previous = this.rendered;

    if (presentation.phase !== previous?.phase || presentation.mode !== previous?.mode) {
      this.showPhase(presentation.phase, presentation.mode);
    }

    if (presentation.status !== previous?.status) {
      this.status.textContent = presentation.status;
    }

    for (const side of /** @type {Side[]} */ (['player', 'opponent'])) {
      const score = presentation.mode === 'rush' ? presentation.hits : presentation.score;
      const value = score[side];
      const previousValue = previous ? (previous.mode === 'rush' ? previous.hits : previous.score)[side] : null;

      if (value !== previousValue) {
        this.scores[side].textContent = String(value);

        if (previous && previousValue !== null && value > previousValue) {
          restartAnimation(this.scores[side], 'is-popping');
        }
      }
    }

    if (presentation.lives !== previous?.lives || presentation.maxLives !== previous?.maxLives) {
      this.showLives(presentation.lives, presentation.maxLives);
    }

    if (presentation.matchPoint !== previous?.matchPoint) {
      this.matchPoint.hidden = presentation.matchPoint === null;
      this.matchPoint.dataset.side = presentation.matchPoint ?? '';
    }

    if (
      presentation.bestRally !== previous?.bestRally
      || presentation.bestRush !== previous?.bestRush
      || presentation.mode !== previous?.mode
      || presentation.rules !== previous?.rules
    ) {
      this.showMenuMeta(presentation);
    }

    if (presentation.stats !== previous?.stats || presentation.mode !== previous?.mode) {
      this.showStats(presentation);
    }

    if (presentation.phase === GAME_PHASE.GAME_OVER && previous?.phase !== GAME_PHASE.GAME_OVER) {
      this.showResult(presentation);
    }

    this.rendered = presentation;
  }

  /**
   * @param {GamePhase} phase
   * @param {Mode} mode
   */
  showPhase(phase, mode) {
    const inMatch = phase === GAME_PHASE.RUNNING || phase === GAME_PHASE.PAUSED;
    const phaseChanged = phase !== this.rendered?.phase;

    this.root.dataset.phase = phase;
    this.root.dataset.mode = mode;
    this.overlays.menu.hidden = phase !== GAME_PHASE.READY;
    this.overlays.pause.hidden = phase !== GAME_PHASE.PAUSED;
    this.overlays.over.hidden = phase !== GAME_PHASE.GAME_OVER;

    if (phaseChanged && this.rendered !== null) {
      this.guideFocus(phase);
    }
    this.pauseButton.toggleAttribute('disabled', !inMatch);
    this.pauseButton.setAttribute('aria-label', phase === GAME_PHASE.PAUSED ? 'Resume' : 'Pause');
    this.find('[data-label="opponent"]').textContent = mode === 'duo' ? 'P2' : 'CPU';
    this.find('[data-label="player"]').textContent = { solo: 'You', rush: 'Hits', duo: 'P1' }[mode];

    if (phase !== GAME_PHASE.READY) {
      this.find('[data-share-note]').textContent = '';
    }
  }

  /**
   * @param {number} lives
   * @param {number} maxLives
   */
  showLives(lives, maxLives) {
    this.lives.hidden = maxLives === 0;
    this.lives.textContent = '';

    for (let i = 0; i < maxLives; i += 1) {
      const heart = this.lives.ownerDocument.createElement('span');
      heart.className = i < lives ? 'lives__heart' : 'lives__heart lives__heart--lost';
      heart.textContent = '♥';
      this.lives.appendChild(heart);
    }
  }

  /**
   * The menu's summary line: how this mode is won, and the record that goes with it. The
   * rules come from the match configuration, so the text cannot drift from the game.
   *
   * @param {Presentation} presentation
   */
  showMenuMeta({ mode, rules, bestRally, bestRush }) {
    const goal = rules.kind === 'rush' ? `${rules.lives} lives` : `First to ${rules.winningScore}`;

    for (const element of this.findAll('[data-menu-meta]')) {
      if (mode === 'duo') {
        element.replaceChildren(`${goal} · Two players, one screen`);
        continue;
      }

      const record = element.ownerDocument.createElement('strong');
      record.textContent = String(mode === 'rush' ? bestRush : bestRally);
      element.replaceChildren(...(mode === 'rush'
        ? [`${goal} · Best run `, record, ' hits']
        : [`${goal} · Best rally `, record]));
    }
  }

  /**
   * Solo win statistics. A streak earns a flame, which is decoration: screen readers skip it.
   *
   * @param {Presentation} presentation
   */
  showStats({ mode, stats }) {
    for (const element of this.findAll('[data-stats]')) {
      const show = mode === 'solo' && stats.matches > 0;
      element.hidden = !show;

      if (!show) {
        continue;
      }

      const rate = Math.round((stats.wins / stats.matches) * 100);
      const summary = `${stats.wins}/${stats.matches} won (${rate}%)`;

      if (stats.streak >= 2) {
        const flame = element.ownerDocument.createElement('span');
        flame.setAttribute('aria-hidden', 'true');
        flame.textContent = '🔥';
        element.replaceChildren(`${summary} · ${stats.streak} in a row `, flame);
      } else {
        element.replaceChildren(summary);
      }
    }
  }

  /** @param {Presentation} presentation */
  showResult(presentation) {
    const { winner, score, hits, longestRally, newBest, newBestRush, mode, difficulty } = presentation;
    const title = this.find('[data-over-title]');
    const rush = mode === 'rush';

    this.lastResult = presentation;
    title.textContent = rush ? 'Run over' : winner === 'player' ? 'Victory' : 'Defeat';
    title.dataset.winner = rush ? 'opponent' : (winner ?? '');
    this.find('[data-over-score]').textContent = rush ? `${hits.player} hits` : `${score.player} : ${score.opponent}`;
    this.find('[data-over-rally]').textContent = String(longestRally);
    this.find('[data-over-difficulty]').textContent = rush ? 'Rush' : mode === 'duo' ? 'Two players' : DIFFICULTY_LABELS[difficulty];
    this.find('[data-over-best]').hidden = !newBest;
    this.find('[data-over-best-rush]').hidden = !newBestRush;
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
