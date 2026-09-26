import { DIFFICULTIES, MODES } from '../application/ports.js';

/** @import { MatchStats, Preferences, PreferencesPort } from '../application/ports.js' */

const STORAGE_KEY = 'ping-pong-lab:preferences';

/** @type {Readonly<MatchStats>} */
const NO_STATS = Object.freeze({ matches: 0, wins: 0, streak: 0, bestStreak: 0 });

/** @type {Readonly<Preferences>} */
const DEFAULTS = Object.freeze({
  mode: 'solo',
  difficulty: 'normal',
  powerUps: true,
  sound: true,
  music: true,
  vibration: true,
  tutorialSeen: false,
  bestRally: 0,
  bestRush: 0,
  stats: NO_STATS,
});

/**
 * @param {unknown} value
 * @param {boolean} fallback
 */
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

/**
 * @param {unknown} value
 */
const count = (value) => (Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0);

/**
 * @param {unknown} value
 * @returns {MatchStats}
 */
function sanitizeStats(value) {
  const stats = /** @type {Record<string, unknown>} */ (value !== null && typeof value === 'object' ? value : {});
  const wins = count(stats.wins);
  const matches = Math.max(count(stats.matches), wins);
  const bestStreak = Math.min(count(stats.bestStreak), wins);

  return { matches, wins, streak: Math.min(count(stats.streak), bestStreak), bestStreak };
}

/**
 * Keeps only well-formed values, so a corrupted or outdated stored entry cannot break the game.
 *
 * @param {Record<string, unknown>} stored
 * @returns {Preferences}
 */
function sanitize(stored) {
  return {
    mode: MODES.find((mode) => mode === stored.mode) ?? DEFAULTS.mode,
    difficulty: DIFFICULTIES.find((level) => level === stored.difficulty) ?? DEFAULTS.difficulty,
    powerUps: bool(stored.powerUps, DEFAULTS.powerUps),
    sound: bool(stored.sound, DEFAULTS.sound),
    music: bool(stored.music, DEFAULTS.music),
    vibration: bool(stored.vibration, DEFAULTS.vibration),
    tutorialSeen: bool(stored.tutorialSeen, DEFAULTS.tutorialSeen),
    bestRally: count(stored.bestRally),
    bestRush: count(stored.bestRush),
    stats: sanitizeStats(stored.stats),
  };
}

/**
 * @typedef {object} StorageWindow
 * @property {Storage} [localStorage]
 * @property {(type: 'storage', listener: (event: { key: string | null }) => void) => void} [addEventListener]
 * @property {(type: 'storage', listener: (event: { key: string | null }) => void) => void} [removeEventListener]
 */

/**
 * Preferences saved in localStorage. Storage may be missing or throw (private browsing,
 * blocked site data), so every access is guarded and the game falls back to in-memory values.
 *
 * The game may be open in several tabs. Each tab follows the others' saves through the
 * storage event, and merges its own changes into what is stored at that moment, so one tab
 * never writes back another's older records.
 *
 * @implements {PreferencesPort}
 */
export class LocalPreferences {
  /** @param {StorageWindow} window */
  constructor(window) {
    this.window = window;
    this.values = this.read() ?? { ...DEFAULTS };
    /** False once a save has failed: from then on this tab's values are newer than storage. */
    this.saving = true;
    /** @param {{ key: string | null }} event */
    this.handleStorage = (event) => {
      // A null key means another tab cleared the whole storage.
      if (this.saving && (event.key === STORAGE_KEY || event.key === null)) {
        this.values = this.read() ?? this.values;
      }
    };
  }

  connect() {
    this.window.addEventListener?.('storage', this.handleStorage);
  }

  disconnect() {
    this.window.removeEventListener?.('storage', this.handleStorage);
  }

  /** @returns {Preferences | null} what is stored now, or null when storage cannot be read */
  read() {
    try {
      const storage = this.window.localStorage;

      if (!storage) {
        return null;
      }

      const raw = storage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return sanitize(parsed !== null && typeof parsed === 'object' ? parsed : {});
    } catch {
      return null;
    }
  }

  get() {
    return this.values;
  }

  /** @param {Partial<Preferences>} changes */
  set(changes) {
    const current = (this.saving ? this.read() : null) ?? this.values;
    this.values = sanitize({ ...current, ...changes });

    try {
      this.window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Keep the new values for this visit even if they cannot be saved.
      this.saving = false;
    }
  }
}
