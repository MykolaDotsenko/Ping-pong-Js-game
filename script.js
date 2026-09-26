import { GAME_CONFIG, MATCH_CATALOG } from './src/config.js';
import { BrowserDevice } from './src/adapters/browser-device.js';
import { BrowserFrameScheduler } from './src/adapters/browser-frame-scheduler.js';
import { CanvasRenderer } from './src/adapters/canvas-renderer.js';
import { DomGameView } from './src/adapters/dom-game-view.js';
import { Haptics } from './src/adapters/haptics.js';
import { InputController } from './src/adapters/input-controller.js';
import { LocalPreferences } from './src/adapters/local-preferences.js';
import { MusicPlayer } from './src/adapters/music-player.js';
import { SoundBoard } from './src/adapters/sound-board.js';
import { WakeLock } from './src/adapters/wake-lock.js';
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

const arena = requireElement('[data-arena]', HTMLElement);
const canvas = requireElement('[data-game-canvas]', HTMLCanvasElement);
const preferences = new LocalPreferences(window);
preferences.connect();
const scheduler = new BrowserFrameScheduler(window);
const renderer = new CanvasRenderer({ canvas, window, scheduler, config: GAME_CONFIG });
const haptics = new Haptics({ navigator: window.navigator, preferences });
const device = new BrowserDevice({ navigator: window.navigator, document, location: window.location });

const controller = new GameController({
  catalog: MATCH_CATALOG,
  preferences,
  renderer,
  input: new InputController({ surface: arena, board: canvas, window, document, config: GAME_CONFIG }),
  view: new DomGameView({ root: arena, board: canvas, preferences, canVibrate: haptics.supported, device }),
  scheduler,
  feedback: [
    renderer,
    new SoundBoard({ window, preferences }),
    new MusicPlayer({ window, preferences }),
    haptics,
    new WakeLock(window.navigator),
  ],
  // A fresh seed per match keeps power-ups unpredictable; the core itself stays deterministic.
  seed: () => Math.floor(Math.random() * 2 ** 31),
});

controller.connect();
