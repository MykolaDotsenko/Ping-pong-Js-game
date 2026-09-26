/**
 * Contracts between the application core and its adapters. Adapters implement these
 * shapes and receive them at the composition root; the core never imports an adapter.
 *
 * @import { GameEvent, GamePhase, GameState, InputSnapshot, Side } from '../domain/types.js'
 */

/** The commands adapters may send to the application. */
export const GAME_COMMAND = Object.freeze({
  /** Start a new match when idle, or resume a paused one. */
  START: 'start',
  /** Abandon the current match and start a new one right away. */
  RESTART: 'restart',
  TOGGLE_PAUSE: 'toggle-pause',
  /** Pause only if running; sent when the page loses focus. */
  PAUSE: 'pause',
  /** Back to the menu. */
  RESET: 'reset',
  /** Space: start a new match when idle, otherwise toggle pause. */
  PRIMARY: 'primary',
});

/** @type {readonly Difficulty[]} */
export const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);

/**
 * @typedef {(typeof GAME_COMMAND)[keyof typeof GAME_COMMAND]} GameCommand
 * @typedef {(command: GameCommand) => void} CommandHandler
 * @typedef {'easy' | 'normal' | 'hard'} Difficulty
 *
 * @typedef {object} Preferences Choices that outlive a match.
 * @property {Difficulty} difficulty applied when the next match starts
 * @property {boolean} sound
 * @property {boolean} vibration
 * @property {number} bestRally longest rally ever played
 *
 * @typedef {object} PreferencesPort
 * @property {() => Preferences} get
 * @property {(changes: Partial<Preferences>) => void} set
 *
 * @typedef {object} Presentation What the view shows around the board.
 * @property {GamePhase} phase
 * @property {string} status
 * @property {Record<Side, number>} score
 * @property {number} rally
 * @property {number} longestRally
 * @property {number} bestRally
 * @property {boolean} newBest whether this match set a new best rally
 * @property {Side | null} winner
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
 * @typedef {object} FeedbackPort Turns game events into sound, vibration or visual effects.
 * @property {(events: readonly GameEvent[], state: GameState) => void} handle
 *
 * @typedef {object} FrameScheduler
 * @property {(callback: (timestamp: number) => void) => number} request
 * @property {(frameId: number) => void} cancel
 */
