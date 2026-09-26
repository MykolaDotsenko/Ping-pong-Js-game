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
 * @import { FrameScheduler, GameCommand, InputPort, RendererPort, ViewPort } from './ports.js'
 */

export class GameController {
  /**
   * @param {object} dependencies
   * @param {GameConfig} dependencies.config
   * @param {RendererPort} dependencies.renderer
   * @param {InputPort} dependencies.input
   * @param {ViewPort} dependencies.view
   * @param {FrameScheduler} dependencies.scheduler
   */
  constructor({ config, renderer, input, view, scheduler }) {
    this.config = config;
    this.renderer = renderer;
    this.input = input;
    this.view = view;
    this.state = createInitialState(config);
    /** The state before the latest simulation step, used to interpolate rendering. */
    this.previousState = this.state;

    this.loop = new FixedStepLoop({
      stepSeconds: config.fixedStepSeconds,
      maxFrameSeconds: config.maxFrameSeconds,
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

    if (this.state.phase !== GAME_PHASE.RUNNING) {
      // The match just ended: draw the final state as-is and let the loop idle.
      this.previousState = this.state;
      this.loop.stop();
    }
  }

  /** @param {number} [alpha] fraction of the next fixed step already elapsed */
  render(alpha = 1) {
    this.renderer.render(interpolateState(this.previousState, this.state, alpha));
    this.view.render({
      phase: this.state.phase,
      status: this.statusText(),
    });
  }

  /** @param {GameCommand} command */
  handleCommand(command) {
    const nextState = this.stateAfter(command);

    if (nextState === this.state) {
      return;
    }

    this.state = nextState;
    this.previousState = nextState;

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
    const { state, config } = this;

    switch (command) {
      case GAME_COMMAND.START:
        return startGame(state, config);
      case GAME_COMMAND.TOGGLE_PAUSE:
        return togglePause(state);
      case GAME_COMMAND.PAUSE:
        return pauseGame(state);
      case GAME_COMMAND.RESET:
        return resetGame(config);
      case GAME_COMMAND.PRIMARY:
        return state.phase === GAME_PHASE.READY || state.phase === GAME_PHASE.GAME_OVER
          ? startGame(state, config)
          : togglePause(state);
      default:
        return state;
    }
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
