import test from 'node:test';
import assert from 'node:assert/strict';

import { DIFFICULTY_CONFIGS, GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG } from '../src/config.js';
import { advanceGame, createInitialState, GAME_PHASE, startGame } from '../src/domain/game.js';
import { paddleWidth } from '../src/domain/power-ups.js';
import { nextBetween, nextRandom } from '../src/domain/random.js';

// How a ball meets a paddle across whole steps of the game: the face and front corners
// return it, the sides and back corners deflect it, and it never shows inside a paddle.

const PLAIN = { ...GAME_CONFIG, powerUps: { ...GAME_CONFIG.powerUps, enabled: false } };
const { height, ball: ballConfig, paddle } = PLAIN;
const radius = ballConfig.radius;
const step = PLAIN.fixedStepSeconds;
const face = height - paddle.inset - paddle.height;
const halfPaddle = paddle.width / 2;

const hold = (x) => ({ horizontalAxis: 0, pointerX: x, opponentAxis: 0, opponentPointerX: null });

/**
 * How far the ball's center is from a paddle's rectangle; below one radius they overlap.
 *
 * @param {import('../src/domain/types.js').GameState} state
 * @param {'player' | 'opponent'} side
 * @param {typeof PLAIN} config
 */
function clearance(state, side, config) {
  const half = paddleWidth(state, side, config) / 2;
  const top = side === 'player' ? config.height - config.paddle.inset - config.paddle.height : config.paddle.inset;
  const dx = Math.max(state[side].x - half - state.ball.x, 0, state.ball.x - (state[side].x + half));
  const dy = Math.max(top - state.ball.y, 0, state.ball.y - (top + config.paddle.height));
  return Math.hypot(dx, dy);
}

/**
 * Plays steps until a point is scored, recording every event and the ball's closest approach
 * to the player's paddle.
 */
function playOutPoint(state, input, config = PLAIN, maxSteps = 600) {
  const events = [];
  let closest = Infinity;

  for (let i = 0; i < maxSteps; i += 1) {
    const scoreBefore = state.score;
    state = advanceGame(state, step, typeof input === 'function' ? input(state) : input, config);
    events.push(...state.events);

    if (state.score !== scoreBefore) {
      return { state, events, closest };
    }

    closest = Math.min(closest, clearance(state, 'player', config));
  }

  return { state, events, closest };
}

/** A running match with the ball in flight, aimed so it reaches the face plane at xAtFace. */
function diagonalApproach(xAtFace, paddleX, { speed = 700, angle = ballConfig.maxBounceAngleRadians, lead = 60 } = {}) {
  const vx = -Math.sin(angle) * speed;
  const vy = Math.cos(angle) * speed;
  const y = face - radius - lead;
  const x = xAtFace - vx * (lead / vy);

  return {
    ...startGame(createInitialState(PLAIN, 7), PLAIN),
    serveCountdown: 0,
    player: { x: paddleX, vx: 0 },
    ball: { x, y, vx, vy, spin: 0 },
  };
}

test('a ball clipping the front corner is returned from the edge instead of passing through', () => {
  // The case the old face-plane test got wrong: the ball reached the face plane 25 units
  // wide of the paddle, then flew through its corner and scored.
  const start = diagonalApproach(250 + halfPaddle + 25, 250);
  const { events, closest } = playOutPoint(start, hold(250));
  const hit = events.find((event) => event.type === 'paddle-hit');

  assert.ok(hit, 'the corner returns the ball');
  assert.equal(hit.side, 'player');
  assert.equal(hit.offset, 1, 'at the very edge');
  assert.ok(closest >= radius - 1e-6, `the ball came ${closest.toFixed(3)} units from the paddle`);
});

test('a ball that has passed the face glances off the side and the point is lost', () => {
  const start = diagonalApproach(250 + halfPaddle + 36, 250);
  const { state, events, closest } = playOutPoint(start, hold(250));
  const graze = events.find((event) => event.type === 'paddle-graze');

  assert.ok(graze, 'the side deflects the ball');
  assert.equal(graze.side, 'player');
  assert.equal(events.some((event) => event.type === 'paddle-hit'), false);
  assert.equal(state.score.opponent, 1);
  assert.ok(closest >= radius - 1e-6, `the ball came ${closest.toFixed(3)} units from the paddle`);
});

test('a paddle swept into a ball beside it knocks the ball away instead of covering it', () => {
  const start = {
    ...startGame(createInitialState(PLAIN, 7), PLAIN),
    serveCountdown: 0,
    player: { x: 250, vx: 0 },
    ball: { x: 250 + halfPaddle + radius + 4, y: face + 4, vx: 0, vy: 240, spin: 0 },
  };
  const next = advanceGame(start, step, hold(290), PLAIN);

  assert.deepEqual(next.events.map((event) => event.type), ['paddle-graze']);
  assert.ok(next.ball.vx > 0, 'pushed the way the paddle moved');
  assert.ok(next.ball.vy > 0, 'still heading for the goal line');
  assert.ok(clearance(next, 'player', PLAIN) >= radius - 1e-6);
});

test('a ball squeezed between the paddle and a wall slips out behind the paddle', () => {
  const start = {
    ...startGame(createInitialState(PLAIN, 7), PLAIN),
    serveCountdown: 0,
    player: { x: 100, vx: 0 },
    ball: { x: 25, y: face + 6, vx: 0, vy: 240, spin: 0 },
  };
  // The paddle is yanked against the left wall, leaving the ball no room beside it.
  const next = advanceGame(start, step, hold(0), PLAIN);

  assert.equal(next.player.x, halfPaddle);
  assert.equal(next.ball.y, face + paddle.height + radius, 'behind the paddle');
  assert.ok(clearance(next, 'player', PLAIN) >= radius - 1e-6);
  assert.ok(next.ball.x >= radius);
});

test('a fast ball aimed at the middle of the paddle is always returned, at any speed', () => {
  for (const speed of [440, 1050, 1250, 1500, 2400]) {
    const start = {
      ...startGame(createInitialState(PLAIN, 7), PLAIN),
      serveCountdown: 0,
      ball: { x: 250, y: face - 200, vx: 0, vy: speed, spin: 0 },
    };
    const { events } = playOutPoint(start, hold(250), PLAIN, 120);

    assert.ok(events.some((event) => event.type === 'paddle-hit'), `at ${speed} units per second`);
  }
});

/**
 * Deterministic bots for the property test: each follows the ball with its own aiming error,
 * and now and then yanks its paddle sideways, which is what finds contact bugs.
 */
function createBot(seed) {
  let state = seed;
  let error = 0;
  let rally = -1;

  const draw = (min, max) => {
    const roll = nextBetween(state, min, max);
    state = roll.seed;
    return roll.value;
  };

  return (ballX, currentRally) => {
    if (currentRally !== rally) {
      rally = currentRally;
      error = draw(-70, 70);
    }

    const chance = nextRandom(state);
    state = chance.seed;
    return chance.value < 0.01 ? ballX + draw(-140, 140) : ballX + error;
  };
}

test('across many simulated matches the ball never overlaps a paddle', () => {
  const configs = {
    easy: DIFFICULTY_CONFIGS.easy,
    normal: GAME_CONFIG,
    hard: DIFFICULTY_CONFIGS.hard,
    rush: RUSH_CONFIG,
    duo: TWO_PLAYER_CONFIG,
  };
  let steps = 0;
  let hits = 0;
  let grazes = 0;
  const overlaps = [];

  for (const [name, config] of Object.entries(configs)) {
    for (let match = 0; match < 12; match += 1) {
      const seed = 1000 + match * 7919;
      const bottom = createBot(seed);
      const top = createBot(seed + 1);
      let state = startGame(createInitialState(config, seed), config);

      for (let i = 0; i < 90 / step && state.phase === GAME_PHASE.RUNNING; i += 1) {
        const input = {
          horizontalAxis: 0,
          pointerX: bottom(state.ball.x, state.rally),
          opponentAxis: 0,
          opponentPointerX: config.opponent.controller === 'human' ? top(state.ball.x, state.rally) : null,
        };
        state = advanceGame(state, step, input, config);
        steps += 1;

        for (const event of state.events) {
          if (event.type === 'paddle-hit') hits += 1;
          if (event.type === 'paddle-graze') grazes += 1;
        }

        for (const side of /** @type {const} */ (['player', 'opponent'])) {
          const gap = clearance(state, side, config);

          if (gap < config.ball.radius - 1e-6 && overlaps.length < 5) {
            overlaps.push({ name, match, step: i, side, gap, ball: state.ball, paddle: state[side] });
          }
        }

        assert.ok(Number.isFinite(state.ball.x) && Number.isFinite(state.ball.y));
        assert.ok(state.ball.x >= config.ball.radius - 1e-6 && state.ball.x <= config.width - config.ball.radius + 1e-6);
      }
    }
  }

  assert.deepEqual(overlaps, []);
  assert.ok(steps > 100_000, `simulated ${steps} steps`);
  assert.ok(hits > 1000 && grazes > 20, `saw ${hits} hits and ${grazes} grazes`);
});
