/**
 * Shapes shared by the game domain. This module is type-only: it exports no runtime values.
 *
 * @typedef {'ready' | 'running' | 'paused' | 'game-over'} GamePhase
 * @typedef {'player' | 'opponent'} Side
 * @typedef {{ x: number, y: number, vx: number, vy: number }} Ball
 * @typedef {{ x: number }} Paddle
 *
 * @typedef {object} GameState
 * @property {GamePhase} phase
 * @property {Paddle} player
 * @property {Paddle} opponent
 * @property {Ball} ball
 * @property {Record<Side, number>} score
 * @property {Side | null} lastPoint
 * @property {number} serveNumber
 *
 * @typedef {object} InputSnapshot Device-neutral movement intent for one simulation step.
 * @property {number} horizontalAxis -1 (left), 0 (idle) or 1 (right).
 * @property {number | null} pointerX Absolute paddle target in board coordinates while a pointer steers.
 *
 * @typedef {object} GameConfig
 * @property {number} width
 * @property {number} height
 * @property {number} winningScore
 * @property {number} fixedStepSeconds
 * @property {number} maxFrameSeconds
 * @property {{ width: number, height: number, inset: number, keyboardSpeed: number }} paddle
 * @property {{
 *   radius: number,
 *   initialSpeed: number,
 *   maxSpeed: number,
 *   speedIncrease: number,
 *   maxBounceAngleRadians: number,
 * }} ball
 * @property {{ maxSpeed: number, trackingDeadZone: number, predictionWeight: number }} opponent
 */

export {};
