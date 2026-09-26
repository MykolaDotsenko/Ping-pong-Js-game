import {
  bounceFromPaddle,
  clampPaddleCenter,
  contactOffset,
  curveBall,
  findPaddleContact,
  glanceOffPaddle,
  movePaddle,
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
    // The walls keep the ball on the court, so this is where it crossed the goal line.
    x: state.ball.x,
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
 * Where the ball rests one radius in front of a paddle's face.
 *
 * @param {Side} side
 * @param {GameConfig} config
 */
function inFrontOfPaddleY(side, config) {
  const top = paddleTop(side, config);
  return side === 'player' ? top - config.ball.radius : top + config.paddle.height + config.ball.radius;
}

/**
 * A return: the ball met the paddle's face, or one of its front corners. It leaves from where
 * it was struck, which for a paddle that moved fast is not where the paddle ends the step.
 *
 * @param {GameState} state
 * @param {Side} side
 * @param {PaddleContact} contact
 * @param {number} paddleX where the paddle's center was at the moment of contact
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function hitPaddle(state, side, contact, paddleX, config, events) {
  const paddle = state[side];
  const width = paddleWidth(state, side, config);
  const struck = paddleX + contact.x;
  const bounced = bounceFromPaddle({ ...state.ball, x: struck }, paddleX, side === 'player' ? -1 : 1, config, paddle.vx, width);
  // The return leaves from the face: level with it, a paddle sliding sideways cannot catch
  // the ball again, even after a corner hit. Where it was struck lies on its path, so on the court.
  const x = struck;
  const y = inFrontOfPaddleY(side, config);
  const ball = { ...bounced, x, y };
  const rally = state.rally + 1;

  events.push({
    type: 'paddle-hit',
    side,
    x,
    y,
    speed: Math.hypot(ball.vx, ball.vy),
    spin: ball.spin,
    offset: contactOffset(struck, paddleX, width),
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
 * A touch that saves nothing: the ball met the paddle's side or back corner. A paddle that
 * runs into the ball side-on stops against it and never shoves it along, so a missed ball
 * keeps its course however the player moves; a ball that flies into the side bounces off it.
 * Either way it never shows through the paddle, and carries on toward the goal line.
 *
 * @param {GameState} state
 * @param {GameState} before the state the step began with
 * @param {Side} side
 * @param {PaddleContact} contact
 * @param {number} paddleX where the paddle's center was at the moment of contact
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function glancePaddle(state, before, side, contact, paddleX, deltaSeconds, config, events) {
  const normal = { x: contact.normalX, y: contact.normalY };
  const flyingIn = state.ball.vx * normal.x + state.ball.vy * normal.y < 0;
  const moved = flyingIn ? glanceOffPaddle(state.ball, normal) : state.ball;
  const touch = { x: paddleX + contact.x, y: contact.y };

  if (flyingIn) {
    events.push({ type: 'paddle-graze', side, x: touch.x, y: touch.y, speed: Math.hypot(moved.vx, moved.vy) });
  }

  // From the touch, the ball travels on for the rest of the step, away from or along the side.
  const travelled = moveBall({ ...moved, ...touch }, (1 - contact.time) * deltaSeconds);
  const ball = reflectFromSideWalls(travelled, config);

  if (ball !== travelled) {
    events.push({ type: 'wall-bounce', x: ball.x, y: ball.y, speed: Math.hypot(ball.vx, ball.vy) });
  }

  const paddle = paddleX === state[side].x ? state[side] : movePaddle(before[side], paddleX, deltaSeconds, config);
  return { ...state, [side]: paddle, ball };
}

/**
 * @param {GameState} state
 * @param {GameState} before the state the step began with
 * @param {Ball} previousBall
 * @param {number} deltaSeconds
 * @param {GameConfig} config
 * @param {GameEvent[]} events
 * @returns {GameState}
 */
function resolveCollisions(state, before, previousBall, deltaSeconds, config, events) {
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
    paddleFrom: before[side].x,
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

  // Where the paddle was when they touched: a paddle moved by a tap may end the step far away.
  const paddleX = before[side].x + contact.time * (next[side].x - before[side].x);

  if (facesBall && contact.approaching) {
    return hitPaddle(next, side, contact, paddleX, config, events);
  }

  return glancePaddle(next, before, side, contact, paddleX, deltaSeconds, config, events);
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
  nextState = resolveCollisions(nextState, state, previousBall, deltaSeconds, config, events);
  nextState = collectPowerUps(nextState, config, events);

  if (nextState.ball.y - config.ball.radius > config.height) {
    return awardPoint(nextState, 'opponent', config, events);
  }

  if (nextState.ball.y + config.ball.radius < 0) {
    return awardPoint(nextState, 'player', config, events);
  }

  return withEvents(nextState, events);
}
