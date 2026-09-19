import {
  advanceGame,
  createInitialState,
  GAME_PHASE,
  resetGame,
  startGame,
  togglePause,
} from '../domain/game.js';
import { FixedStepLoop } from './game-loop.js';

export class GameController {
  constructor({ config, renderer, input, view, scheduler }) {
    this.config = config;
    this.renderer = renderer;
    this.input = input;
    this.view = view;
    this.state = createInitialState(config);

    this.loop = new FixedStepLoop({
      stepSeconds: config.fixedStepSeconds,
      maxFrameSeconds: config.maxFrameSeconds,
      update: (deltaSeconds) => this.update(deltaSeconds),
      render: () => this.render(),
      scheduler,
    });
  }

  connect() {
    this.input.onCommand((command) => this.handleCommand(command));
    this.view.onCommand((command) => this.handleCommand(command));
    this.input.connect();
    this.view.connect();
    this.render();
    this.loop.start();
  }

  update(deltaSeconds) {
    this.state = advanceGame(
      this.state,
      deltaSeconds,
      this.input.snapshot(),
      this.config,
    );
  }

  render() {
    this.renderer.render(this.state);
    this.view.render({
      phase: this.state.phase,
      status: this.statusText(),
    });
  }

  handleCommand(command) {
    if (command === 'reset') {
      this.state = resetGame(this.config);
    } else if (command === 'start') {
      this.state = startGame(this.state, this.config);
    } else if (command === 'pause') {
      this.state = togglePause(this.state);
    } else if (command === 'primary') {
      this.state = [GAME_PHASE.READY, GAME_PHASE.GAME_OVER].includes(this.state.phase)
        ? startGame(this.state, this.config)
        : togglePause(this.state);
    }

    this.render();
  }

  statusText() {
    if (this.state.phase === GAME_PHASE.READY) {
      return `First to ${this.config.winningScore}. Start when ready.`;
    }

    if (this.state.phase === GAME_PHASE.PAUSED) {
      return 'Game paused.';
    }

    if (this.state.phase === GAME_PHASE.GAME_OVER) {
      return this.state.score.player > this.state.score.opponent
        ? 'Match complete — you won.'
        : 'Match complete — computer won.';
    }

    return `You ${this.state.score.player} — ${this.state.score.opponent} Computer`;
  }
}
