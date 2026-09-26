/**
 * Shapes shared by the game domain. This module is type-only: it exports no runtime values.
 *
 * @typedef {'ready' | 'running' | 'paused' | 'game-over'} GamePhase
 * @typedef {'player' | 'opponent'} Side
 *
 * @typedef {object} Ball
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} spin Curve rate in radians per second; positive spin bends the ball toward +x.
 *
 * @typedef {object} Paddle
 * @property {number} x
 * @property {number} vx Smoothed horizontal velocity, which a hit turns into spin.
 *
 * @typedef {{ type: 'match-start' }
 *   | { type: 'paused' }
 *   | { type: 'resumed' }
 *   | { type: 'serve', x: number, y: number }
 *   | { type: 'paddle-hit', side: Side, x: number, y: number, speed: number, spin: number, rally: number }
 *   | { type: 'wall-bounce', x: number, y: number, speed: number }
 *   | { type: 'point', scorer: Side, x: number, y: number }
 *   | { type: 'game-over', winner: Side }} GameEvent
 *
 * @typedef {object} GameState
 * @property {GamePhase} phase
 * @property {Paddle} player
 * @property {Paddle} opponent
 * @property {Ball} ball
 * @property {Record<Side, number>} score
 * @property {Side | null} lastPoint
 * @property {number} serveNumber
 * @property {number} serveCountdown Seconds the ball still waits at the center before it is served.
 * @property {number} rally Paddle hits since the last serve.
 * @property {number} longestRally Longest rally of the current match.
 * @property {readonly GameEvent[]} events What happened in the transition that produced this state.
 *
 * @typedef {object} InputSnapshot Device-neutral movement intent for one simulation step.
 * @property {number} horizontalAxis -1 (left), 0 (idle) or 1 (right).
 * @property {number | null} pointerX Absolute paddle target in board coordinates while a pointer steers.
 *
 * @typedef {object} GameConfig
 * @property {number} width
 * @property {number} height
 * @property {number} winningScore
 * @property {number} serveDelaySeconds
 * @property {number} fixedStepSeconds
 * @property {number} maxFrameSeconds
 * @property {{
 *   width: number,
 *   height: number,
 *   inset: number,
 *   keyboardSpeed: number,
 *   velocityResponse: number,
 * }} paddle
 * @property {{
 *   radius: number,
 *   initialSpeed: number,
 *   maxSpeed: number,
 *   speedIncrease: number,
 *   maxBounceAngleRadians: number,
 *   spinPerPaddleSpeed: number,
 *   maxSpin: number,
 *   spinDecay: number,
 * }} ball
 * @property {{
 *   maxSpeed: number,
 *   reach: number,
 *   trackingDeadZone: number,
 *   predictionWeight: number,
 *   error: number,
 *   aim: number,
 * }} opponent `reach` is the share of the court, measured from its own paddle, within which it
 *   reacts; `error` scales how far it misjudges fast balls, in board units.
 */

export {};
