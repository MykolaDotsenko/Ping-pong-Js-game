import { GAME_PHASE } from '../domain/game.js';

export class DomGameView {
  constructor({ startButton, pauseButton, resetButton, status }) {
    this.startButton = startButton;
    this.pauseButton = pauseButton;
    this.resetButton = resetButton;
    this.status = status;
    this.commandHandler = () => {};
  }

  onCommand(handler) {
    this.commandHandler = handler;
  }

  connect() {
    this.startButton.addEventListener('click', () => this.commandHandler('start'));
    this.pauseButton.addEventListener('click', () => this.commandHandler('pause'));
    this.resetButton.addEventListener('click', () => this.commandHandler('reset'));
  }

  render({ phase, status }) {
    this.status.textContent = status;
    this.pauseButton.disabled = ![
      GAME_PHASE.RUNNING,
      GAME_PHASE.PAUSED,
    ].includes(phase);
    this.pauseButton.textContent = phase === GAME_PHASE.PAUSED
      ? 'Resume'
      : 'Pause';
  }
}
