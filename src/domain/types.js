/**
 * Shapes shared by the game domain. This module is type-only: it exports no runtime values.
 *
 * @typedef {'ready' | 'running' | 'paused' | 'game-over'} GamePhase
 * @typedef {'player' | 'opponent'} Side
 * @typedef {'wide' | 'shrink' | 'turbo' | 'ghost'} PowerUpKind
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
 * @typedef {object} Pickup A power-up waiting on the court.
 * @property {number} id
 * @property {PowerUpKind} kind
 * @property {number} x
 * @property {number} y
 * @property {number} ttl Seconds before it vanishes.
 *
 * @typedef {object} Modifiers Seconds left on the power-up effects a side is under.
 * @property {number} wide This side's paddle is enlarged.
 * @property {number} tiny This side's paddle is shrunk, by the other side's Shrink.
 * @property {number} ghost This side cannot see the ball in its own half, by the other side's Ghost.
 *
 * @typedef {{ type: 'match-start' }
 *   | { type: 'menu' }
 *   | { type: 'paused' }
 *   | { type: 'resumed' }
 *   | { type: 'countdown', value: number }
 *   | { type: 'serve', x: number, y: number }
 *   | { type: 'paddle-hit', side: Side, x: number, y: number, speed: number, spin: number, offset: number, rally: number }
 *   | { type: 'paddle-graze', side: Side, x: number, y: number, speed: number }
 *   | { type: 'wall-bounce', x: number, y: number, speed: number }
 *   | { type: 'pickup-spawn', kind: PowerUpKind, x: number, y: number }
 *   | { type: 'pickup', kind: PowerUpKind, side: Side, x: number, y: number }
 *   | { type: 'point', scorer: Side, x: number, y: number }
 *   | { type: 'match-point', side: Side }
 *   | { type: 'life-lost', lives: number }
 *   | { type: 'game-over', winner: Side }} GameEvent
 *
 * @typedef {object} GameState
 * @property {GamePhase} phase
 * @property {Paddle} player
 * @property {Paddle} opponent
 * @property {Ball} ball
 * @property {Record<Side, number>} score
 * @property {Record<Side, number>} hits Paddle hits over the whole match; the Rush score.
 * @property {number} lives Misses left in Rush; unused in a match.
 * @property {Side | null} lastPoint
 * @property {number} serveNumber
 * @property {number} serveCountdown Seconds the ball still waits at the center before it is served.
 * @property {number} rally Paddle hits since the last serve.
 * @property {number} longestRally Longest rally of the current match.
 * @property {readonly Pickup[]} pickups
 * @property {number} nextPickupIn Seconds until the next power-up may appear.
 * @property {Record<Side, Modifiers>} modifiers
 * @property {number} turbo Seconds left of the Turbo burst on the ball.
 * @property {number} seed State of the deterministic random source.
 * @property {readonly GameEvent[]} events What happened in the transition that produced this state.
 *
 * @typedef {object} InputSnapshot Device-neutral movement intent for one simulation step.
 * @property {number} horizontalAxis -1 (left), 0 (idle) or 1 (right) for the player's paddle.
 * @property {number | null} pointerX Absolute paddle target in board coordinates while a pointer steers.
 * @property {number} opponentAxis The same for a second human on the top paddle.
 * @property {number | null} opponentPointerX
 *
 * @typedef {{ kind: 'match', winningScore: number } | { kind: 'rush', lives: number }} Rules
 *
 * @typedef {object} PowerUpConfig
 * @property {boolean} enabled
 * @property {[number, number]} spawnDelay Seconds between power-ups, chosen at random in this range.
 * @property {number} lifetime Seconds a power-up stays on the court.
 * @property {number} radius
 * @property {number} minRally Hits into a rally before a power-up may appear.
 * @property {number} duration Seconds an effect lasts.
 * @property {number} wideScale
 * @property {number} shrinkScale
 * @property {number} turboSpeed
 *
 * @typedef {object} GameConfig
 * @property {number} width
 * @property {number} height
 * @property {Rules} rules
 * @property {number} startDelaySeconds Countdown before the first serve of a match.
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
 *   controller: 'cpu' | 'human',
 *   maxSpeed: number,
 *   reach: number,
 *   trackingDeadZone: number,
 *   predictionWeight: number,
 *   error: number,
 *   aim: number,
 * }} opponent `reach` is the share of the court, measured from its own paddle, within which it
 *   reacts; `error` scales how far it misjudges fast balls, in board units.
 * @property {PowerUpConfig} powerUps
 */

export {};
