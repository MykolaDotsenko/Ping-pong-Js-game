import { DIFFICULTIES } from '../application/ports.js';

/** @import { Preferences, PreferencesPort } from '../application/ports.js' */

const STORAGE_KEY = 'ping-pong-lab:preferences';

/** @type {Readonly<Preferences>} */
const DEFAULTS = Object.freeze({ difficulty: 'normal', sound: true, vibration: true, bestRally: 0 });

/**
 * Keeps only well-formed values, so a corrupted or outdated stored entry cannot break the game.
 *
 * @param {Record<string, unknown>} stored
 * @returns {Preferences}
 */
function sanitize(stored) {
  const { difficulty, sound, vibration, bestRally } = stored;

  return {
    difficulty: DIFFICULTIES.find((level) => level === difficulty) ?? DEFAULTS.difficulty,
    sound: typeof sound === 'boolean' ? sound : DEFAULTS.sound,
    vibration: typeof vibration === 'boolean' ? vibration : DEFAULTS.vibration,
    bestRally: Number.isInteger(bestRally) && Number(bestRally) >= 0 ? Number(bestRally) : DEFAULTS.bestRally,
  };
}

/**
 * Preferences saved in localStorage. Storage may be missing or throw (private browsing,
 * blocked site data), so every access is guarded and the game falls back to in-memory values.
 *
 * @implements {PreferencesPort}
 */
export class LocalPreferences {
  /** @param {{ localStorage?: Storage }} window */
  constructor(window) {
    this.window = window;
    this.values = this.load();
  }

  /** @returns {Preferences} */
  load() {
    try {
      const raw = this.window.localStorage?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return sanitize(parsed !== null && typeof parsed === 'object' ? parsed : {});
    } catch {
      return { ...DEFAULTS };
    }
  }

  get() {
    return this.values;
  }

  /** @param {Partial<Preferences>} changes */
  set(changes) {
    this.values = sanitize({ ...this.values, ...changes });

    try {
      this.window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Keep the new values for this visit even if they cannot be saved.
    }
  }
}
