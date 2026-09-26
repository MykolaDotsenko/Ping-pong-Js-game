import { GAME_PHASE } from '../../domain/game.js';
import { FEVER_RALLY, FONT, THEME } from './theme.js';

/**
 * What the canvas shows on top of the play: the serve countdown, the rally counter and the
 * callouts. Each function draws onto a context already scaled to board coordinates.
 *
 * @import { GameConfig, GameState } from '../../domain/types.js'
 * @import { Label } from '../effects.js'
 */

/**
 * Before a serve: a closing ring and a filling arc around the waiting ball, and on the
 * first serve of a match the countdown number itself.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameState} state
 * @param {GameConfig} config
 */
export function drawServeCountdown(ctx, state, config) {
  if (state.serveCountdown <= 0 || state.phase === GAME_PHASE.READY) {
    return;
  }

  const { ball } = state;
  const radius = config.ball.radius;
  const total = state.serveNumber === 0 ? config.startDelaySeconds : config.serveDelaySeconds;
  const remaining = state.serveCountdown / total;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(${THEME.violet}, 0.75)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, radius + 4 + 26 * remaining, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${THEME.side.player.rgb}, 0.9)`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, radius + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - remaining));
  ctx.stroke();

  if (state.serveNumber === 0) {
    const value = Math.ceil(state.serveCountdown);
    // Each number swells as it lands and shrinks away before the next.
    const within = 1 - (state.serveCountdown - (value - 1));
    const scale = 1.4 - 0.4 * within;

    ctx.translate(ball.x, ball.y - 70);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(248, 250, 252, ${0.95 - within * 0.5})`;
    ctx.font = `900 64px ${FONT}`;
    ctx.fillText(String(value), 0, 0);
  }

  ctx.restore();
}

/**
 * The current rally count, pulsing on every hit and turning amber in a long exchange.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameState} state
 * @param {GameConfig} config
 * @param {number} pop 1 right after a hit, settling to 0
 */
export function drawRally(ctx, state, config, pop) {
  if (state.rally < 2) {
    return;
  }

  const { width, height } = config;
  const color = state.rally >= FEVER_RALLY ? THEME.amber : THEME.text;

  ctx.save();
  ctx.translate(width - 26, height / 2 + 34);
  ctx.scale(1 + pop * 0.3, 1 + pop * 0.3);
  ctx.textAlign = 'right';
  ctx.fillStyle = `rgba(${color}, ${0.3 + pop * 0.5})`;
  ctx.font = `800 44px ${FONT}`;
  ctx.fillText(String(state.rally), 0, 0);
  ctx.font = `700 11px ${FONT}`;
  ctx.fillStyle = `rgba(${color}, ${0.35 + pop * 0.4})`;
  ctx.fillText('RALLY', 0, 16);
  ctx.restore();
}

/**
 * Callouts rise and fade; each swells in over its first tenth.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {readonly Label[]} labels
 */
export function drawLabels(ctx, labels) {
  for (const label of labels) {
    const age = 1 - label.life / label.maxLife;
    const swell = Math.min(1, age / 0.1);
    const scale = 0.6 + 0.4 * swell + age * 0.15;

    ctx.save();
    ctx.translate(label.x, label.y - age * 36);
    ctx.scale(scale, scale);
    ctx.globalAlpha = Math.min(1, label.life / 0.3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${label.size}px ${FONT}`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(5, 6, 15, 0.85)';
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = label.color;
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
  }
}
