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
