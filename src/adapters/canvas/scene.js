import { GAME_PHASE } from '../../domain/game.js';
import { paddleWidth } from '../../domain/power-ups.js';
import { FEVER_RALLY, FONT, mixRgb, PICKUP_STYLE, roundedRect, speedIntensity, THEME } from './theme.js';

/**
 * The moving parts of the court: the ball and its trail, the paddles, the power-ups and the
 * Ghost fog. Each function draws one kind of thing onto a context already scaled to board
 * coordinates.
 *
 * @import { GameConfig, GameState, Side } from '../../domain/types.js'
 * @import { GlowSprites } from './court.js'
 */

/**
 * A ghosted side cannot see the ball in its own half: the ball, its trail and the pickups
 * are hidden there behind a fog of the other side's color.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 * @returns {{ from: number, to: number } | null} the hidden band of the court, in board y
 */
export function hiddenBand(state, config) {
  const { height } = config;

  if (state.modifiers.player.ghost > 0) {
    return { from: height / 2, to: height };
  }

  if (state.modifiers.opponent.ghost > 0) {
    return { from: 0, to: height / 2 };
  }

  return null;
}

/**
 * @param {GameState} state
 * @param {GameConfig} config
 * @param {number} y
 */
export function isHidden(state, config, y) {
  const band = hiddenBand(state, config);
  return band !== null && y >= band.from && y <= band.to;
}

/**
 * The ball takes the color of whoever hit it last and heats toward amber as it speeds up;
 * a long rally tips it into a rose "fever" glow, and Turbo turns it amber outright.
 *
 * @param {GameState} state
 * @param {GameConfig} config
 * @returns {string} "r, g, b"
 */
export function ballColor(state, config) {
  const { ball } = state;

  if (state.serveCountdown > 0 || state.phase === GAME_PHASE.READY) {
    return THEME.violet;
  }

  if (state.turbo > 0) {
    return THEME.amber;
  }

  const hitter = ball.vy < 0 ? THEME.side.player.rgb : THEME.side.opponent.rgb;
  const heated = mixRgb(hitter, THEME.amber, speedIntensity(Math.hypot(ball.vx, ball.vy), config) ** 1.4);
  return state.rally >= FEVER_RALLY ? mixRgb(heated, THEME.rose, 0.55) : heated;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameState} state
 * @param {GameConfig} config
 */
export function drawGhostFog(ctx, state, config) {
  const band = hiddenBand(state, config);

  if (!band) {
    return;
  }

  const fog = ctx.createLinearGradient(0, band.from, 0, band.to);
  const color = PICKUP_STYLE.ghost.rgb;

  fog.addColorStop(0, `rgba(${color}, ${band.from === 0 ? 0.35 : 0.05})`);
  fog.addColorStop(1, `rgba(${color}, ${band.from === 0 ? 0.05 : 0.35})`);
  ctx.fillStyle = fog;
  ctx.fillRect(0, band.from, config.width, band.to - band.from);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameState} state
 * @param {GameConfig} config
 * @param {number} now milliseconds, for the bob and pulse
 * @param {GlowSprites} glows
 */
export function drawPickups(ctx, state, config, now, glows) {
  const { radius } = config.powerUps;

  for (const pickup of state.pickups) {
    if (isHidden(state, config, pickup.y)) {
      continue;
    }

    const style = PICKUP_STYLE[pickup.kind];
    const bob = Math.sin(now / 260 + pickup.id) * 4;
    const pulse = 0.85 + 0.15 * Math.sin(now / 140);
    // Fade out over the last second on the court, so the player sees it going.
    const alpha = Math.min(1, pickup.ttl);
    const y = pickup.y + bob;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glows.get(style.rgb), pickup.x - radius * 2.2, y - radius * 2.2, radius * 4.4, radius * 4.4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = `rgba(${style.rgb}, 0.9)`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pickup.x, y, radius * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(${style.rgb}, 0.22)`;
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = `800 ${Math.round(radius * 1.2)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.glyph, pickup.x, y + 1);
    ctx.restore();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReadonlyArray<{ x: number, y: number }>} points oldest first
 * @param {GameState} state
 * @param {GameConfig} config
 */
export function drawTrail(ctx, points, state, config) {
  if (points.length < 2) {
    return;
  }

  const color = ballColor(state, config);
  const radius = config.ball.radius;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgb(${color})`;

  points.forEach((point, index) => {
    if (isHidden(state, config, point.y)) {
      return;
    }

    const t = (index + 1) / points.length;
    ctx.globalAlpha = t * 0.45;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * (0.25 + 0.7 * t), 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameState} state
 * @param {GameConfig} config
 * @param {number} now milliseconds, for the spin marker's rotation
 * @param {GlowSprites} glows
 */
export function drawBall(ctx, state, config, now, glows) {
  const { ball } = state;

  if (isHidden(state, config, ball.y) && state.serveCountdown === 0) {
    return;
  }

  const radius = config.ball.radius;
  const color = ballColor(state, config);
  const fever = state.rally >= FEVER_RALLY || state.turbo > 0 ? 1.3 : 1;
  const glowSize = radius * 10 * fever;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9;
  ctx.drawImage(glows.get(color), ball.x - glowSize / 2, ball.y - glowSize / 2, glowSize, glowSize);
  ctx.restore();

  ctx.fillStyle = THEME.ballCore;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2);
  ctx.fill();

  // A spinning ball shows a rotating arc, so players can see the curve they put on it.
  if (Math.abs(ball.spin) > 0.12) {
    const turn = (now / 1000) * ball.spin * 14;
    ctx.save();
    ctx.strokeStyle = `rgba(224, 242, 254, ${Math.min(0.9, Math.abs(ball.spin))})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, radius + 5, turn, turn + 1.6);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * A paddle with its glow. It squashes on a hit, and glows lime while enlarged or rose while
 * shrunk, so a power-up reads at a glance.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameState} state
 * @param {Side} side
 * @param {GameConfig} config
 * @param {number} squash 1 right after a hit, settling to 0
 * @param {GlowSprites} glows
 */
export function drawPaddle(ctx, state, side, config, squash, glows) {
  const { paddle, height } = config;
  const colors = THEME.side[side];
  const centerX = state[side].x;
  const top = side === 'player' ? height - paddle.inset - paddle.height : paddle.inset;
  const width = paddleWidth(state, side, config) * (1 + 0.16 * squash);
  const thickness = paddle.height * (1 - 0.3 * squash);
  const left = centerX - width / 2;
  const middle = top + paddle.height / 2;
  const { wide, tiny } = state.modifiers[side];
  const glowRgb = wide > 0 ? THEME.lime : tiny > 0 ? THEME.rose : colors.rgb;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5 + 0.5 * squash;
  ctx.drawImage(glows.get(glowRgb), centerX - width * 0.95, middle - paddle.height * 3.4, width * 1.9, paddle.height * 6.8);
  ctx.restore();

  ctx.fillStyle = colors.body;
  roundedRect(ctx, left, middle - thickness / 2, width, thickness, thickness / 2);
  ctx.fill();

  ctx.fillStyle = colors.core;
  roundedRect(ctx, left + 7, middle - 2, width - 14, 4, 2);
  ctx.fill();
}
