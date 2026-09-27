import { paddleWidth } from '../../domain/power-ups.js';
import { finisherFor } from '../finisher.js';
import { PICKUP_STYLE, speedIntensity, THEME } from './theme.js';

/**
 * @import { GameConfig, GameEvent, GameState, Side } from '../../domain/types.js'
 * @import { Effects } from '../effects.js'
 * @import { Finisher } from '../finisher.js'
 *
 * @typedef {object} EventContext
 * @property {GameConfig} config the match being played
 * @property {() => number} random places the victory fireworks
 * @property {boolean} [jokes] the fun extras preference, which the finisher needs
 * @property {GameState} [state] the state the events came with, for where the paddles are
 */

// A hit this far from the paddle's center, or with this much curve or speed, earns a callout.
export const EDGE_OFFSET = 0.8;
export const CURVE_SPIN = 0.35;
export const SMASH_SPEED_SHARE = 0.75;

/**
 * The visual side of game events: sparks, shockwaves, screen shake, flashes and callouts.
 *
 * @param {Effects} effects
 * @param {readonly GameEvent[]} events
 * @param {EventContext} context
 */
export function playEvents(effects, events, { config, random, jokes = false, state }) {
  const { width, height, ball } = config;

  for (const event of events) {
    switch (event.type) {
      case 'match-start':
        effects.clear();
        effects.ring({ x: width / 2, y: height / 2, color: `rgba(${THEME.violet}, 0.9)`, radius: 20, growth: 560, life: 0.6, width: 5 });
        effects.flash(`rgb(${THEME.violet})`, 0.16);
        break;
      case 'countdown':
        effects.ring({ x: width / 2, y: height / 2, color: `rgba(${THEME.violet}, 0.7)`, radius: 40, growth: 260, life: 0.5, width: 3 });
        effects.pulse(0.5);
        break;
      case 'serve':
        effects.clearLabels();
        effects.ring({ x: event.x, y: event.y, color: `rgba(${THEME.violet}, 0.8)`, radius: ball.radius + 2, growth: 200, life: 0.35, width: 2 });
        effects.burst({ x: event.x, y: event.y, color: `rgb(${THEME.violet})`, count: 10, speed: 130, life: 0.4, size: 1.6 });
        break;
      case 'paddle-hit':
        celebrateHit(effects, event, config);
        break;
      case 'paddle-graze': {
        // A glancing touch off the paddle's side: a dull spark and no fanfare, since it saves nothing.
        effects.burst({ x: event.x, y: event.y, color: `rgb(${THEME.side[event.side].rgb})`, count: 10, speed: 160, life: 0.3, size: 1.5 });
        effects.kick(event.side);
        effects.shake(0.12);
        break;
      }
      case 'wall-bounce':
        effects.burst({ x: event.x, y: event.y, color: '#c4b5fd', count: 8, speed: 180, direction: event.x < width / 2 ? 0 : Math.PI, spread: 2.4, life: 0.35, size: 1.6 });
        effects.ring({ x: event.x, y: event.y, color: `rgba(${THEME.violet}, 0.8)`, radius: 4, growth: 170, life: 0.25, width: 2 });
        break;
      case 'pickup-spawn':
        effects.ring({ x: event.x, y: event.y, color: `rgba(${PICKUP_STYLE[event.kind].rgb}, 0.9)`, radius: 4, growth: 260, life: 0.5, width: 3 });
        break;
      case 'pickup': {
        const style = PICKUP_STYLE[event.kind];
        const color = `rgb(${style.rgb})`;

        effects.burst({ x: event.x, y: event.y, color, count: 36, speed: 300, life: 0.6, size: 2.2 });
        effects.ring({ x: event.x, y: event.y, color, radius: 10, growth: 520, life: 0.5, width: 4 });
        effects.flash(color, 0.14);
        effects.label({ text: style.label, x: event.x, y: event.y - 30, color, size: 26 });
        break;
      }
      case 'point': {
        const color = `rgb(${THEME.side[event.scorer].rgb})`;
        const intoCourt = event.y === 0 ? Math.PI / 2 : -Math.PI / 2;
        const y = Math.min(Math.max(event.y, 8), height - 8);

        effects.burst({ x: event.x, y, color, count: 70, speed: 430, direction: intoCourt, spread: Math.PI * 1.1, life: 0.9, size: 2.6 });
        effects.burst({ x: event.x, y, color: THEME.spark, count: 16, speed: 520, direction: intoCourt, spread: 1.4, life: 0.5, size: 1.6 });
        effects.ring({ x: event.x, y, color, radius: 12, growth: 720, life: 0.6, width: 6 });
        effects.flash(color, 0.34);
        effects.shake(0.95);
        effects.pulse(1);
        break;
      }
      case 'match-point':
        effects.label({ text: 'MATCH POINT', x: width / 2, y: height / 2, color: `rgb(${THEME.amber})`, life: 1.4, size: 34 });
        effects.ring({ x: width / 2, y: height / 2, color: `rgba(${THEME.amber}, 0.9)`, radius: 30, growth: 700, life: 0.8, width: 6 });
        break;
      case 'life-lost':
        effects.flash(`rgb(${THEME.rose})`, 0.3);
        effects.shake(1.1);
        break;
      case 'game-over': {
        const finisher = state ? finisherFor({
          winner: event.winner,
          twoPlayers: config.opponent.controller === 'human',
          rush: config.rules.kind === 'rush',
          jokes,
          seed: state.seed,
        }) : null;

        if (finisher && state) {
          finish(effects, finisher, state, config);
          // The fireworks wait for the finisher to land.
          effects.schedule(0.5, () => celebrate(effects, event.winner, config, random));
        } else {
          celebrate(effects, event.winner, config, random);
        }
        break;
      }
      default:
        break;
    }
  }
}

/**
 * The callout a hit earns, if any: a curve beats a smash, which beats a catch at the edge.
 *
 * @param {Extract<GameEvent, { type: 'paddle-hit' }>} event
 * @param {GameConfig} config
 * @returns {{ text: string, rgb: string } | null}
 */
export function calloutFor(event, config) {
  if (Math.abs(event.spin) >= CURVE_SPIN) {
    return { text: 'CURVE!', rgb: THEME.lime };
  }

  if (speedIntensity(event.speed, config) >= SMASH_SPEED_SHARE) {
    return { text: 'SMASH!', rgb: THEME.amber };
  }

  if (Math.abs(event.offset) >= EDGE_OFFSET) {
    return { text: 'EDGE!', rgb: THEME.rose };
  }

  return null;
}

/**
 * @param {Effects} effects
 * @param {Extract<GameEvent, { type: 'paddle-hit' }>} event
 * @param {GameConfig} config
 */
function celebrateHit(effects, event, config) {
  const { width, height } = config;
  const color = `rgb(${THEME.side[event.side].rgb})`;
  const intensity = speedIntensity(event.speed, config);
  const outward = event.side === 'player' ? -Math.PI / 2 : Math.PI / 2;

  effects.burst({ x: event.x, y: event.y, color, count: 22 + Math.round(20 * intensity), speed: 300 + 320 * intensity, direction: outward, spread: 2.3, life: 0.55, size: 2.4 });
  effects.burst({ x: event.x, y: event.y, color: THEME.spark, count: 8, speed: 420, direction: outward, spread: 1.2, life: 0.3, size: 1.5 });
  effects.ring({ x: event.x, y: event.y, color, radius: 8, growth: 300 + 240 * intensity, life: 0.35 });
  effects.kick(event.side);
  effects.shake(0.16 + 0.34 * intensity);
  effects.pulse(0.3 + 0.45 * intensity);
  effects.pop();

  const callout = calloutFor(event, config);

  if (callout) {
    const labelY = event.side === 'player' ? event.y - 40 : event.y + 44;
    effects.label({ text: callout.text, x: event.x, y: labelY, color: `rgb(${callout.rgb})` });
  }

  // Every fifth hit of the rally rings out; a Multiball ball's returns do not count toward it.
  if (event.rally % 5 === 0 && !event.extra) {
    effects.ring({ x: width / 2, y: height / 2, color: `rgba(${THEME.amber}, 0.9)`, radius: 30, growth: 620, life: 0.7, width: 5 });
    effects.flash(`rgb(${THEME.amber})`, 0.1);
  }
}

/**
 * Fireworks in the winner's colors, spread over a couple of seconds.
 *
 * @param {Effects} effects
 * @param {Side} winner
 * @param {GameConfig} config
 * @param {() => number} random
 */
function celebrate(effects, winner, config, random) {
  const { width, height } = config;
  const colors = [`rgb(${THEME.side[winner].rgb})`, `rgb(${THEME.amber})`, THEME.spark];

  for (let i = 0; i < 7; i += 1) {
    effects.schedule(0.2 + i * 0.28, () => {
      const x = width * (0.18 + random() * 0.64);
      const y = height * (0.2 + random() * 0.55);
      effects.burst({ x, y, color: colors[i % colors.length], count: 64, speed: 250, life: 1.2, gravity: 260, drag: 1.1, size: 2.4 });
      effects.ring({ x, y, color: colors[i % colors.length], radius: 6, growth: 260, life: 0.5, width: 3 });
    });
  }
}

/**
 * The finisher: the loser's paddle goes to pieces, is launched off the court, is sliced in
 * two or boils away, under a red callout. The paddle itself is not drawn meanwhile.
 *
 * @param {Effects} effects
 * @param {Finisher} finisher
 * @param {GameState} state
 * @param {GameConfig} config
 */
function finish(effects, { kind, loser }, state, config) {
  const { paddle, height, width: courtWidth } = config;
  const top = loser === 'player' ? height - paddle.inset - paddle.height : paddle.inset;
  const x = state[loser].x;
  const y = top + paddle.height / 2;
  const width = paddleWidth(state, loser, config);
  const color = THEME.side[loser].body;
  // Off the court: down for the player's paddle at the bottom, up for the one at the top.
  const outward = loser === 'player' ? 1 : -1;

  effects.hidePaddle(loser);
  effects.flash(`rgb(${THEME.red})`, 0.4);
  effects.shake(1.2);
  effects.label({ text: 'PONGALITY', x: courtWidth / 2, y: height / 2, color: `rgb(${THEME.red})`, life: 1.2, size: 44 });

  switch (kind) {
    case 'shatter':
      effects.shatter({ x, y, width, height: paddle.height, color, count: 12, speed: 320 });
      effects.burst({ x, y, color: THEME.spark, count: 30, speed: 380, life: 0.6, size: 2 });
      break;
    case 'launch':
      effects.shard({ x, y, vx: (state[loser].x < courtWidth / 2 ? 1 : -1) * 90, vy: outward * 900, width, height: paddle.height, color, spin: 9, life: 1.2 });
      effects.burst({ x, y, color, count: 24, speed: 260, direction: outward * Math.PI / 2, spread: 1.2, life: 0.5, size: 2.2 });
      break;
    case 'slice':
      effects.shard({ x: x - width / 4, y, vx: -140, vy: outward * 120, width: width / 2, height: paddle.height, color, spin: -5, life: 1.2, gravity: outward * 700 });
      effects.shard({ x: x + width / 4, y, vx: 140, vy: outward * 120, width: width / 2, height: paddle.height, color, spin: 5, life: 1.2, gravity: outward * 700 });
      effects.ring({ x, y, color: THEME.spark, radius: 4, growth: 900, life: 0.4, width: 4 });
      break;
    case 'vaporize':
    default:
      effects.burst({ x, y, color, count: 90, speed: 140, direction: -Math.PI / 2, spread: 2.6, life: 1, size: 2.6, gravity: -160, drag: 1.2 });
      effects.burst({ x, y, color: THEME.spark, count: 20, speed: 240, life: 0.6, size: 1.6 });
      break;
  }
}
