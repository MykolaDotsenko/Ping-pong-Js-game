/**
 * @import { GameEvent } from '../domain/types.js'
 * @import { FeedbackPort, PreferencesPort } from '../application/ports.js'
 */

/**
 * @param {GameEvent} event
 * @returns {number | number[] | null} a vibration pattern in milliseconds
 */
function patternFor(event) {
  switch (event.type) {
    case 'paddle-hit':
      return event.side === 'player' ? 12 : null;
    case 'paddle-graze':
      return event.side === 'player' ? 6 : null;
    case 'point':
      return event.scorer === 'player' ? [18, 40, 18] : 45;
    case 'game-over':
      return event.winner === 'player' ? [30, 60, 30, 60, 120] : [160];
    default:
      return null;
  }
}

/**
 * Short vibrations for the player's own hits and for points, where the device supports it.
 *
 * @implements {FeedbackPort}
 */
export class Haptics {
  /**
   * @param {object} options
   * @param {{ vibrate?: (pattern: number | number[]) => boolean }} options.navigator
   * @param {PreferencesPort} options.preferences
   */
  constructor({ navigator, preferences }) {
    this.navigator = navigator;
    this.preferences = preferences;
  }

  get supported() {
    return typeof this.navigator.vibrate === 'function';
  }

  /** @param {readonly GameEvent[]} events */
  handle(events) {
    if (!this.supported || !this.preferences.get().vibration) {
      return;
    }

    for (const event of events) {
      const pattern = patternFor(event);

      if (pattern !== null) {
        this.navigator.vibrate?.(pattern);
      }
    }
  }
}
