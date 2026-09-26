import {
  bounceFromPaddle,
  clampPaddleCenter,
  findPaddleCollision,
  reflectFromSideWalls,
} from './physics.js';
import { moveOpponent } from './opponent.js';

/** @import { Ball, GameConfig, GameState, InputSnapshot, Side } from './types.js' */

export const GAME_PHASE = Object.freeze({
  READY: 'ready',
  RUNNING: 'running',
  PAUSED: 'paused',
  GAME_OVER: 'game-over',
});

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
  };
}

/**
 * @param {GameConfig} config
 * @returns {GameState}
 */
export function createInitialState(config) {
  return {
    phase: GAME_PHASE.READY,
    player: { x: config.width / 2 },
    opponent: { x: config.width / 2 },
    ball: createServeBall(config, 1, 1),
    score: { player: 0, opponent: 0 },
    lastPoint: null,
    serveNumber: 0,
    serveCountdown: config.serveDelaySeconds,
  };
}

/**
 * @param {GameState} state
 * @param {GameConfig} config
 * @returns {GameState}
 */
export function startGame(state, config) {
  if (state.phase === GAME_PHASE.PAUSED) {
    return { ...state, phase: GAME_PHASE.RUNNING };
  }

  if (state.phase === GAME_PHASE.RUNNING) {
    return state;
  }

  return {
    ...createInitialState(config),
    phase: GAME_PHASE.RUNNING,
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
    return { ...state, phase: GAME_PHASE.PAUSED };
  }

  return state;
}

/**
 * @param {GameState} state
 * @returns {GameState}
 */
export function togglePause(state) {
  if (state.phase === GAME_PHASE.PAUSED) {
    return { ...state, phase: GAME_PHASE.RUNNING };
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
 * @param {Side} scorer
 * @param {GameConfig} config
 * @returns {GameState}
 */
function awardPoint(state, scorer, config) {
  const score = {
    ...state.score,
    [scorer]: state.score[scorer] + 1,
  };

  if (score[scorer] >= config.winningScore) {
    return {
      ...state,
      score,
      phase: GAME_PHASE.GAME_OVER,
      lastPoint: scorer,
      ball: { ...state.ball, vx: 0, vy: 0 },
    };
  }

  const nextServe = nextServeBall(state, scorer, config);

  return {
    ...state,
    score,
    lastPoint: scorer,
    ball: nextServe.ball,
    serveNumber: nextServe.serveNumber,
    serveCountdown: config.serveDelaySeconds,
  };
}

/**
 * @param {GameState} state
 * @param {number} deltaSeconds
 * @returns {GameState}
 */
function moveBall(state, deltaSeconds) {
  return {
    ...state,
    ball: {
      ...state.ball,
      x: state.ball.x + state.ball.vx * deltaSeconds,
      y: state.ball.y + state.ball.vy * deltaSeconds,
    },
  };
}

/**
 * @param {GameState} state
 * @param {Ball} previousBall
 * @param {GameConfig} config
 * @returns {GameState}
 */
function resolveCollisions(state, previousBall, config) {
  let ball = reflectFromSideWalls(state.ball, config);
  const playerY = config.height - config.paddle.inset - config.paddle.height;
  const opponentY = config.paddle.inset;

  if (ball.vy > 0) {
    const collision = findPaddleCollision({
      previousBall,
      ball,
      paddleCenterX: state.player.x,
      paddleY: playerY,
      movingDown: true,
      config,
    });

    if (collision) {
      ball = {
        ...bounceFromPaddle(
          { ...ball, x: collision.x },
          state.player.x,
          -1,
          config,
        ),
        y: playerY - config.ball.radius,
      };
    }
  } else if (ball.vy < 0) {
    const collision = findPaddleCollision({
      previousBall,
      ball,
      paddleCenterX: state.opponent.x,
      paddleY: opponentY,
      movingDown: false,
      config,
    });

    if (collision) {
      ball = {
        ...bounceFromPaddle(
          { ...ball, x: collision.x },
          state.opponent.x,
          1,
          config,
        ),
        y: opponentY + config.paddle.height + config.ball.radius,
      };
    }
  }

  return { ...state, ball };
}

/**
 * Advances the simulation by one fixed step. Does nothing unless the match is running.
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

  let nextState = state;

  if (Number.isFinite(input.pointerX)) {
    nextState = setPlayerPosition(nextState, /** @type {number} */ (input.pointerX), config);
  } else {
    nextState = movePlayerByAxis(nextState, input.horizontalAxis, deltaSeconds, config);
  }

  nextState = moveOpponent(nextState, deltaSeconds, config);

  if (nextState.serveCountdown > 0) {
    // The ball waits at the center before each serve; both paddles can already move.
    return {
      ...nextState,
      serveCountdown: Math.max(0, nextState.serveCountdown - deltaSeconds),
    };
  }

  const previousBall = nextState.ball;
  nextState = moveBall(nextState, deltaSeconds);
  nextState = resolveCollisions(nextState, previousBall, config);

  if (nextState.ball.y - config.ball.radius > config.height) {
    return awardPoint(nextState, 'opponent', config);
  }

  if (nextState.ball.y + config.ball.radius < 0) {
    return awardPoint(nextState, 'player', config);
  }

  return nextState;
}
