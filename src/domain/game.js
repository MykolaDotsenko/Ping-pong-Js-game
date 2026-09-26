import {
  bounceFromPaddle,
  clampPaddleCenter,
  curveBall,
  findPaddleCollision,
  movePaddle,
  reflectFromSideWalls,
} from './physics.js';
import { moveOpponent } from './opponent.js';

/** @import { Ball, GameConfig, GameEvent, GameState, InputSnapshot, Side } from './types.js' */

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
 * @returns {GameState}
 */
export function createInitialState(config) {
  return {
    phase: GAME_PHASE.READY,
    player: { x: config.width / 2, vx: 0 },
    opponent: { x: config.width / 2, vx: 0 },
    ball: createServeBall(config, 1, 1),
    score: { player: 0, opponent: 0 },
    lastPoint: null,
    serveNumber: 0,
    serveCountdown: config.serveDelaySeconds,
    rally: 0,
    longestRally: 0,
    events: NO_EVENTS,
  };
}

/**
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
    ...createInitialState(config),
    phase: GAME_PHASE.RUNNING,
    events: [{ type: 'match-start' }],
  };
}

/**
 * @param {GameConfig} config
 * @returns {GameState}
 */
export function resetGame(config) {
  return createInitialState(config);
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
      x: clampPaddleCenter(targetX, config),
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
 * Applies the player's input and records how fast the paddle moved, which a hit turns into spin.
 *
 * @param {GameState} state
 * @param {InputSnapshot} input
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @returns {GameState}
 */
function steerPlayer(state, input, deltaSeconds, config) {
  const steered = Number.isFinite(input.pointerX)
    ? setPlayerPosition(state, /** @type {number} */ (input.pointerX), config)
    : movePlayerByAxis(state, input.horizontalAxis, deltaSeconds, config);

  return { ...steered, player: movePaddle(state.player, steered.player.x, deltaSeconds, config) };
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
 * @param {Side} scorer
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function awardPoint(state, scorer, config, events) {
  const score = {
    ...state.score,
    [scorer]: state.score[scorer] + 1,
  };

  events.push({
    type: 'point',
    scorer,
    x: Math.min(Math.max(state.ball.x, 0), config.width),
    y: scorer === 'player' ? 0 : config.height,
  });

  if (score[scorer] >= config.winningScore) {
    events.push({ type: 'game-over', winner: scorer });

    return withEvents({
      ...state,
      score,
      phase: GAME_PHASE.GAME_OVER,
      lastPoint: scorer,
      ball: { ...state.ball, vx: 0, vy: 0, spin: 0 },
      serveCountdown: 0,
      rally: 0,
    }, events);
  }

  const nextServe = nextServeBall(state, scorer, config);

  return withEvents({
    ...state,
    score,
    lastPoint: scorer,
    ball: nextServe.ball,
    serveNumber: nextServe.serveNumber,
    serveCountdown: config.serveDelaySeconds,
    rally: 0,
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
 * @param {GameState} state
 * @param {Side} side
 * @param {{ time: number, x: number }} collision
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function hitPaddle(state, side, collision, config, events) {
  const paddle = state[side];
  const isPlayer = side === 'player';
  const faceY = isPlayer
    ? config.height - config.paddle.inset - config.paddle.height - config.ball.radius
    : config.paddle.inset + config.paddle.height + config.ball.radius;
  const bounced = bounceFromPaddle({ ...state.ball, x: collision.x }, paddle.x, isPlayer ? -1 : 1, config, paddle.vx);
  const ball = { ...bounced, y: faceY };
  const rally = state.rally + 1;

  events.push({
    type: 'paddle-hit',
    side,
    x: collision.x,
    y: faceY,
    speed: Math.hypot(ball.vx, ball.vy),
    spin: ball.spin,
    rally,
  });

  return { ...state, ball, rally, longestRally: Math.max(state.longestRally, rally) };
}

/**
 * @param {GameState} state
 * @param {Ball} previousBall
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function resolveCollisions(state, previousBall, config, events) {
  const ball = reflectFromSideWalls(state.ball, config);

  if (ball !== state.ball) {
    events.push({ type: 'wall-bounce', x: ball.x, y: ball.y, speed: Math.hypot(ball.vx, ball.vy) });
  }

  const next = { ...state, ball };
  const movingDown = ball.vy > 0;
  const side = movingDown ? 'player' : 'opponent';
  const collision = findPaddleCollision({
    previousBall,
    ball,
    paddleCenterX: next[side].x,
    paddleY: movingDown
      ? config.height - config.paddle.inset - config.paddle.height
      : config.paddle.inset,
    movingDown,
    config,
  });

  return collision ? hitPaddle(next, side, collision, config, events) : next;
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
  let nextState = steerPlayer(state, input, deltaSeconds, config);
  nextState = moveOpponent(nextState, deltaSeconds, config);

  if (nextState.serveCountdown > 0) {
    // The ball waits at the center before each serve; both paddles can already move.
    const serveCountdown = Math.max(0, nextState.serveCountdown - deltaSeconds);

    if (serveCountdown === 0) {
      events.push({ type: 'serve', x: nextState.ball.x, y: nextState.ball.y });
    }

    return withEvents({ ...nextState, serveCountdown }, events);
  }

  const previousBall = nextState.ball;
  nextState = { ...nextState, ball: moveBall(curveBall(previousBall, deltaSeconds, config), deltaSeconds) };
  nextState = resolveCollisions(nextState, previousBall, config, events);

  if (nextState.ball.y - config.ball.radius > config.height) {
    return awardPoint(nextState, 'opponent', config, events);
  }

  if (nextState.ball.y + config.ball.radius < 0) {
    return awardPoint(nextState, 'player', config, events);
  }

  return withEvents(nextState, events);
}
