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
  constructor({ config, renderer, input, view }) {
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
    });
  }

  connect() {
    this.input.connect();
    this.view.startButton.addEventListener('click', () => this.handleStart());
    this.view.pauseButton.addEventListener('click', () => this.handlePause());
    this.view.resetButton.addEventListener('click', () => this.handleReset());
    window.addEventListener('keydown', (event) => this.handleGlobalKey(event));
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
    this.view.status.textContent = this.statusText();
    this.view.pauseButton.disabled = ![
      GAME_PHASE.RUNNING,
      GAME_PHASE.PAUSED,
    ].includes(this.state.phase);
    this.view.pauseButton.textContent = this.state.phase === GAME_PHASE.PAUSED
      ? 'Resume'
      : 'Pause';
  }

  handleStart() {
    this.state = startGame(this.state, this.config);
    this.render();
  }

  handlePause() {
    this.state = togglePause(this.state);
    this.render();
  }

  handleReset() {
    this.state = resetGame(this.config);
    this.render();
  }

  handleGlobalKey(event) {
    if (event.code !== 'Space') {
      return;
    }

    event.preventDefault();

    if ([GAME_PHASE.READY, GAME_PHASE.GAME_OVER].includes(this.state.phase)) {
      this.handleStart();
    } else {
      this.handlePause();
    }
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
