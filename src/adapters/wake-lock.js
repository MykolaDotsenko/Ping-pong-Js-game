/**
 * @import { GameEvent } from '../domain/types.js'
 * @import { FeedbackPort } from '../application/ports.js'
 */

/**
 * @typedef {{ release: () => Promise<void>, addEventListener: (type: 'release', listener: () => void) => void }} WakeLockSentinel
 * @typedef {{ wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }} WakeLockNavigator
 */

/**
 * Keeps the screen on while a match runs, where the Screen Wake Lock API exists. A phone
 * steered by a thumb sends no key or scroll events, so without this the screen would dim
 * mid-rally. The lock is released on pause, at the menu and when the match ends.
 *
 * @implements {FeedbackPort}
 */
export class WakeLock {
  /** @param {WakeLockNavigator} navigator */
  constructor(navigator) {
    this.navigator = navigator;
    /** @type {WakeLockSentinel | null} */
    this.sentinel = null;
    /** Whether a request is on its way; at most one is, so no lock can be left unreleased. */
    this.requesting = false;
    this.wanted = false;
  }

  get supported() {
    return typeof this.navigator.wakeLock?.request === 'function';
  }

  /** @param {readonly GameEvent[]} events */
  handle(events) {
    for (const event of events) {
      if (event.type === 'match-start' || event.type === 'resumed') {
        this.acquire();
      } else if (event.type === 'paused' || event.type === 'menu' || event.type === 'game-over') {
        this.release();
      }
    }
  }

  acquire() {
    this.wanted = true;

    // A lock already held, or one on its way, serves this request too: a second request in
    // flight would replace the first sentinel and leave it holding the screen on for good.
    if (!this.supported || this.sentinel || this.requesting) {
      return;
    }

    this.requesting = true;
    /** @type {NonNullable<WakeLockNavigator['wakeLock']>} */ (this.navigator.wakeLock)
      .request('screen')
      .then((sentinel) => {
        this.requesting = false;

        // The lock may have been asked to go away while the request was in flight.
        if (!this.wanted) {
          sentinel.release().catch(() => {});
          return;
        }

        this.sentinel = sentinel;
        sentinel.addEventListener('release', () => {
          if (this.sentinel === sentinel) {
            this.sentinel = null;
          }
        });
      })
      .catch(() => {
        // Denied (low battery, hidden page): the game plays on with the screen's own timeout.
        this.requesting = false;
      });
  }

  release() {
    this.wanted = false;

    if (this.sentinel) {
      this.sentinel.release().catch(() => {});
      this.sentinel = null;
    }
  }
}
