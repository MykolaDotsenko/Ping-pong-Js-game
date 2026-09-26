import {
  bounceFromPaddle,
  clamp,
  clampPaddleCenter,
  contactOffset,
  curveBall,
  findPaddleContact,
  glanceOffPaddle,
  movePaddle,
  paddleClearance,
  reflectFromSideWalls,
} from './physics.js';
import { moveOpponent } from './opponent.js';
import { collectPowerUps, initialPowerUpState, paddleWidth, tickEffects, tickPowerUps } from './power-ups.js';

/**
 * @import { Ball, GameConfig, GameEvent, GameState, InputSnapshot, Side } from './types.js'
 * @import { PaddleContact } from './physics.js'
 */

export const GAME_PHASE = Object.freeze({
  READY: 'ready',
  RUNNING: 'running',
  PAUSED: 'paused',
  GAME_OVER: 'game-over',
});

/** Shared by every transition that produced no events, so quiet steps allocate nothing. */
export const NO_EVENTS = Object.freeze(/** @type {GameEvent[]} */ ([]));

/**
 * @param {GameConfig} config
 * @param {1 | -1} [verticalDirection]
 * @param {1 | -1} [horizontalDirection]
 * @returns {Ball}
 */
function createServeBall(config, verticalDirection = 1, horizontalDirection = 1) {
  const speed = config.ball.initialSpeed;
  const horizontalSpeed = speed * 0.34 * horizontalDirection;
  const verticalSpeed = Math.sqrt(speed ** 2 - horizontalSpeed ** 2) * verticalDirection;

  return {
    x: config.width / 2,
    y: config.height / 2,
    vx: horizontalSpeed,
    vy: verticalSpeed,
    spin: 0,
  };
}

/**
 * @param {GameConfig} config
 * @param {number} [seed] for the deterministic random source; the same seed replays the same match
 * @returns {GameState}
 */
export function createInitialState(config, seed = 1) {
  return {
    phase: GAME_PHASE.READY,
    player: { x: config.width / 2, vx: 0 },
    opponent: { x: config.width / 2, vx: 0 },
    ball: createServeBall(config, 1, 1),
    score: { player: 0, opponent: 0 },
    hits: { player: 0, opponent: 0 },
    lives: config.rules.kind === 'rush' ? config.rules.lives : 0,
    lastPoint: null,
    serveNumber: 0,
    serveCountdown: config.startDelaySeconds,
    rally: 0,
    longestRally: 0,
    ...initialPowerUpState(seed, config),
    events: NO_EVENTS,
  };
}

/**
 * Resumes a paused match, or starts a fresh one from any idle state.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 * @returns {GameState}
 */
export function startGame(state, config) {
  if (state.phase === GAME_PHASE.PAUSED) {
    return { ...state, phase: GAME_PHASE.RUNNING, events: [{ type: 'resumed' }] };
  }

  if (state.phase === GAME_PHASE.RUNNING) {
    return state;
  }

  return {
    ...createInitialState(config, state.seed),
    phase: GAME_PHASE.RUNNING,
    events: [{ type: 'match-start' }],
  };
}

/**
 * Back to the menu.
 *
 * @param {GameConfig} config
 * @param {number} [seed] for the next match
 * @returns {GameState}
 */
export function resetGame(config, seed = 1) {
  return { ...createInitialState(config, seed), events: [{ type: 'menu' }] };
}

/**
 * Pauses a running match and leaves every other phase untouched, so it is safe to
 * request repeatedly, for example whenever the page loses focus.
 *
 * @param {GameState} state
 * @returns {GameState}
 */
export function pauseGame(state) {
  if (state.phase === GAME_PHASE.RUNNING) {
    return { ...state, phase: GAME_PHASE.PAUSED, events: [{ type: 'paused' }] };
  }

  return state;
}

/**
 * @param {GameState} state
 * @returns {GameState}
 */
export function togglePause(state) {
  if (state.phase === GAME_PHASE.PAUSED) {
    return { ...state, phase: GAME_PHASE.RUNNING, events: [{ type: 'resumed' }] };
  }

  return pauseGame(state);
}

/**
 * @param {GameState} state
 * @returns {Side | null} the match winner, or null while the match is not over
 */
export function getWinner(state) {
  if (state.phase !== GAME_PHASE.GAME_OVER) {
    return null;
  }

  return state.score.player > state.score.opponent ? 'player' : 'opponent';
}

/**
 * The side at match point: one point from winning. Null when nobody is, or in Rush.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 * @returns {Side | null}
 */
export function matchPointSide(state, config) {
  if (config.rules.kind !== 'match' || state.phase === GAME_PHASE.GAME_OVER) {
    return null;
  }

  const target = config.rules.winningScore - 1;

  if (state.score.player >= target) {
    return 'player';
  }

  return state.score.opponent >= target ? 'opponent' : null;
}

/**
 * Moves a paddle toward a pointer, or along an axis at keyboard speed, and records how fast
 * it moved, which a hit turns into spin.
 *
 * @param {GameState} state
 * @param {Side} side
 * @param {number | null} pointerX
 * @param {number} axis
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @returns {GameState}
 */
function steerPaddle(state, side, pointerX, axis, deltaSeconds, config) {
  const paddle = state[side];
  let target = paddle.x;

  if (Number.isFinite(pointerX)) {
    target = /** @type {number} */ (pointerX);
  } else if (axis) {
    target = paddle.x + axis * config.paddle.keyboardSpeed * deltaSeconds;
  }

  const x = clampPaddleCenter(target, config, paddleWidth(state, side, config));

  return { ...state, [side]: movePaddle(paddle, x, deltaSeconds, config) };
}

/**
 * @param {GameState} state
 * @param {number} targetX
 * @param {GameConfig} config
 * @returns {GameState}
 */
export function setPlayerPosition(state, targetX, config) {
  return {
    ...state,
    player: {
      ...state.player,
      x: clampPaddleCenter(targetX, config, paddleWidth(state, 'player', config)),
    },
  };
}

/**
 * @param {GameState} state
 * @param {number} axis
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @returns {GameState}
 */
export function movePlayerByAxis(state, axis, deltaSeconds, config) {
  if (!axis) {
    return state;
  }

  const nextX = state.player.x + axis * config.paddle.keyboardSpeed * deltaSeconds;
  return setPlayerPosition(state, nextX, config);
}

/**
 * @param {GameState} state
 * @param {Side} scorer
 * @param {GameConfig} config
 */
function nextServeBall(state, scorer, config) {
  const serveNumber = state.serveNumber + 1;
  const horizontalDirection = serveNumber % 2 === 0 ? 1 : -1;
  const verticalDirection = scorer === 'player' ? 1 : -1;

  return {
    ball: createServeBall(config, verticalDirection, horizontalDirection),
    serveNumber,
  };
}

/**
 * @param {GameState} state
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function withEvents(state, events) {
  return { ...state, events: events.length > 0 ? events : NO_EVENTS };
}

/**
 * @param {GameState} state
 * @param {Side} winner
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function endMatch(state, winner, events) {
  events.push({ type: 'game-over', winner });

  return withEvents({
    ...state,
    phase: GAME_PHASE.GAME_OVER,
    lastPoint: winner,
    ball: { ...state.ball, vx: 0, vy: 0, spin: 0 },
    serveCountdown: 0,
    rally: 0,
    pickups: [],
    turbo: 0,
  }, events);
}

/**
 * @param {GameState} state
 * @param {Side} scorer
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function awardPoint(state, scorer, config, events) {
  const score = { ...state.score, [scorer]: state.score[scorer] + 1 };
  const { rules } = config;
  let { lives } = state;

  events.push({
    type: 'point',
    scorer,
    x: Math.min(Math.max(state.ball.x, 0), config.width),
    y: scorer === 'player' ? 0 : config.height,
  });

  if (rules.kind === 'rush') {
    // Only the player's misses count: each one costs a life, and the last one ends the run.
    if (scorer === 'opponent') {
      lives -= 1;
      events.push({ type: 'life-lost', lives });

      if (lives === 0) {
        return endMatch({ ...state, score, lives }, 'opponent', events);
      }
    }
  } else {
    if (score[scorer] >= rules.winningScore) {
      return endMatch({ ...state, score }, scorer, events);
    }

    if (score[scorer] === rules.winningScore - 1) {
      events.push({ type: 'match-point', side: scorer });
    }
  }

  const nextServe = nextServeBall(state, scorer, config);

  return withEvents({
    ...state,
    score,
    lives,
    lastPoint: scorer,
    ball: nextServe.ball,
    serveNumber: nextServe.serveNumber,
    serveCountdown: config.serveDelaySeconds,
    rally: 0,
    pickups: [],
    turbo: 0,
  }, events);
}

/**
 * @param {Ball} ball
 * @param {number} deltaSeconds
 * @returns {Ball}
 */
function moveBall(ball, deltaSeconds) {
  return {
    ...ball,
    x: ball.x + ball.vx * deltaSeconds,
    y: ball.y + ball.vy * deltaSeconds,
  };
}

/**
 * @param {Side} side
 * @param {GameConfig} config
 */
function paddleTop(side, config) {
  return side === 'player' ? config.height - config.paddle.inset - config.paddle.height : config.paddle.inset;
}

/**
 * Where the ball rests one radius in front of a paddle's face, or behind its back.
 *
 * @param {Side} side
 * @param {'front' | 'back'} which
 * @param {GameConfig} config
 */
function besidePaddleY(side, which, config) {
  const top = paddleTop(side, config);
  const bottom = top + config.paddle.height;
  const radius = config.ball.radius;
  const inFront = side === 'player' ? top - radius : bottom + radius;
  const behind = side === 'player' ? bottom + radius : top - radius;
  return which === 'front' ? inFront : behind;
}

/**
 * Where a glancing ball rests: where it touched the paddle, relative to where the paddle ends
 * the step, so a paddle still moving cannot end up covering it. Squeezed against a wall,
 * that spot is off the court or under the paddle, and the ball slips out behind it instead.
 *
 * @param {GameState} state
 * @param {Side} side
 * @param {PaddleContact} contact
 * @param {GameConfig} config
 */
function glancePosition(state, side, contact, config) {
  const radius = config.ball.radius;
  const x = state[side].x + contact.x;
  const onCourt = clamp(x, radius, config.width - radius);
  const clear = paddleClearance({ x: onCourt, y: contact.y }, state[side].x, paddleTop(side, config), paddleWidth(state, side, config), config)
    >= radius - 1e-9;

  return x === onCourt && clear ? { x, y: contact.y } : { x: onCourt, y: besidePaddleY(side, 'back', config) };
}

/**
 * A return: the ball met the paddle's face, or one of its front corners.
 *
 * @param {GameState} state
 * @param {Side} side
 * @param {PaddleContact} contact
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function hitPaddle(state, side, contact, config, events) {
  const paddle = state[side];
  const width = paddleWidth(state, side, config);
  const struck = paddle.x + contact.x;
  const bounced = bounceFromPaddle({ ...state.ball, x: struck }, paddle.x, side === 'player' ? -1 : 1, config, paddle.vx, width);
  // The return leaves from the face: level with it, a paddle sliding sideways cannot catch
  // the ball again, even after a corner hit.
  const x = clamp(struck, config.ball.radius, config.width - config.ball.radius);
  const y = besidePaddleY(side, 'front', config);
  const ball = { ...bounced, x, y };
  const rally = state.rally + 1;

  events.push({
    type: 'paddle-hit',
    side,
    x,
    y,
    speed: Math.hypot(ball.vx, ball.vy),
    spin: ball.spin,
    offset: contactOffset(struck, paddle.x, width),
    rally,
  });

  return {
    ...state,
    ball,
    rally,
    longestRally: Math.max(state.longestRally, rally),
    hits: { ...state.hits, [side]: state.hits[side] + 1 },
    // Turbo is one blistering shot: the return comes back at normal speed, so it ends here.
    turbo: 0,
  };
}

/**
 * A touch that saves nothing: the ball clipped the paddle's side or back corner, or the
 * paddle was swept into a ball that had already passed it. The ball glances off, so it never
 * shows through the paddle, and carries on toward the goal line.
 *
 * @param {GameState} state
 * @param {Side} side
 * @param {PaddleContact} contact
 * @param {number} paddleVx the paddle's velocity over this step
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function glancePaddle(state, side, contact, paddleVx, config, events) {
  const normal = { x: contact.normalX, y: contact.normalY };
  const moved = contact.approaching ? glanceOffPaddle(state.ball, normal, paddleVx, config.ball.maxSpeed) : state.ball;
  const { x, y } = glancePosition(state, side, contact, config);

  if (contact.approaching) {
    events.push({ type: 'paddle-graze', side, x, y, speed: Math.hypot(moved.vx, moved.vy) });
  }

  return { ...state, ball: { ...moved, x, y } };
}

/**
 * @param {GameState} state
 * @param {Ball} previousBall
 * @param {Record<Side, number>} previousPaddleX where each paddle was when the step began
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function resolveCollisions(state, previousBall, previousPaddleX, deltaSeconds, config, events) {
  const ball = reflectFromSideWalls(state.ball, config);

  if (ball !== state.ball) {
    events.push({ type: 'wall-bounce', x: ball.x, y: ball.y, speed: Math.hypot(ball.vx, ball.vy) });
  }

  const next = { ...state, ball };
  // Only the paddle the ball is heading for can meet it.
  const side = ball.vy > 0 ? 'player' : 'opponent';
  const contact = findPaddleContact({
    from: previousBall,
    to: ball,
    paddleFrom: previousPaddleX[side],
    paddleTo: next[side].x,
    paddleTop: paddleTop(side, config),
    paddleWidth: paddleWidth(next, side, config),
    config,
  });

  if (!contact) {
    return next;
  }

  // The face the ball should meet points into the court: up for the player, down for the opponent.
  const facesBall = contact.normalY * (side === 'player' ? -1 : 1) > 0;

  if (facesBall && contact.approaching) {
    return hitPaddle(next, side, contact, config, events);
  }

  const paddleVx = (next[side].x - previousPaddleX[side]) / deltaSeconds;
  return glancePaddle(next, side, contact, paddleVx, config, events);
}

/**
 * Runs the pre-serve wait. The first serve of a match counts down aloud from three.
 *
 * @param {GameState} state
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function waitForServe(state, deltaSeconds, config, events) {
  const remaining = state.serveCountdown;
  const serveCountdown = Math.max(0, remaining - deltaSeconds);

  if (state.serveNumber === 0) {
    const started = remaining === config.startDelaySeconds;

    if ((started || Math.ceil(serveCountdown) < Math.ceil(remaining)) && serveCountdown > 0) {
      events.push({ type: 'countdown', value: Math.ceil(serveCountdown) });
    }
  }

  if (serveCountdown === 0) {
    events.push({ type: 'serve', x: state.ball.x, y: state.ball.y });
  }

  return withEvents({ ...state, serveCountdown }, events);
}

/**
 * Advances the simulation by one fixed step. Does nothing unless the match is running.
 * The returned state lists the events of this step, such as hits, bounces and points.
 *
 * @param {GameState} state
 * @param {number} deltaSeconds
 * @param {InputSnapshot} input
 * @param {GameConfig} config
 * @returns {GameState}
 */
export function advanceGame(state, deltaSeconds, input, config) {
  if (state.phase !== GAME_PHASE.RUNNING) {
    return state;
  }

  /** @type {GameEvent[]} */
  const events = [];
  const previousPaddleX = { player: state.player.x, opponent: state.opponent.x };
  let nextState = steerPaddle(state, 'player', input.pointerX, input.horizontalAxis, deltaSeconds, config);
  nextState = config.opponent.controller === 'human'
    ? steerPaddle(nextState, 'opponent', input.opponentPointerX, input.opponentAxis, deltaSeconds, config)
    : moveOpponent(nextState, deltaSeconds, config);

  if (nextState.serveCountdown > 0) {
    // The ball waits at the center before each serve; both paddles can already move,
    // and any power-up effect keeps wearing off.
    return waitForServe(tickEffects(nextState, deltaSeconds), deltaSeconds, config, events);
  }

  nextState = tickPowerUps(nextState, deltaSeconds, config, events);

  const previousBall = nextState.ball;
  nextState = { ...nextState, ball: moveBall(curveBall(previousBall, deltaSeconds, config), deltaSeconds) };
  nextState = resolveCollisions(nextState, previousBall, previousPaddleX, deltaSeconds, config, events);
  nextState = collectPowerUps(nextState, config, events);

  if (nextState.ball.y - config.ball.radius > config.height) {
    return awardPoint(nextState, 'opponent', config, events);
  }

  if (nextState.ball.y + config.ball.radius < 0) {
    return awardPoint(nextState, 'player', config, events);
  }

  return withEvents(nextState, events);
}
