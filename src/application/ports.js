/**
 * Contracts between the application core and its adapters. Adapters implement these
 * shapes and receive them at the composition root; the core never imports an adapter.
 *
 * @import { GamePhase, GameState, InputSnapshot } from '../domain/types.js'
 */

/** The commands adapters may send to the application. */
export const GAME_COMMAND = Object.freeze({
  START: 'start',
  TOGGLE_PAUSE: 'toggle-pause',
  /** Pause only if running; sent when the page loses focus. */
  PAUSE: 'pause',
  RESET: 'reset',
  /** Space: start a new match when idle, otherwise toggle pause. */
  PRIMARY: 'primary',
});

/**
 * @typedef {(typeof GAME_COMMAND)[keyof typeof GAME_COMMAND]} GameCommand
 * @typedef {(command: GameCommand) => void} CommandHandler
 *
 * @typedef {object} Presentation Text and phase the view shows next to the board.
 * @property {GamePhase} phase
 * @property {string} status
 *
 * @typedef {object} InputPort
 * @property {(handler: CommandHandler) => void} onCommand
 * @property {() => InputSnapshot} snapshot
 * @property {() => void} connect
 * @property {() => void} disconnect
 *
 * @typedef {object} ViewPort
 * @property {(handler: CommandHandler) => void} onCommand
 * @property {(presentation: Presentation) => void} render
 * @property {() => void} connect
 * @property {() => void} disconnect
 *
 * @typedef {object} RendererPort
 * @property {(state: GameState) => void} render
 * @property {() => void} connect
 * @property {() => void} disconnect
 *
 * @typedef {object} FrameScheduler
 * @property {(callback: (timestamp: number) => void) => number} request
 * @property {(frameId: number) => void} cancel
 */
