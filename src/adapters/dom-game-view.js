import { MAX_STARS } from '../application/career.js';
import { DIFFICULTIES, GAME_COMMAND, MODES } from '../application/ports.js';
import { GAME_PHASE } from '../domain/game.js';
import { finisherApplies, FINISHER_SECONDS } from './finisher.js';

/**
 * @import { GamePhase, Side } from '../domain/types.js'
 * @import {
 *   CareerView,
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
const PLAYER_LABELS = Object.freeze({ solo: 'You', rush: 'Hits', duo: 'P1', career: 'You' });
const TOGGLE_SETTINGS = /** @type {const} */ (['sound', 'music', 'vibration', 'powerUps', 'supers', 'jokes']);
/** Where the arcade's "Continue?" countdown starts, a second a step, after a loss. */
const CONTINUE_FROM = 9;
/** How long a career rival's name stays up at the start of a match, over the countdown. */
const BANNER_SECONDS = 2.2;

/**
 * @typedef {typeof TOGGLE_SETTINGS[number]} ToggleSetting
 * @typedef {object} Device
 * @property {boolean} canShare
 * @property {boolean} canFullscreen
 * @property {(text: string) => Promise<'shared' | 'copied' | 'cancelled' | 'failed'>} share
 * @property {() => Promise<void>} toggleFullscreen
 */

/**
 * The HTML around the board: the HUD, the menu with its modes, the tutorial and settings
 * dialogs, and the pause and result overlays. Controls declare what they do with data
 * attributes: data-command sends a game command, data-mode and data-difficulty pick the next
 * match, data-setting toggles a preference such as sound, and data-track picks the next
 * music track.
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
   * @param {readonly { id: TrackId, label: string }[]} options.tracks the music tracks, in the order the track button cycles
   * @param {(track: TrackId) => void} options.previewTrack plays a short sample of the chosen track
   * @param {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }} options.timers
   */
  constructor({ root, board, preferences, canVibrate, device, tracks, previewTrack, timers }) {
    this.root = root;
    this.board = board;
    this.preferences = preferences;
    this.canVibrate = canVibrate;
    this.device = device;
    this.tracks = tracks;
    this.previewTrack = previewTrack;
    this.timers = timers;
    /**
     * While the finisher plays, the result screen waits; a tap or key brings it at once.
     * @type {ReturnType<typeof setTimeout> | null}
     */
    this.resultDelay = null;
    /** @type {ReturnType<typeof setTimeout> | null} the next step of the "Continue?" countdown */
    this.continueTimer = null;
    /** @type {ReturnType<typeof setTimeout> | null} when the career rival's banner goes */
    this.bannerTimer = null;
    this.status = this.find('[data-game-status]');
    this.scores = { player: this.find('[data-score="player"]'), opponent: this.find('[data-score="opponent"]') };
    this.overlays = {
      menu: this.find('[data-overlay="menu"]'),
      tutorial: this.find('[data-overlay="tutorial"]'),
      settings: this.find('[data-overlay="settings"]'),
      pause: this.find('[data-overlay="pause"]'),
      over: this.find('[data-overlay="over"]'),
    };
    this.pauseButton = this.find('[data-hud-pause]');
    this.lives = this.find('[data-lives]');
    this.matchPoint = this.find('[data-match-point]');
    this.continueLine = this.find('[data-continue]');
    this.banner = this.find('[data-rival-banner]');
    /** @type {Presentation | null} */
    this.rendered = null;
    /**
     * The presentation being rendered right now, for the phase change it may bring.
     * @type {Presentation | null}
     */
    this.pending = null;
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
      throw new Error(`Paddle Noir could not start because ${selector} is missing from the page.`);
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

    for (const button of this.findAll('[data-rival-step]')) {
      const step = Number(button.dataset.rivalStep);
      this.listen(button, () => this.stepRival(step));
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

    // While the finisher plays, a tap anywhere on the court brings the result screen. On the
    // click rather than the press: a press that brought the screen up could land its click
    // on the button that appears under the finger.
    this.listen(this.root, () => this.revealResult());
    this.listen(this.root, (event) => this.skipFinisherByKey(/** @type {KeyboardEvent} */ (event)), 'keydown');

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

    for (const button of this.findAll('[data-show-settings]')) {
      this.listen(button, () => this.showSettingsDialog(true));
    }

    for (const button of this.findAll('[data-dismiss-settings]')) {
      this.listen(button, () => this.showSettingsDialog(false));
    }

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
    this.cancelResultDelay();
    this.stopContinue();
    this.hideBanner();
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

  /**
   * Picks the previous or the next career rival, within the part of the ladder that is open,
   * and has the menu redrawn for it.
   *
   * @param {number} step
   */
  stepRival(step) {
    const career = this.rendered?.career;

    if (!career) {
      return;
    }

    const rival = Math.min(Math.max(0, career.index + step), career.unlocked);

    if (rival !== career.index) {
      this.preferences.set({ rival });
      this.commandHandler(GAME_COMMAND.RESET);
    }
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

    for (const element of this.findAll('[data-career-only]')) {
      element.hidden = mode !== 'career';
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
      button.setAttribute('aria-label', `Music track: ${track.label}`);
    }

    for (const label of this.findAll('[data-track-label]')) {
      label.textContent = track.label;
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
   * Opens the tutorial, or closes it; either way out of it counts as having seen it.
   *
   * @param {boolean} visible
   */
  showTutorial(visible) {
    const wasOpen = this.overlays.tutorial.hasAttribute('open');

    showDialog(this.overlays.tutorial, visible);

    if (wasOpen && !visible) {
      this.markTutorialSeen();
    }
  }

  /**
   * Opens the settings, or closes them. The switches apply as they are pressed, so closing
   * has nothing to save.
   *
   * @param {boolean} visible
   */
  showSettingsDialog(visible) {
    showDialog(this.overlays.settings, visible);
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

    const { career } = result;
    const won = result.winner === 'player';
    const score = `${result.score.player}:${result.score.opponent}`;
    let text = `I ${won ? 'won' : 'lost'} ${score} on ${DIFFICULTY_LABELS[result.difficulty]} in Paddle Noir. Longest rally: ${result.longestRally}.`;

    if (result.mode === 'rush') {
      text = `I survived ${result.hits.player} hits in Rush mode of Paddle Noir. Beat that!`;
    } else if (career && won && isFinalRival(career)) {
      text = `I beat ${career.rival.name} ${score} and saved the last arcade in Paddle Noir: ${career.earned} of ${MAX_STARS} stars.`;
    } else if (career) {
      text = won
        ? `I beat ${career.rival.name} ${score} in Paddle Noir career mode: ${career.earned} of ${MAX_STARS} stars.`
        : `${career.rival.name} beat me ${score.split(':').reverse().join(':')} in Paddle Noir career mode. Rematch!`;
    }
    const outcome = await this.device.share(text);

    note.textContent = { shared: '', copied: 'Copied to clipboard', cancelled: '', failed: 'Sharing is not available here' }[outcome];
  }

  /** @param {Presentation} presentation */
  render(presentation) {
    // render() runs every frame during a match. Only touch the DOM when something changed:
    // the status element is an aria-live region, and rewriting it could spam screen readers.
    const previous = this.rendered;
    this.pending = presentation;

    if (presentation.phase !== previous?.phase || presentation.mode !== previous?.mode) {
      this.showPhase(presentation.phase, presentation.mode);
    }

    if (presentation.status !== previous?.status) {
      this.status.textContent = presentation.status;
    }

    if (presentation.opponent.label !== previous?.opponent.label || presentation.mode !== previous?.mode) {
      this.showLabels(presentation);
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

    const careerChanged = presentation.career?.index !== previous?.career?.index
      || presentation.career?.stars !== previous?.career?.stars
      || presentation.career?.unlocked !== previous?.career?.unlocked
      || presentation.career?.eased !== previous?.career?.eased;

    if (
      presentation.bestRally !== previous?.bestRally
      || presentation.bestRush !== previous?.bestRush
      || presentation.mode !== previous?.mode
      || presentation.rules !== previous?.rules
      || careerChanged
    ) {
      this.showMenuMeta(presentation);
    }

    if (presentation.stats !== previous?.stats || presentation.mode !== previous?.mode || careerChanged) {
      this.showStats(presentation);
    }

    if (careerChanged) {
      this.showRival(presentation);
    }

    if (presentation.phase === GAME_PHASE.GAME_OVER && previous?.phase !== GAME_PHASE.GAME_OVER) {
      this.showResult(presentation);
    }

    this.rendered = presentation;
  }

  /**
   * Whether the match that just ended gets a finisher, which the result screen waits for.
   *
   * @param {Presentation} presentation
   */
  finishes({ winner, mode }) {
    return finisherApplies({
      winner,
      twoPlayers: mode === 'duo',
      rush: mode === 'rush',
      jokes: this.preferences.get().jokes === true,
    });
  }

  /**
   * A key pressed during the finisher only brings the result screen, so Space or Enter
   * cannot also start the next match unseen; the keyboard input listens beyond the court,
   * on the window, so the key stops here. A held key's repeats and shortcuts with a
   * modifier are no request to skip.
   *
   * @param {KeyboardEvent} event
   */
  skipFinisherByKey(event) {
    if (this.resultDelay === null || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.revealResult();
  }

  /** Shows the result screen now, ending any wait for the finisher. */
  revealResult() {
    if (this.resultDelay === null) {
      return;
    }

    this.cancelResultDelay();
    this.overlays.over.hidden = false;
    this.guideFocus(GAME_PHASE.GAME_OVER);
  }

  cancelResultDelay() {
    if (this.resultDelay !== null) {
      this.timers.clearTimeout(this.resultDelay);
      this.resultDelay = null;
    }
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

    // Once a match has been played, the menu's neon sign is on when the player comes back.
    if (phase !== GAME_PHASE.READY) {
      this.root.dataset.played = 'true';
    }

    // The finisher plays on the board first; the result screen follows, or comes at a tap.
    const finishing = phase === GAME_PHASE.GAME_OVER && phaseChanged && this.rendered !== null
      && this.finishes(/** @type {Presentation} */ (this.pending));

    this.overlays.menu.hidden = phase !== GAME_PHASE.READY;
    this.overlays.pause.hidden = phase !== GAME_PHASE.PAUSED;
    this.overlays.over.hidden = phase !== GAME_PHASE.GAME_OVER || finishing;
    this.cancelResultDelay();
    // A new result starts its own countdown; any other screen ends the last one.
    this.stopContinue();

    // A match that starts from the menu or the result screen, not one resumed, names its rival.
    const previousPhase = this.rendered?.phase;

    if (phase === GAME_PHASE.RUNNING && (previousPhase === GAME_PHASE.READY || previousPhase === GAME_PHASE.GAME_OVER)) {
      this.showBanner(/** @type {Presentation} */ (this.pending));
    } else if (phase !== GAME_PHASE.RUNNING) {
      this.hideBanner();
    }

    if (finishing) {
      this.resultDelay = this.timers.setTimeout(() => this.revealResult(), FINISHER_SECONDS * 1000);
    } else if (phaseChanged && this.rendered !== null) {
      this.guideFocus(phase);
    }
    this.pauseButton.toggleAttribute('disabled', !inMatch);
    this.pauseButton.setAttribute('aria-label', phase === GAME_PHASE.PAUSED ? 'Resume' : 'Pause');

    if (phase !== GAME_PHASE.READY) {
      this.find('[data-share-note]').textContent = '';
    }
  }

  /**
   * The scoreboard's side labels. A nickname is set in its own case and letter-spacing, and
   * clipped with an ellipsis rather than pushing the scoreboard into the buttons.
   *
   * @param {Presentation} presentation
   */
  showLabels({ mode, opponent }) {
    const label = this.find('[data-label="opponent"]');

    label.textContent = opponent.label;
    label.classList.toggle('scoreboard__label--nick', opponent.proper);
    this.find('[data-scoreboard]').classList.toggle('scoreboard--nick', opponent.proper);
    this.find('[data-label="player"]').textContent = PLAYER_LABELS[mode];
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
   * rules come from the match configuration, so the text cannot drift from the game. In the
   * career it tells who the rival is, or why they are tired.
   *
   * @param {Presentation} presentation
   */
  showMenuMeta({ mode, rules, bestRally, bestRush, career }) {
    const goal = rules.kind === 'rush' ? `${rules.lives} lives` : `First to ${rules.winningScore}`;

    for (const element of this.findAll('[data-menu-meta]')) {
      if (career) {
        element.replaceChildren(career.eased
          ? `After beating you twice, ${career.rival.name} is tired and plays slower.`
          : career.rival.story);
        continue;
      }

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
  showStats({ mode, stats, career }) {
    for (const element of this.findAll('[data-stats]')) {
      const show = (mode === 'solo' && stats.matches > 0) || (career !== null && career.beaten > 0);
      element.hidden = !show;

      if (!show) {
        continue;
      }

      if (career) {
        element.replaceChildren(`${career.beaten} of ${career.count} beaten · ${career.totalStars}/${career.count * MAX_STARS} stars`);
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
    const { winner, score, hits, longestRally, newBest, newBestRush, mode, difficulty, opponent, career } = presentation;
    const title = this.find('[data-over-title]');
    const rush = mode === 'rush';
    const setting = career ? `Career ${career.index + 1}/${career.count}`
      : rush ? 'Rush' : mode === 'duo' ? 'Two players' : DIFFICULTY_LABELS[difficulty];
    // Beating the final boss keeps the last arcade open.
    const champion = career !== null && winner === 'player' && isFinalRival(career);
    const stars = this.find('[data-over-stars]');

    this.lastResult = presentation;
    title.textContent = rush ? 'Run over' : champion ? 'Champion' : winner === 'player' ? 'Victory' : 'Defeat';
    title.dataset.winner = rush ? 'opponent' : (winner ?? '');
    this.find('[data-over-score]').textContent = rush ? `${hits.player} hits` : `${score.player} : ${score.opponent}`;
    this.find('[data-over-rally]').textContent = String(longestRally);
    this.find('[data-over-difficulty]').textContent = opponent.proper ? `${setting} · vs ${opponent.name}` : setting;
    this.find('[data-over-best]').hidden = !newBest;
    this.find('[data-over-best-rush]').hidden = !newBestRush;
    this.find('[data-over-champion]').hidden = !champion;
    stars.hidden = !career || career.earned === 0;
    showStars(stars, career?.earned ?? 0);
    // After a career win, the same button takes on the next rival.
    this.find('[data-focus="over"]').textContent = career?.next ? 'Next rival' : 'Play again';
    this.startContinue(presentation);
  }

  /**
   * The career rival card of the menu: its place on the ladder, its name, a boss tag, which
   * names the final boss as such, and the best stars earned against it, with the steps to the
   * rivals either side, as far as the ladder is open.
   *
   * @param {Presentation} presentation
   */
  showRival({ career }) {
    if (!career) {
      return;
    }

    this.find('[data-rival-place]').textContent = `${career.index + 1}/${career.count}`;
    this.find('[data-rival-name]').textContent = career.rival.name;
    this.find('[data-rival-boss]').hidden = !career.rival.boss;
    this.find('[data-rival-boss]').textContent = bossLabel(career);
    this.find('[data-rival-tired]').hidden = !career.eased;
    showStars(this.find('[data-rival-stars]'), career.stars);

    for (const button of this.findAll('[data-rival-step]')) {
      const target = career.index + Number(button.dataset.rivalStep);
      button.toggleAttribute('disabled', target < 0 || target > career.unlocked);
    }
  }

  /**
   * Shows a career rival's name over the court as a match against it starts, for a moment.
   * It is decoration: the status line names the rival for screen readers.
   *
   * @param {Presentation} presentation
   */
  showBanner({ career }) {
    this.hideBanner();

    if (!career) {
      return;
    }

    this.banner.replaceChildren(...(career.rival.boss ? [bossTag(this.banner, bossLabel(career)), career.rival.name] : [`vs ${career.rival.name}`]));
    this.banner.hidden = false;
    this.bannerTimer = this.timers.setTimeout(() => this.hideBanner(), BANNER_SECONDS * 1000);
  }

  hideBanner() {
    if (this.bannerTimer !== null) {
      this.timers.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }

    this.banner.hidden = true;
  }

  /**
   * After a loss to the computer, a parody of the arcade's "Continue?" screen counts down
   * under the result, then gives up with "Game over". It is one of the fun extras and pure
   * decoration: Play again works all along, and screen readers skip it.
   *
   * @param {Presentation} presentation
   */
  startContinue({ mode, winner }) {
    const lost = mode === 'rush' || ((mode === 'solo' || mode === 'career') && winner === 'opponent');

    this.stopContinue();
    this.continueLine.hidden = !lost || this.preferences.get().jokes !== true;

    if (!this.continueLine.hidden) {
      this.tickContinue(CONTINUE_FROM);
    }
  }

  /** @param {number} count seconds left; below zero the countdown has given up */
  tickContinue(count) {
    const over = count < 0;

    this.continueLine.textContent = over ? 'Game over' : `Continue? ${count}`;
    this.continueLine.dataset.state = over ? 'over' : 'counting';
    restartAnimation(this.continueLine, 'is-ticking');
    this.continueTimer = over ? null : this.timers.setTimeout(() => this.tickContinue(count - 1), 1000);
  }

  stopContinue() {
    if (this.continueTimer !== null) {
      this.timers.clearTimeout(this.continueTimer);
      this.continueTimer = null;
    }
  }
}

/**
 * Opens a dialog as a modal, which makes the page behind it inert and moves focus into it, or
 * closes it. Browsers without modal dialogs still show it.
 *
 * @param {HTMLElement} element
 * @param {boolean} visible
 */
function showDialog(element, visible) {
  const dialog = /** @type {HTMLDialogElement} */ (element);
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
  }
}

/**
 * Stars as glyphs, which screen readers skip, and as words, which they read.
 *
 * @param {HTMLElement} element
 * @param {number} stars
 */
function showStars(element, stars) {
  const glyphs = element.ownerDocument.createElement('span');
  const words = element.ownerDocument.createElement('span');

  glyphs.setAttribute('aria-hidden', 'true');
  glyphs.textContent = '★'.repeat(stars) + '☆'.repeat(MAX_STARS - stars);
  words.className = 'visually-hidden';
  words.textContent = `${stars} of ${MAX_STARS} stars`;
  element.replaceChildren(glyphs, words);
}

/**
 * @param {CareerView} career
 * @returns {boolean} whether the rival is the final boss, the last one on the ladder
 */
function isFinalRival(career) {
  return career.rival.boss && career.index === career.count - 1;
}

/** @param {CareerView} career */
function bossLabel(career) {
  return isFinalRival(career) ? 'Final boss' : 'Boss';
}

/**
 * @param {HTMLElement} element
 * @param {string} label
 */
function bossTag(element, label) {
  const tag = element.ownerDocument.createElement('small');
  tag.textContent = label;
  return tag;
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
