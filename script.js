import { GAME_CONFIG } from './src/config.js';
import { BrowserFrameScheduler } from './src/adapters/browser-frame-scheduler.js';
import { CanvasRenderer } from './src/adapters/canvas-renderer.js';
import { DomGameView } from './src/adapters/dom-game-view.js';
import { InputController } from './src/adapters/input-controller.js';
import { GameController } from './src/application/game-controller.js';

// Browser globals are resolved here, once, and injected everywhere else.

/**
 * @template {Element} T
 * @param {string} selector
 * @param {{ new (): T }} type
 * @returns {T}
 */
function requireElement(selector, type) {
  const element = document.querySelector(selector);

  if (!(element instanceof type)) {
    throw new Error(`Ping Pong could not start because ${selector} is missing from the page.`);
  }

  return element;
}

const canvas = requireElement('[data-game-canvas]', HTMLCanvasElement);
const startButton = requireElement('[data-action="start"]', HTMLButtonElement);
const pauseButton = requireElement('[data-action="pause"]', HTMLButtonElement);
const resetButton = requireElement('[data-action="reset"]', HTMLButtonElement);
const status = requireElement('[data-game-status]', HTMLElement);

const controller = new GameController({
  config: GAME_CONFIG,
  renderer: new CanvasRenderer({ canvas, window, config: GAME_CONFIG }),
  input: new InputController({ surface: canvas, window, document, config: GAME_CONFIG }),
  view: new DomGameView({ startButton, pauseButton, resetButton, status, board: canvas }),
  scheduler: new BrowserFrameScheduler(window),
});

controller.connect();
