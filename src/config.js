/** @import { GameConfig } from './domain/types.js' */

/** @satisfies {GameConfig} */
export const GAME_CONFIG = Object.freeze({
  width: 800,
  height: 520,
  winningScore: 7,
  fixedStepSeconds: 1 / 120,
  maxFrameSeconds: 0.1,
  paddle: Object.freeze({
    width: 112,
    height: 14,
    inset: 28,
    keyboardSpeed: 520,
  }),
  ball: Object.freeze({
    radius: 8,
    initialSpeed: 360,
    maxSpeed: 720,
    speedIncrease: 1.045,
    maxBounceAngleRadians: (65 * Math.PI) / 180,
  }),
  opponent: Object.freeze({
    maxSpeed: 390,
    trackingDeadZone: 6,
    predictionWeight: 0.62,
  }),
});
