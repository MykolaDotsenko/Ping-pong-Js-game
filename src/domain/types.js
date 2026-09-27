/**
 * Shapes shared by the game domain. This module is type-only: it exports no runtime values.
 *
 * @typedef {'ready' | 'running' | 'paused' | 'game-over'} GamePhase
 * @typedef {'player' | 'opponent'} Side
 * @typedef {'wide' | 'shrink' | 'turbo' | 'ghost' | 'multi'} PowerUpKind
 *
 * @typedef {object} Ball
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} spin Curve rate in radians per second; positive spin bends the ball toward +x.
 *
 * @typedef {Ball & { id: number, ttl: number }} ExtraBall A ball Multiball split off the ball.
 *   It bounces, is returned and scores like the ball, but its returns do not count toward the
 *   rally; it fades after `ttl` seconds, and the next point clears it.
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
 * @property {number} tiny This side's paddle is shrunk, by the other side's Shrink or a boss's attack.
 * @property {number} ghost This side cannot see the ball in its own half, by the other side's Ghost.
 * @property {number} lag This side sees the balls move in fits and starts, by the Lag boss's attack.
 *
 * @typedef {'drip' | 'beam' | 'lag'} HazardKind
 *
 * @typedef {object} Hazard A boss's attack on the player, announced before it strikes.
 * @property {HazardKind} kind a drip falls toward the player's paddle; a beam strikes a column
 *   of the player's half; lag makes the player see the balls in fits and starts
 * @property {number} x center
 * @property {number} y a drip's center; a beam and lag have no height
 * @property {number} warn seconds of warning left before it strikes
 * @property {number} ttl seconds a beam stays dangerous once it strikes
 *
 * @typedef {'fireball' | 'zigzag' | 'phantom' | 'thunder'} SuperKind
 *
 * @typedef {object} SuperMeter A side's super meter, which returns and lost points fill.
 * @property {number} charge from 0 to 1; a full meter holds a super, which a flick at a return fires
 * @property {SuperKind | null} kind the super a full meter holds, drawn as it fills; after it is
 *   fired, the last one, which the next draw avoids
 *
 * @typedef {object} SuperShot A super in flight, until it is returned or a point is scored.
 * @property {SuperKind} kind
 * @property {Side} side who fired it
 * @property {number} speed the speed an ordinary return would have had; the return that answers
 *   the super goes on from it, so the rally keeps its pace
 *
 * @typedef {{ type: 'match-start' }
 *   | { type: 'menu' }
 *   | { type: 'paused' }
 *   | { type: 'resumed' }
 *   | { type: 'countdown', value: number }
 *   | { type: 'serve', x: number, y: number }
 *   | { type: 'paddle-hit', side: Side, x: number, y: number, speed: number, spin: number, offset: number, rally: number, extra?: boolean, super?: SuperKind, saved?: SuperKind }
 *   | { type: 'paddle-graze', side: Side, x: number, y: number, speed: number }
 *   | { type: 'wall-bounce', x: number, y: number, speed: number }
 *   | { type: 'pickup-spawn', kind: PowerUpKind, x: number, y: number }
 *   | { type: 'pickup', kind: PowerUpKind, side: Side, x: number, y: number }
 *   | { type: 'point', scorer: Side, x: number, y: number, super?: SuperKind }
 *   | { type: 'match-point', side: Side }
 *   | { type: 'life-lost', lives: number }
 *   | { type: 'hazard-warn', kind: HazardKind, x: number }
 *   | { type: 'hazard-hit', kind: HazardKind, x: number, y: number }
 *   | { type: 'super-ready', side: Side, kind: SuperKind }
 *   | { type: 'super-swerve', x: number, y: number }
 *   | { type: 'boss-phase', phase: number }
 *   | { type: 'game-over', winner: Side, super?: SuperKind }} GameEvent
 *   A paddle-hit's `super` is the super that return fired and `saved` the one it answered; a
 *   point's and a game-over's `super` is the super that scored it. A boss-phase is a final boss
 *   moving on to its next phase, counted from 0, as the player closes in on winning.
 *
 * @typedef {object} GameState
 * @property {GamePhase} phase
 * @property {Paddle} player
 * @property {Paddle} opponent
 * @property {Ball} ball
 * @property {readonly ExtraBall[]} extraBalls Balls a Multiball split off, until they fade or a point is scored.
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
 * @property {number} turbo Seconds left of the Turbo shot in flight; the next return ends it early.
 * @property {readonly Hazard[]} hazards A boss's attacks under way.
 * @property {number} attackIn Seconds of play until a boss attacks again; unused without a boss.
 * @property {Record<Side, SuperMeter>} meters The super meters; they stay empty with supers off.
 * @property {SuperShot | null} superShot The super in flight, if any.
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
 * @property {number} splitAngle Radians between the ball and the ball Multiball splits off it.
 * @property {number} maxExtraBalls Most balls in play besides the ball itself.
 *
 * @typedef {object} BossConfig How a career boss attacks the player.
 * @property {HazardKind} attack
 * @property {readonly (readonly HazardKind[])[]} [phases] A final boss's phases, which it moves
 *   through as the player closes in on winning, each an even share of the points needed: the
 *   attacks of each, drawn one at a time from a phase that has several. The first phase is the
 *   boss's `attack`; a boss without phases always attacks with it.
 * @property {[number, number]} every Seconds of play between attacks, chosen at random in this range.
 * @property {number} warning Seconds a beam or lag is announced before it strikes.
 * @property {number} shrinkSeconds How long a drip or a beam that hits shrinks the player's paddle.
 * @property {number} lagSeconds How long lag lasts.
 *
 * @typedef {object} SuperConfig How the super meters fill and fire.
 * @property {boolean} enabled
 * @property {number} perHit Charge a return of the ball adds to the meter of the side that made it.
 * @property {number} perSkill Extra charge for a return off the paddle's edge, and again for one with curve.
 * @property {number} perSave Extra charge for returning a super.
 * @property {number} perConceded Charge a lost point adds.
 * @property {number} flickSpeed Paddle speed at a return that fires the super a full meter holds.
 * @property {number} cpuChance Chance that the computer, its meter full, fires its super at a return.
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
 *   curve: number,
 *   widthScale: number,
 * }} opponent `reach` is the share of the court, measured from its own paddle, within which it
 *   reacts; `error` scales how far it misjudges fast balls, in board units; `curve` is spin the
 *   computer adds to its returns, bending them away from the player; `widthScale` sizes its paddle.
 * @property {PowerUpConfig} powerUps
 * @property {SuperConfig} supers
 * @property {BossConfig | null} boss A career boss's attacks, or null for an opponent that only plays.
 */

export {};
