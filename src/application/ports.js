/**
 * Contracts between the application core and its adapters. Adapters implement these
 * shapes and receive them at the composition root; the core never imports an adapter.
 *
 * @import { GameConfig, GameEvent, GamePhase, GameState, InputSnapshot, Modifiers, Side } from '../domain/types.js'
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

/** @type {readonly Mode[]} */
export const MODES = Object.freeze(['solo', 'rush', 'duo']);

/**
 * @typedef {(typeof GAME_COMMAND)[keyof typeof GAME_COMMAND]} GameCommand
 * @typedef {(command: GameCommand) => void} CommandHandler
 * @typedef {'easy' | 'normal' | 'hard'} Difficulty
 * @typedef {'solo' | 'rush' | 'duo'} Mode Solo against the computer, a Rush survival run, or two people.
 *
 * @typedef {object} MatchStats Solo results, kept across visits.
 * @property {number} matches
 * @property {number} wins
 * @property {number} streak current run of wins
 * @property {number} bestStreak
 *
 * @typedef {object} Preferences Choices that outlive a match.
 * @property {Mode} mode
 * @property {Difficulty} difficulty applied when the next Solo match starts
 * @property {boolean} powerUps whether power-ups appear in Solo and two-player matches
 * @property {boolean} sound
 * @property {boolean} music
 * @property {boolean} vibration
 * @property {boolean} tutorialSeen
 * @property {number} bestRally longest rally ever played
 * @property {number} bestRush most hits in a Rush run
 * @property {MatchStats} stats
 *
 * @typedef {object} PreferencesPort
 * @property {() => Preferences} get
 * @property {(changes: Partial<Preferences>) => void} set
 *
 * @typedef {object} MatchCatalog The tunings a match can be built from.
 * @property {Readonly<Record<Difficulty, GameConfig>>} difficulties
 * @property {GameConfig} rush
 * @property {GameConfig} duo
 *
 * @typedef {object} Presentation What the view shows around the board.
 * @property {GamePhase} phase
 * @property {Mode} mode
 * @property {Difficulty} difficulty
 * @property {string} status
 * @property {Record<Side, number>} score
 * @property {Record<Side, number>} hits
 * @property {number} lives misses left in Rush
 * @property {number} maxLives
 * @property {number} rally
 * @property {number} longestRally
 * @property {number} bestRally
 * @property {boolean} newBest whether this match set a new best rally
 * @property {number} bestRush
 * @property {boolean} newBestRush whether this run set a new Rush record
 * @property {Side | null} matchPoint the side one point from winning
 * @property {Record<Side, Modifiers>} modifiers
 * @property {MatchStats} stats
 * @property {Side | null} winner
 *
 * @typedef {object} InputPort
 * @property {(handler: CommandHandler) => void} onCommand
 * @property {(layout: { players: 1 | 2 }) => void} configure how many people steer paddles
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
 * @property {(state: GameState, config: GameConfig) => void} render
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
