import {
  advanceGame,
  createInitialState,
  GAME_PHASE,
  getWinner,
  pauseGame,
  resetGame,
  startGame,
  togglePause,
} from '../domain/game.js';
import { FixedStepLoop } from './game-loop.js';
import { interpolateState } from './interpolation.js';
import { GAME_COMMAND } from './ports.js';

/**
 * @import { GameConfig, GameState } from '../domain/types.js'
 * @import {
 *   Difficulty,
 *   FeedbackPort,
 *   FrameScheduler,
 *   GameCommand,
 *   InputPort,
 *   PreferencesPort,
 *   Presentation,
 *   RendererPort,
 *   ViewPort,
 * } from './ports.js'
 */

// A new record is always saved, but only celebrated once the rally is worth mentioning.
const CELEBRATED_RALLY = 3;

export class GameController {
  /**
   * @param {object} dependencies
   * @param {Readonly<Record<Difficulty, GameConfig>>} dependencies.configs tuning per difficulty
   * @param {PreferencesPort} dependencies.preferences
   * @param {RendererPort} dependencies.renderer
   * @param {InputPort} dependencies.input
   * @param {ViewPort} dependencies.view
   * @param {FrameScheduler} dependencies.scheduler
   * @param {readonly FeedbackPort[]} [dependencies.feedback] sound, vibration and effects
   */
  constructor({ configs, preferences, renderer, input, view, scheduler, feedback = [] }) {
    this.configs = configs;
    this.preferences = preferences;
    this.renderer = renderer;
    this.input = input;
    this.view = view;
    this.feedback = feedback;
    this.config = this.selectedConfig();
    this.state = createInitialState(this.config);
    /** The state before the latest simulation step, used to interpolate rendering. */
    this.previousState = this.state;
    this.bestRally = preferences.get().bestRally;
    this.newBest = false;

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
    this.recordRally(this.state.longestRally);

    if (this.state.phase !== GAME_PHASE.RUNNING) {
      // The match just ended: draw the final state as-is and let the loop idle.
      this.previousState = this.state;
      this.loop.stop();
    }
  }

  /** @param {number} [alpha] fraction of the next fixed step already elapsed */
  render(alpha = 1) {
    this.renderer.render(interpolateState(this.previousState, this.state, alpha));
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
        return resetGame(this.config);
      case GAME_COMMAND.PRIMARY:
        return idle ? this.newMatch() : togglePause(state);
      default:
        return state;
    }
  }

  /**
   * Starts a fresh match with the difficulty currently chosen in the preferences.
   *
   * @returns {GameState}
   */
  newMatch() {
    this.config = this.selectedConfig();
    this.newBest = false;
    return startGame(resetGame(this.config), this.config);
  }

  selectedConfig() {
    return this.configs[this.preferences.get().difficulty] ?? this.configs.normal;
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
      feedback.handle(state.events, state);
    }
  }

  /** @param {number} longestRally */
  recordRally(longestRally) {
    if (longestRally <= this.bestRally) {
      return;
    }

    this.bestRally = longestRally;
    this.newBest = longestRally >= CELEBRATED_RALLY;
    this.preferences.set({ bestRally: longestRally });
  }

  /** @returns {Presentation} */
  presentation() {
    const { phase, score, rally, longestRally } = this.state;

    return {
      phase,
      status: this.statusText(),
      score,
      rally,
      longestRally,
      bestRally: this.bestRally,
      newBest: this.newBest,
      winner: getWinner(this.state),
    };
  }

  statusText() {
    const { phase, score } = this.state;

    if (phase === GAME_PHASE.READY) {
      return `First to ${this.config.winningScore}. Start when ready.`;
    }

    if (phase === GAME_PHASE.PAUSED) {
      return 'Game paused.';
    }

    if (phase === GAME_PHASE.GAME_OVER) {
      return getWinner(this.state) === 'player'
        ? 'Match complete — you won.'
        : 'Match complete — computer won.';
    }

    return `You ${score.player} — ${score.opponent} Computer`;
  }
}
