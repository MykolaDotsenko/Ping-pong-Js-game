/**
 * A small deterministic random source. The seed lives in the game state, so a match replays
 * identically from the same seed and inputs, and the core never reads Math.random.
 */

const MODULUS = 2 ** 32;

/**
 * @param {number} seed any integer
 * @returns {{ seed: number, value: number }} the next seed and a value in [0, 1)
 */
export function nextRandom(seed) {
  // mulberry32
  let t = (Math.trunc(seed) + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { seed: next, value: ((t ^ (t >>> 14)) >>> 0) / MODULUS };
}

/**
 * @param {number} seed
 * @param {number} min
 * @param {number} max
 * @returns {{ seed: number, value: number }} a value in [min, max)
 */
export function nextBetween(seed, min, max) {
  const { seed: nextSeed, value } = nextRandom(seed);
  return { seed: nextSeed, value: min + value * (max - min) };
}
