/**
 * @import { GameConfig } from './domain/types.js'
 * @import { Difficulty } from './application/ports.js'
 */

// A portrait 5:8 court: it fills a phone held upright and reads as a vertical arcade on desktop.
/** @satisfies {GameConfig} */
export const GAME_CONFIG = Object.freeze({
  width: 500,
  height: 800,
  winningScore: 7,
  serveDelaySeconds: 0.9,
  fixedStepSeconds: 1 / 120,
  maxFrameSeconds: 0.1,
  paddle: Object.freeze({
    width: 100,
    height: 16,
    inset: 40,
    keyboardSpeed: 640,
    velocityResponse: 30,
  }),
  ball: Object.freeze({
    radius: 10,
    initialSpeed: 440,
    maxSpeed: 1050,
    speedIncrease: 1.05,
    maxBounceAngleRadians: (62 * Math.PI) / 180,
    spinPerPaddleSpeed: 0.0009,
    maxSpin: 1.1,
    spinDecay: 0.8,
  }),
  opponent: Object.freeze({
    maxSpeed: 380,
    reach: 0.65,
    trackingDeadZone: 6,
    predictionWeight: 0.75,
    error: 45,
    aim: 0.3,
  }),
});

/**
 * @param {GameConfig} base
 * @param {{ ball: Partial<GameConfig['ball']>, opponent: Partial<GameConfig['opponent']> }} tuning
 * @returns {GameConfig}
 */
function tuned(base, tuning) {
  return Object.freeze({
    ...base,
    ball: Object.freeze({ ...base.ball, ...tuning.ball }),
    opponent: Object.freeze({ ...base.opponent, ...tuning.opponent }),
  });
}

// Tuned by simulating matches against human-like bots of three skill levels: a casual player
// wins almost every match on Easy, a confident one about two in three on Normal, and Hard is
// beaten mostly with curved shots.
/** @type {Readonly<Record<Difficulty, GameConfig>>} */
export const DIFFICULTY_CONFIGS = Object.freeze({
  easy: tuned(GAME_CONFIG, {
    ball: { initialSpeed: 400, maxSpeed: 900, speedIncrease: 1.04 },
    opponent: { maxSpeed: 250, reach: 0.45, predictionWeight: 0.35, error: 110, aim: 0 },
  }),
  normal: GAME_CONFIG,
  hard: tuned(GAME_CONFIG, {
    ball: { initialSpeed: 480, maxSpeed: 1200, speedIncrease: 1.06 },
    opponent: { maxSpeed: 520, reach: 0.82, predictionWeight: 0.92, error: 26, aim: 0.5 },
  }),
});
