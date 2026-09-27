import { matchPointSide } from '../../domain/game.js';
import { paddleWidth } from '../../domain/power-ups.js';
import { CURVE_SPIN, EDGE_OFFSET, isLoaded } from '../../domain/supers.js';
import { COMIC_TITLES, finisherAt, FINISHER_SECONDS } from '../finisher.js';
import { meterBox } from './hud.js';
import { PICKUP_STYLE, speedIntensity, SUPER_STYLE, THEME } from './theme.js';

/**
 * @import { GameConfig, GameEvent, GameState, Side } from '../../domain/types.js'
 * @import { Effects } from '../effects.js'
 * @import { Finisher, FinisherKind } from '../finisher.js'
 *
 * @typedef {object} EventContext
 * @property {GameConfig} config the match being played
 * @property {() => number} random places the victory fireworks
 * @property {boolean} [jokes] the fun extras preference, which the finisher needs
 * @property {GameState} [state] the state the events came with, for where the paddles are
 */

// A hit this far from the paddle's center, or with this much curve, earns a callout; these are
// the returns that charge a super meter more. A fast enough one is a smash.
export { CURVE_SPIN, EDGE_OFFSET };
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
      case 'super-ready':
        chargeUp(effects, event, config, state);
        break;
      case 'super-swerve':
        effects.burst({ x: event.x, y: event.y, color: `rgb(${SUPER_STYLE.zigzag.rgb})`, count: 14, speed: 260, life: 0.35, size: 1.8 });
        effects.ring({ x: event.x, y: event.y, color: `rgba(${SUPER_STYLE.zigzag.rgb}, 0.8)`, radius: 6, growth: 220, life: 0.3, width: 2 });
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
        // One point from winning with a super in hand: time to finish it.
        if (state && isLoaded(state.meters[event.side])) {
          finishIt(effects, event.side, config);
        } else {
          effects.label({ text: 'MATCH POINT', x: width / 2, y: height / 2, color: `rgb(${THEME.amber})`, life: 1.4, size: 34 });
        }
        effects.ring({ x: width / 2, y: height / 2, color: `rgba(${THEME.amber}, 0.9)`, radius: 30, growth: 700, life: 0.8, width: 6 });
        break;
      case 'life-lost':
        effects.flash(`rgb(${THEME.rose})`, 0.3);
        effects.shake(1.1);
        break;
      case 'hazard-warn':
        announceHazard(effects, event, config);
        break;
      case 'hazard-hit':
        landHazard(effects, event, config);
        break;
      case 'game-over': {
        const finisher = state ? finisherAt(event, state, config, jokes) : null;

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
 * The callout a hit earns, if any: a super it fires names itself, and one it answers is SAVED!;
 * otherwise a curve beats a smash, which beats a catch at the edge.
 *
 * @param {Extract<GameEvent, { type: 'paddle-hit' }>} event
 * @param {GameConfig} config
 * @returns {{ text: string, rgb: string } | null}
 */
export function calloutFor(event, config) {
  if (event.super) {
    return { text: `${SUPER_STYLE[event.super].label}!`, rgb: SUPER_STYLE[event.super].rgb };
  }

  if (event.saved) {
    return { text: 'SAVED!', rgb: THEME.side[event.side].rgb };
  }

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
    // A super's name is bigger, and centered so it always reads in full.
    effects.label({ text: callout.text, x: event.super ? width / 2 : event.x, y: labelY, color: `rgb(${callout.rgb})`, size: event.super ? 38 : 30 });
  }

  if (event.super) {
    // A super goes off: a blast in its color from the paddle that fired it.
    const color = `rgb(${SUPER_STYLE[event.super].rgb})`;
    effects.burst({ x: event.x, y: event.y, color, count: 46, speed: 460, direction: outward, spread: 2.6, life: 0.6, size: 2.6 });
    effects.ring({ x: event.x, y: event.y, color, radius: 10, growth: 760, life: 0.5, width: 5 });
    effects.flash(color, 0.14);
    effects.shake(0.45);
    effects.pulse(0.9);
  }

  // Every fifth hit of the rally rings out; a Multiball ball's returns do not count toward it.
  if (event.rally % 5 === 0 && !event.extra) {
    effects.ring({ x: width / 2, y: height / 2, color: `rgba(${THEME.amber}, 0.9)`, radius: 30, growth: 620, life: 0.7, width: 5 });
    effects.flash(`rgb(${THEME.amber})`, 0.1);
  }
}

/**
 * A meter just filled: it rings out in the color of the super it now holds, and at match
 * point the side is told to finish it.
 *
 * @param {Effects} effects
 * @param {Extract<GameEvent, { type: 'super-ready' }>} event
 * @param {GameConfig} config
 * @param {GameState} [state]
 */
function chargeUp(effects, { side, kind }, config, state) {
  const box = meterBox(side, config);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const color = `rgb(${SUPER_STYLE[kind].rgb})`;

  effects.ring({ x, y, color, radius: 8, growth: 320, life: 0.5, width: 3 });
  effects.burst({ x, y, color, count: 18, speed: 200, life: 0.45, size: 1.8 });

  if (state && matchPointSide(state, config) === side) {
    finishIt(effects, side, config);
  }
}

/**
 * FINISH IT!: a side one point from winning holds a super.
 *
 * @param {Effects} effects
 * @param {Side} side
 * @param {GameConfig} config
 */
function finishIt(effects, side, config) {
  effects.label({ text: 'FINISH IT!', x: config.width / 2, y: config.height / 2, color: `rgb(${THEME.side[side].rgb})`, life: 1.2, size: 38 });
}

/**
 * A boss's attack announced: drips break loose under the boss's paddle, a beam's column
 * appears on the court, and PING 999 flashes up before lag.
 *
 * @param {Effects} effects
 * @param {Extract<GameEvent, { type: 'hazard-warn' }>} event
 * @param {GameConfig} config
 */
function announceHazard(effects, { kind, x }, config) {
  const { width, height, paddle } = config;

  if (kind === 'drip') {
    effects.ring({ x, y: paddle.inset + paddle.height + 14, color: `rgba(${THEME.drip}, 0.9)`, radius: 4, growth: 160, life: 0.4, width: 2 });
  } else if (kind === 'lag') {
    effects.label({ text: 'PING 999', x: width / 2, y: height * 0.4, color: `rgb(${THEME.violet})`, life: 1.1, size: 34 });
  } else {
    effects.pulse(0.4);
  }
}

/**
 * A boss's attack landing on the player: a splash or a zap and a SHRUNK! callout at the
 * paddle, or LAG! over the court.
 *
 * @param {Effects} effects
 * @param {Extract<GameEvent, { type: 'hazard-hit' }>} event
 * @param {GameConfig} config
 */
function landHazard(effects, { kind, x, y }, config) {
  if (kind === 'lag') {
    effects.label({ text: 'LAG!', x: config.width / 2, y: config.height * 0.4, color: `rgb(${THEME.violet})`, size: 40 });
    effects.flash(`rgb(${THEME.violet})`, 0.12);
    return;
  }

  const color = kind === 'drip' ? `rgb(${THEME.drip})` : `rgb(${THEME.side.opponent.rgb})`;

  effects.burst({ x, y, color, count: 26, speed: 260, direction: -Math.PI / 2, spread: 2.2, life: 0.5, size: 2 });
  effects.kick('player');
  effects.shake(kind === 'beam' ? 0.45 : 0.25);
  effects.label({ text: 'SHRUNK!', x, y: y - 36, color, size: 22 });

  if (kind === 'beam') {
    effects.flash(color, 0.14);
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
 * @typedef {object} Target the loser's paddle, as a finisher sees it
 * @property {Side} side
 * @property {number} x center
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {string} color
 * @property {1 | -1} outward off the court: down for the paddle at the bottom, up for the one at the top
 * @property {GameConfig} config
 */

// Ice for the freeze, and the frost it throws off.
const ICE = '#bae6fd';
const FROST = '#e0f2fe';
// Ash from an incinerated paddle, and the light of an electrocuted one.
const ASH = '#57534e';
const CHARGED = '#bfdbfe';

/**
 * The finisher, under its callout: PONGALITY in red, with SUPER above it in the color of the
 * super that won the match, or a comic finisher's own title in amber; a win to nil adds
 * PERFECT! below. The loser's paddle is not drawn meanwhile, only what becomes of it.
 *
 * @param {Effects} effects
 * @param {Finisher} finisher
 * @param {GameState} state
 * @param {GameConfig} config
 */
export function finish(effects, finisher, state, config) {
  const { paddle, height, width } = config;
  const { loser } = finisher;
  const top = loser === 'player' ? height - paddle.inset - paddle.height : paddle.inset;
  const comic = finisher.kind in COMIC_TITLES;
  /** @type {Target} */
  const target = {
    side: loser,
    x: state[loser].x,
    y: top + paddle.height / 2,
    width: paddleWidth(state, loser, config),
    height: paddle.height,
    color: THEME.side[loser].body,
    outward: loser === 'player' ? 1 : -1,
    config,
  };

  effects.label({ text: finisher.title, x: width / 2, y: height / 2, color: `rgb(${comic ? THEME.amber : THEME.red})`, life: FINISHER_SECONDS, size: 44 });

  if (finisher.super) {
    effects.label({ text: 'SUPER', x: width / 2, y: height / 2 - 42, color: `rgb(${SUPER_STYLE[finisher.super].rgb})`, life: FINISHER_SECONDS, size: 24, stack: true });
  }

  if (finisher.perfect) {
    effects.schedule(0.3, () => {
      effects.label({ text: 'PERFECT!', x: width / 2, y: height / 2 + 48, color: `rgb(${THEME.amber})`, life: FINISHER_SECONDS - 0.3, size: 30, stack: true });
    });
  }

  FINISHES[finisher.kind](effects, target);
}

/**
 * The paddle goes at once: it is hidden, and the board flashes and shakes.
 *
 * @param {Effects} effects
 * @param {Target} target
 * @param {string} [rgb]
 */
function strike(effects, target, rgb = THEME.red) {
  effects.hidePaddle(target.side);
  effects.flash(`rgb(${rgb})`, 0.4);
  effects.shake(1.2);
}

/**
 * A comic finisher's aside, by the paddle, kept on the court.
 *
 * @param {Effects} effects
 * @param {Target} target
 * @param {string} text
 * @param {string} rgb
 * @param {number} life
 */
function aside(effects, target, text, rgb, life) {
  const x = Math.min(Math.max(target.x, 60), target.config.width - 60);
  effects.label({ text, x, y: target.y - target.outward * 42, color: `rgb(${rgb})`, life, size: 24, stack: true });
}

/**
 * How each finisher destroys the paddle.
 *
 * @type {Readonly<Record<FinisherKind, (effects: Effects, target: Target) => void>>}
 */
const FINISHES = Object.freeze({
  shatter(effects, t) {
    strike(effects, t);
    effects.shatter({ x: t.x, y: t.y, width: t.width, height: t.height, color: t.color, count: 12, speed: 320 });
    effects.burst({ x: t.x, y: t.y, color: THEME.spark, count: 30, speed: 380, life: 0.6, size: 2 });
  },
  launch(effects, t) {
    strike(effects, t);
    effects.shard({ x: t.x, y: t.y, vx: (t.x < t.config.width / 2 ? 1 : -1) * 90, vy: t.outward * 900, width: t.width, height: t.height, color: t.color, spin: 9, life: 1.2 });
    effects.burst({ x: t.x, y: t.y, color: t.color, count: 24, speed: 260, direction: t.outward * Math.PI / 2, spread: 1.2, life: 0.5, size: 2.2 });
  },
  slice(effects, t) {
    strike(effects, t);
    effects.shard({ x: t.x - t.width / 4, y: t.y, vx: -140, vy: t.outward * 120, width: t.width / 2, height: t.height, color: t.color, spin: -5, life: 1.2, gravity: t.outward * 700 });
    effects.shard({ x: t.x + t.width / 4, y: t.y, vx: 140, vy: t.outward * 120, width: t.width / 2, height: t.height, color: t.color, spin: 5, life: 1.2, gravity: t.outward * 700 });
    effects.ring({ x: t.x, y: t.y, color: THEME.spark, radius: 4, growth: 900, life: 0.4, width: 4 });
  },
  vaporize(effects, t) {
    strike(effects, t);
    effects.burst({ x: t.x, y: t.y, color: t.color, count: 90, speed: 140, direction: -Math.PI / 2, spread: 2.6, life: 1, size: 2.6, gravity: -160, drag: 1.2 });
    effects.burst({ x: t.x, y: t.y, color: THEME.spark, count: 20, speed: 240, life: 0.6, size: 1.6 });
  },
  meteor(effects, t) {
    // A rock streaks down from high over the court behind a tail of fire, and lands on the paddle.
    const fall = 0.3;
    const from = { x: t.x + (t.x < t.config.width / 2 ? 150 : -150), y: t.side === 'player' ? t.config.height * 0.3 : -80 };
    const velocity = { x: (t.x - from.x) / fall, y: (t.y - from.y) / fall };
    const fire = `rgb(${SUPER_STYLE.fireball.rgb})`;

    effects.shard({ x: from.x, y: from.y, vx: velocity.x, vy: velocity.y, width: 20, height: 20, color: '#9a3412', spin: 6, life: fall });

    for (let tick = 0; tick < 6; tick += 1) {
      const at = tick * (fall / 6);
      effects.schedule(at, () => {
        effects.burst({ x: from.x + velocity.x * at, y: from.y + velocity.y * at, color: fire, count: 8, speed: 70, life: 0.35, size: 2.4 });
      });
    }

    effects.schedule(fall, () => {
      strike(effects, t, SUPER_STYLE.fireball.rgb);
      effects.shatter({ x: t.x, y: t.y, width: t.width, height: t.height, color: t.color, count: 12, speed: 360 });
      effects.burst({ x: t.x, y: t.y, color: fire, count: 50, speed: 420, life: 0.6, size: 2.4 });
      effects.ring({ x: t.x, y: t.y, color: fire, radius: 10, growth: 800, life: 0.45, width: 6 });
    });
  },
  blackhole(effects, t) {
    // A void opens at the paddle and draws it in, piece by piece, then snaps shut.
    const violet = `rgb(${THEME.violet})`;

    effects.hidePaddle(t.side);
    effects.shake(0.6);
    effects.ring({ x: t.x, y: t.y, color: `rgba(${THEME.violet}, 0.9)`, radius: 80, growth: -150, life: 0.5, width: 4 });
    effects.implode({ x: t.x, y: t.y, color: t.color, count: 50, radius: 90, life: 0.5 });
    effects.implode({ x: t.x, y: t.y, color: violet, count: 30, radius: 120, life: 0.55 });

    for (let piece = 0; piece < 6; piece += 1) {
      const x = t.x - t.width / 2 + (t.width * (piece + 0.5)) / 6;
      effects.shard({ x, y: t.y, vx: (t.x - x) / 0.4, vy: 0, width: t.width / 6, height: t.height, color: t.color, spin: piece % 2 ? 10 : -10, life: 0.4, shrink: 0.9 });
    }

    effects.schedule(0.5, () => {
      effects.flash(violet, 0.3);
      effects.burst({ x: t.x, y: t.y, color: violet, count: 26, speed: 260, life: 0.5, size: 2 });
      effects.ring({ x: t.x, y: t.y, color: violet, radius: 4, growth: 420, life: 0.35, width: 3 });
    });
  },
  freeze(effects, t) {
    // The paddle freezes solid in a block of ice, which shatters a moment later.
    effects.hidePaddle(t.side);
    effects.flash(`rgb(${THEME.drip})`, 0.25);
    effects.shard({ x: t.x, y: t.y, vx: 0, vy: 0, width: t.width + 6, height: t.height + 6, color: ICE, life: 0.45 });
    effects.burst({ x: t.x, y: t.y, color: FROST, count: 26, speed: 90, life: 0.5, size: 1.6 });

    effects.schedule(0.45, () => {
      effects.shake(1);
      effects.shatter({ x: t.x, y: t.y, width: t.width + 6, height: t.height + 6, color: ICE, count: 14, speed: 300 });
      effects.burst({ x: t.x, y: t.y, color: FROST, count: 30, speed: 340, life: 0.5, size: 1.8 });
      effects.ring({ x: t.x, y: t.y, color: `rgba(${THEME.drip}, 0.9)`, radius: 6, growth: 500, life: 0.4, width: 3 });
    });
  },
  incinerate(effects, t) {
    // A fireball's finisher: the paddle goes up in flames, and its ash drifts away.
    strike(effects, t, SUPER_STYLE.fireball.rgb);

    for (const [rgb, count] of /** @type {const} */ ([[SUPER_STYLE.fireball.rgb, 60], [THEME.amber, 40], [THEME.red, 20]])) {
      effects.burst({ x: t.x, y: t.y, color: `rgb(${rgb})`, count, speed: 160, direction: -Math.PI / 2, spread: 1.8, life: 0.9, size: 2.6, gravity: -380, drag: 1.4 });
    }

    for (let flake = 0; flake < 8; flake += 1) {
      effects.shard({
        x: t.x - t.width / 2 + (t.width * (flake + 0.5)) / 8,
        y: t.y,
        vx: (flake - 3.5) * 22,
        vy: -60 - 20 * (flake % 3),
        width: 6,
        height: 6,
        color: ASH,
        spin: flake % 2 ? 4 : -4,
        life: 1.1,
        gravity: 160,
      });
    }
  },
  shred(effects, t) {
    // A zigzag's finisher: one zigzag cut, and the paddle falls apart in strips.
    const yellow = `rgb(${SUPER_STYLE.zigzag.rgb})`;

    strike(effects, t, SUPER_STYLE.zigzag.rgb);
    effects.bolt({ x1: t.x - t.width / 2 - 10, y1: t.y, x2: t.x + t.width / 2 + 10, y2: t.y, color: yellow, segments: 8, jag: 14, life: 0.35, width: 3 });
    effects.shatter({ x: t.x, y: t.y, width: t.width, height: t.height, color: t.color, count: 16, speed: 280 });
    effects.burst({ x: t.x, y: t.y, color: yellow, count: 30, speed: 300, life: 0.45, size: 1.8 });
  },
  derez(effects, t) {
    // A phantom's finisher: the paddle breaks up into pixels that drift off and blink out.
    const pixel = 6;
    const columns = Math.max(4, Math.round(t.width / pixel));
    const rows = Math.max(1, Math.round(t.height / pixel));

    effects.hidePaddle(t.side);
    effects.flash(`rgb(${SUPER_STYLE.phantom.rgb})`, 0.25);
    effects.ring({ x: t.x, y: t.y, color: `rgba(${SUPER_STYLE.phantom.rgb}, 0.8)`, radius: 8, growth: 300, life: 0.5, width: 2 });

    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        // A fixed scatter, so every pixel drifts and blinks out in its own time.
        const n = column * 7 + row * 13;
        effects.shard({
          x: t.x - t.width / 2 + ((column + 0.5) * t.width) / columns,
          y: t.y - t.height / 2 + ((row + 0.5) * t.height) / rows,
          vx: ((n * 53) % 60) - 30,
          vy: -(30 + ((n * 29) % 70)),
          width: pixel,
          height: pixel,
          color: (column + row) % 3 === 0 ? `rgb(${SUPER_STYLE.phantom.rgb})` : t.color,
          life: 0.35 + (((n * 37) % 100) / 100) * 0.8,
        });
      }
    }
  },
  electrocute(effects, t) {
    // Thunder's finisher: lightning from the middle of the court lights the paddle up, and it bursts.
    const blue = `rgb(${SUPER_STYLE.thunder.rgb})`;

    effects.hidePaddle(t.side);
    effects.flash(blue, 0.3);
    effects.shake(0.8);
    effects.shard({ x: t.x, y: t.y, vx: 0, vy: 0, width: t.width, height: t.height, color: CHARGED, life: 0.3 });

    [-40, 0, 40].forEach((offset, index) => {
      effects.schedule(index * 0.08, () => {
        effects.bolt({ x1: t.x + offset * 1.6, y1: t.config.height / 2, x2: t.x + offset * 0.4, y2: t.y, color: CHARGED, segments: 9, jag: 22, life: 0.28, width: 3 });
      });
    });

    effects.schedule(0.3, () => {
      effects.shake(1);
      effects.shatter({ x: t.x, y: t.y, width: t.width, height: t.height, color: t.color, count: 10, speed: 300 });
      effects.burst({ x: t.x, y: t.y, color: blue, count: 36, speed: 360, life: 0.5, size: 2 });
      effects.ring({ x: t.x, y: t.y, color: blue, radius: 6, growth: 600, life: 0.4, width: 4 });
    });
  },
  tiny(effects, t) {
    // TINYALITY: the paddle shrinks away to nothing, in tears.
    effects.hidePaddle(t.side);
    effects.shard({ x: t.x, y: t.y, vx: 0, vy: 0, width: t.width, height: t.height, color: t.color, life: 1.1, shrink: 0.94 });

    effects.schedule(0.35, () => {
      aside(effects, t, 'WAAAH!', THEME.drip, 0.8);

      for (const side of [-1, 1]) {
        effects.burst({ x: t.x + side * 6, y: t.y, color: `rgb(${THEME.drip})`, count: 6, speed: 60, direction: -Math.PI / 2, spread: 1, life: 0.6, size: 2.4, gravity: 500 });
      }
    });
  },
  snooze(effects, t) {
    // SNOOZALITY: the paddle nods off and tips over the edge of the court.
    effects.hidePaddle(t.side);
    effects.shard({ x: t.x, y: t.y, vx: 0, vy: t.outward * 20, width: t.width, height: t.height, color: t.color, spin: 0.9, life: 1.2, gravity: t.outward * 90 });
    aside(effects, t, 'Zzz', THEME.violet, 1.1);
  },
});
