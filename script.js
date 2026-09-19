import { GAME_CONFIG } from './src/config.js';
import { BrowserFrameScheduler } from './src/adapters/browser-frame-scheduler.js';
import { CanvasRenderer } from './src/adapters/canvas-renderer.js';
import { DomGameView } from './src/adapters/dom-game-view.js';
import { InputController } from './src/adapters/input-controller.js';
import { GameController } from './src/application/game-controller.js';

const canvas = document.querySelector('[data-game-canvas]');
const startButton = document.querySelector('[data-action="start"]');
const pauseButton = document.querySelector('[data-action="pause"]');
const resetButton = document.querySelector('[data-action="reset"]');
const status = document.querySelector('[data-game-status]');

if (!canvas || !startButton || !pauseButton || !resetButton || !status) {
  throw new Error('Ping Pong could not start because the application shell is incomplete.');
}

const renderer = new CanvasRenderer(canvas, GAME_CONFIG);
const input = new InputController(canvas, GAME_CONFIG);
const view = new DomGameView({
  startButton,
  pauseButton,
  resetButton,
  status,
});
const scheduler = new BrowserFrameScheduler();

const controller = new GameController({
  config: GAME_CONFIG,
  renderer,
  input,
  view,
  scheduler,
});

controller.connect();
