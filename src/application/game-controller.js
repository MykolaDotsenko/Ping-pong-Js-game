import {
  advanceGame,
  createInitialState,
  GAME_PHASE,
  getWinner,
  matchPointSide,
  pauseGame,
  resetGame,
  startGame,
  togglePause,
} from '../domain/game.js';
import { EASE_AFTER, easedConfig, starsFor, unlockedRival } from './career.js';
import { FixedStepLoop } from './game-loop.js';
import { interpolateState } from './interpolation.js';
import { nicknameFor } from './nicknames.js';
import { GAME_COMMAND } from './ports.js';

/**
 * @import { GameConfig, GameState } from '../domain/types.js'
 * @import {
 *   CareerView,
 *   FeedbackPort,
 *   FrameScheduler,
 *   GameCommand,
 *   InputPort,
 *   MatchCatalog,
 *   Mode,
 *   OpponentName,
 *   PreferencesPort,
 *   Presentation,
 *   RendererPort,
 *   ViewPort,
 * } from './ports.js'
 */

// A new record is always saved, but only celebrated once the rally is worth mentioning.
const CELEBRATED_RALLY = 3;

// Drama: a hard hit freezes the picture for an instant, and a ball flying toward a paddle at
// match point plays in slow motion until it is returned or missed.
const HIT_STOP_SECONDS = 0.045;
const DRAMA_TIME_SCALE = 0.45;
const DRAMA_MIN_SPEED_SHARE = 0.55;

/**
 * Builds the tuning for the next match from the player's choices. A career rival plays as it
 * always does, power-ups included, unless it has beaten the player twice in a row.
 *
 * @param {MatchCatalog} catalog
 * @param {{ mode: Mode, difficulty: string, powerUps: boolean, rival?: number, losses?: number }} choices
 * @returns {GameConfig}
 */
export function buildMatchConfig(catalog, choices) {
  let base = catalog.difficulties[/** @type {keyof MatchCatalog['difficulties']} */ (choices.difficulty)]
    ?? catalog.difficulties.normal;

  if (choices.mode === 'rush') {
    return catalog.rush;
  }

  if (choices.mode === 'career') {
    const { config } = catalog.career[choices.rival ?? 0] ?? catalog.career[0];
    return (choices.losses ?? 0) >= EASE_AFTER ? easedConfig(config) : config;
  }

  if (choices.mode === 'duo') {
    base = catalog.duo;
  }

  if (choices.powerUps === base.powerUps.enabled) {
    return base;
  }

  return { ...base, powerUps: { ...base.powerUps, enabled: choices.powerUps } };
}

export class GameController {
  /**
   * @param {object} dependencies
   * @param {MatchCatalog} dependencies.catalog
   * @param {PreferencesPort} dependencies.preferences
   * @param {RendererPort} dependencies.renderer
   * @param {InputPort} dependencies.input
   * @param {ViewPort} dependencies.view
   * @param {FrameScheduler} dependencies.scheduler
   * @param {readonly FeedbackPort[]} [dependencies.feedback] sound, vibration and effects
   * @param {() => number} [dependencies.seed] a fresh seed for each match, so runs differ
   */
  constructor({ catalog, preferences, renderer, input, view, scheduler, feedback = [], seed = () => 1 }) {
    this.catalog = catalog;
    this.preferences = preferences;
    this.renderer = renderer;
    this.input = input;
    this.view = view;
    this.feedback = feedback;
    this.seed = seed;
    this.mode = preferences.get().mode;
    /** The career rival of the current match, or of the next one in the menu. */
    this.rival = this.rivalIndex();
    this.config = this.selectedConfig();
    /** The seed the current match started from; the computer's nickname is drawn from it. */
    this.matchSeed = seed();
    this.state = createInitialState(this.config, this.matchSeed);
    /** The state before the latest simulation step, used to interpolate rendering. */
    this.previousState = this.state;
    this.newBest = false;
    this.newBestRush = false;
    /** Stars the career match just finished earned. */
    this.careerEarned = 0;
    this.recorded = false;

    this.loop = new FixedStepLoop({
      stepSeconds: this.config.fixedStepSeconds,
      maxFrameSeconds: this.config.maxFrameSeconds,
      update: (deltaSeconds) => this.update(deltaSeconds),
      render: (alpha) => this.render(alpha),
      scheduler,
    });
  }

  connect() {
    this.input.onCommand((command) => this.handleCommand(command));
    this.view.onCommand((command) => this.handleCommand(command));
    this.input.configure({ players: this.mode === 'duo' ? 2 : 1 });
    this.input.connect();
    this.view.connect();
    this.renderer.connect();
    this.render();
  }

  disconnect() {
    this.loop.stop();
    this.input.disconnect();
    this.view.disconnect();
    this.renderer.disconnect();
  }

  /** @param {number} deltaSeconds */
  update(deltaSeconds) {
    this.previousState = this.state;
    this.state = advanceGame(
      this.state,
      deltaSeconds,
      this.input.snapshot(),
      this.config,
    );
    this.announce(this.state);
    this.dramatize(this.state);
    this.recordRally(this.state.longestRally);

    if (this.state.phase !== GAME_PHASE.RUNNING) {
      // The match just ended: draw the final state as-is and let the loop idle.
      this.previousState = this.state;
      this.recordResult(this.state);
      this.loop.stop();
    }
  }

  /** @param {number} [alpha] fraction of the next fixed step already elapsed */
  render(alpha = 1) {
    this.renderer.render(interpolateState(this.previousState, this.state, alpha), this.config);
    this.view.render(this.presentation());
  }

  /** @param {GameCommand} command */
  handleCommand(command) {
    const nextState = this.stateAfter(command);

    if (nextState === this.state) {
      return;
    }

    this.state = nextState;
    this.previousState = nextState;
    this.announce(nextState);

    // The loop only runs during a match; idle screens cost no frames.
    if (nextState.phase === GAME_PHASE.RUNNING) {
      this.loop.start();
    } else {
      this.loop.stop();
    }

    this.render();
  }

  /**
   * @param {GameCommand} command
   * @returns {GameState}
   */
  stateAfter(command) {
    const { state } = this;
    const idle = state.phase === GAME_PHASE.READY || state.phase === GAME_PHASE.GAME_OVER;

    switch (command) {
      case GAME_COMMAND.START:
        return idle ? this.newMatch() : startGame(state, this.config);
      case GAME_COMMAND.RESTART:
        return this.newMatch();
      case GAME_COMMAND.TOGGLE_PAUSE:
        return togglePause(state);
      case GAME_COMMAND.PAUSE:
        return pauseGame(state);
      case GAME_COMMAND.RESET:
        return this.menu();
      case GAME_COMMAND.PRIMARY:
        return idle ? this.newMatch() : togglePause(state);
      default:
        return state;
    }
  }

  /**
   * Starts a fresh match with the mode, difficulty and options chosen in the preferences.
   *
   * @returns {GameState}
   */
  newMatch() {
    this.recordForfeit();
    this.applyChoices();
    this.newBest = false;
    this.newBestRush = false;
    this.careerEarned = 0;
    this.recorded = false;

    // The menu already shows the rival drawn for the next match; a restart draws a new one.
    if (this.state.phase !== GAME_PHASE.READY) {
      this.matchSeed = this.seed();
    }

    return startGame(createInitialState(this.config, this.matchSeed), this.config);
  }

  /** @returns {GameState} */
  menu() {
    this.recordForfeit();
    this.applyChoices();
    this.matchSeed = this.seed();
    return resetGame(this.config, this.matchSeed);
  }

  applyChoices() {
    this.mode = this.preferences.get().mode;
    this.rival = this.rivalIndex();
    this.config = this.selectedConfig();
    this.input.configure({ players: this.mode === 'duo' ? 2 : 1 });
  }

  selectedConfig() {
    const { mode, difficulty, powerUps, careerLosses } = this.preferences.get();
    return buildMatchConfig(this.catalog, { mode, difficulty, powerUps, rival: this.rival, losses: careerLosses[this.rival] ?? 0 });
  }

  /**
   * The career rival chosen for the next match, kept to the part of the ladder that is open.
   *
   * @returns {number}
   */
  rivalIndex() {
    const { rival, careerStars } = this.preferences.get();
    const open = unlockedRival(careerStars, this.catalog.career.length);
    return Number.isInteger(rival) ? Math.min(Math.max(0, rival), open) : 0;
  }

  /**
   * Lets sound, vibration and visual effects react to what just happened.
   *
   * @param {GameState} state
   */
  announce(state) {
    if (state.events.length === 0) {
      return;
    }

    for (const feedback of this.feedback) {
      feedback.handle(state.events, state, this.config);
    }
  }

  /**
   * Hit-stop on hard hits, and slow motion while a match-point ball flies at a paddle.
   *
   * @param {GameState} state
   */
  dramatize(state) {
    for (const event of state.events) {
      if (event.type === 'paddle-hit' && this.speedShare(event.speed) > DRAMA_MIN_SPEED_SHARE) {
        this.loop.hold(HIT_STOP_SECONDS);
      }
    }

    this.loop.timeScale = this.isDramatic(state) ? DRAMA_TIME_SCALE : 1;
  }

  /**
   * @param {GameState} state
   * @returns {boolean} the ball is in its last stretch toward a paddle at match point
   */
  isDramatic(state) {
    if (matchPointSide(state, this.config) === null || state.serveCountdown > 0) {
      return false;
    }

    const { ball } = state;
    const { height, paddle } = this.config;
    const distance = ball.vy > 0
      ? height - paddle.inset - paddle.height - ball.y
      : ball.y - paddle.inset - paddle.height;

    return distance < height * 0.28 && this.speedShare(Math.hypot(ball.vx, ball.vy)) > 0.3;
  }

  /**
   * 0 at serve speed, 1 at top speed.
   *
   * @param {number} speed
   */
  speedShare(speed) {
    const { initialSpeed, maxSpeed } = this.config.ball;
    return (speed - initialSpeed) / (maxSpeed - initialSpeed);
  }

  /**
   * The best rally is a Solo record: a Rush run keeps its own, and a rally between two people
   * is not the player's alone. Records are read fresh from the preferences, which another tab
   * may have raised in the meantime.
   *
   * @param {number} longestRally
   */
  recordRally(longestRally) {
    if (this.mode !== 'solo' || longestRally <= this.preferences.get().bestRally) {
      return;
    }

    this.newBest = longestRally >= CELEBRATED_RALLY;
    this.preferences.set({ bestRally: longestRally });
  }

  /**
   * Saves the outcome of a finished match: the Rush record, or the Solo win statistics.
   *
   * @param {GameState} state
   */
  recordResult(state) {
    if (this.recorded || state.phase !== GAME_PHASE.GAME_OVER) {
      return;
    }

    this.recorded = true;

    if (this.mode === 'rush') {
      if (state.hits.player > this.preferences.get().bestRush) {
        this.newBestRush = true;
        this.preferences.set({ bestRush: state.hits.player });
      }
      return;
    }

    if (this.mode === 'solo') {
      this.recordSoloResult(getWinner(state) === 'player');
    }

    if (this.mode === 'career') {
      this.recordCareerResult(state);
    }
  }

  /**
   * Keeps the best stars earned against the rival and counts losses in a row to it. A win
   * moves the ladder on, so the next match is against the next rival.
   *
   * @param {GameState} state
   */
  recordCareerResult(state) {
    const { careerStars, careerLosses } = this.preferences.get();
    const count = this.catalog.career.length;
    const earned = starsFor(state.score);
    const stars = Array.from({ length: count }, (_, index) => careerStars[index] ?? 0);
    const losses = Array.from({ length: count }, (_, index) => careerLosses[index] ?? 0);

    stars[this.rival] = Math.max(stars[this.rival], earned);
    losses[this.rival] = earned > 0 ? 0 : losses[this.rival] + 1;
    this.careerEarned = earned;
    this.preferences.set({
      careerStars: stars,
      careerLosses: losses,
      rival: earned > 0 ? Math.min(this.rival + 1, count - 1) : this.rival,
    });
  }

  /**
   * Leaving a Solo match once a point has been played counts as a loss, so restarting cannot
   * protect a winning streak. A match left before its first point is not counted.
   */
  recordForfeit() {
    const { phase, score } = this.state;
    const inProgress = phase === GAME_PHASE.RUNNING || phase === GAME_PHASE.PAUSED;

    if (this.mode !== 'solo' || !inProgress || this.recorded || score.player + score.opponent === 0) {
      return;
    }

    this.recorded = true;
    this.recordSoloResult(false);
  }

  /** @param {boolean} won */
  recordSoloResult(won) {
    const { stats } = this.preferences.get();
    const streak = won ? stats.streak + 1 : 0;

    this.preferences.set({
      stats: {
        matches: stats.matches + 1,
        wins: stats.wins + (won ? 1 : 0),
        streak,
        bestStreak: Math.max(stats.bestStreak, streak),
      },
    });
  }

  /**
   * Who the player faces. A career rival goes by its own name; elsewhere, with the fun extras
   * on, the computer signs in under one of its arcade-club nicknames, the same for the whole match.
   *
   * @returns {OpponentName}
   */
  opponentName() {
    if (this.mode === 'duo') {
      return { label: 'P2', name: 'Player 2', proper: false };
    }

    if (this.mode === 'career') {
      const { short, name } = this.catalog.career[this.rival];
      return { label: short, name, proper: true };
    }

    if (this.preferences.get().jokes === true) {
      const nickname = nicknameFor(this.matchSeed);
      return { label: nickname, name: nickname, proper: true };
    }

    return { label: 'CPU', name: 'Computer', proper: false };
  }

  /** @returns {Presentation} */
  presentation() {
    const { phase, score, hits, lives, rally, longestRally, modifiers } = this.state;
    const { difficulty, stats, bestRally, bestRush } = this.preferences.get();

    return {
      phase,
      mode: this.mode,
      difficulty,
      rules: this.config.rules,
      opponent: this.opponentName(),
      status: this.statusText(),
      score,
      hits,
      lives,
      maxLives: this.config.rules.kind === 'rush' ? this.config.rules.lives : 0,
      rally,
      longestRally,
      bestRally,
      newBest: this.newBest,
      bestRush,
      newBestRush: this.newBestRush,
      matchPoint: matchPointSide(this.state, this.config),
      modifiers,
      stats,
      winner: getWinner(this.state),
      career: this.careerView(),
    };
  }

  /** @returns {CareerView | null} */
  careerView() {
    if (this.mode !== 'career') {
      return null;
    }

    const { rival: chosen, careerStars, careerLosses } = this.preferences.get();
    const { name, short, story, boss } = this.catalog.career[this.rival];
    const over = this.state.phase === GAME_PHASE.GAME_OVER;

    return {
      index: this.rival,
      count: this.catalog.career.length,
      unlocked: unlockedRival(careerStars, this.catalog.career.length),
      rival: { name, short, story, boss },
      stars: careerStars[this.rival] ?? 0,
      earned: over ? this.careerEarned : 0,
      eased: (careerLosses[this.rival] ?? 0) >= EASE_AFTER,
      next: over && chosen !== this.rival ? this.catalog.career[chosen]?.name ?? null : null,
      totalStars: careerStars.reduce((sum, stars) => sum + stars, 0),
      beaten: careerStars.filter((stars) => stars > 0).length,
    };
  }

  statusText() {
    const { phase, score, hits } = this.state;
    const { rules } = this.config;
    const rush = rules.kind === 'rush';
    const opponent = this.opponentName();
    // "computer" and "player 2" read as common nouns mid-sentence; a proper name keeps its case.
    const opponentName = opponent.proper ? opponent.name : opponent.name.toLowerCase();

    if (phase === GAME_PHASE.READY) {
      if (rush) {
        return 'Rush: survive as long as you can.';
      }

      return this.mode === 'career'
        ? `Career, ${this.rival + 1} of ${this.catalog.career.length}: ${opponent.name}. First to ${rules.winningScore}.`
        : `First to ${rules.winningScore}. Start when ready.`;
    }

    if (phase === GAME_PHASE.PAUSED) {
      return 'Game paused.';
    }

    if (phase === GAME_PHASE.GAME_OVER) {
      if (rush) {
        return `Run over — ${hits.player} hits.`;
      }

      return getWinner(this.state) === 'player'
        ? 'Match complete — you won.'
        : `Match complete — ${opponentName} won.`;
    }

    return rush
      ? `${hits.player} hits, ${this.state.lives} lives left`
      : `You ${score.player} — ${score.opponent} ${opponent.name}`;
  }
}
