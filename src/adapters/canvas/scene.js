import { GAME_PHASE } from '../../domain/game.js';
import { BEAM_HALF_WIDTH, bossAttacks, DRIP_RADIUS, isFinalBoss } from '../../domain/hazards.js';
import { paddleWidth } from '../../domain/power-ups.js';
import { phantomBand, phantomHidden } from '../../domain/supers.js';
import { FEVER_RALLY, FONT, mixRgb, phaseStyle, PICKUP_STYLE, roundedRect, speedIntensity, SUPER_STYLE, THEME } from './theme.js';

/**
 * The moving parts of the court: the ball and its trail, the paddles, the power-ups and the
 * Ghost fog. Each function draws one kind of thing onto a context already scaled to board
 * coordinates.
 *
 * @import { Ball, GameConfig, GameState, Side } from '../../domain/types.js'
 * @import { GlowSprites } from './court.js'
 */

// How far back, in seconds of flight, a Multiball ball's streak reaches, and a fireball's flame.
const STREAK_SECONDS = 0.045;
const FLAME_SECONDS = 0.08;
// Thunder crackles: its arcs take a new shape this often, in milliseconds.
const CRACKLE_MS = 60;

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
 * a long rally tips it into a rose "fever" glow, Turbo turns it amber outright, and a super
 * wears its own color.
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

  if (state.superShot) {
    return SUPER_STYLE[state.superShot.kind].rgb;
  }

  if (state.turbo > 0) {
    return THEME.amber;
  }

  const heated = hitterColor(ball, config);
  return state.rally >= FEVER_RALLY ? mixRgb(heated, THEME.rose, 0.55) : heated;
}

/**
 * The color of whoever hit a ball last, heated toward amber as it speeds up.
 *
 * @param {Ball} ball
 * @param {GameConfig} config
 * @returns {string} "r, g, b"
 */
function hitterColor(ball, config) {
  const hitter = ball.vy < 0 ? THEME.side.player.rgb : THEME.side.opponent.rgb;
  return mixRgb(hitter, THEME.amber, speedIntensity(Math.hypot(ball.vx, ball.vy), config) ** 1.4);
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
  // A phantom leaves no trail where it cannot be seen.
  const phantom = phantomBand(state.superShot, config);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgb(${color})`;

  points.forEach((point, index) => {
    if (isHidden(state, config, point.y) || (phantom && point.y > phantom.from && point.y < phantom.to)) {
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

  // A phantom halfway across is only a faint shimmer, there for those who watch closely.
  if (phantomHidden(state, config)) {
    drawShimmer(ctx, ball, radius, color, now);
    return;
  }

  const kind = state.superShot?.kind;
  const fever = state.rally >= FEVER_RALLY || state.turbo > 0 || kind ? 1.3 : 1;
  const glowSize = radius * 10 * fever;

  if (kind === 'fireball') {
    drawFlame(ctx, ball, radius, color);
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9;
  ctx.drawImage(glows.get(color), ball.x - glowSize / 2, ball.y - glowSize / 2, glowSize, glowSize);
  ctx.restore();

  if (kind === 'thunder') {
    drawCrackle(ctx, ball, radius, now);
  }

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
 * @param {CanvasRenderingContext2D} ctx
 * @param {Ball} ball
 * @param {number} radius
 * @param {string} color "r, g, b"
 * @param {number} now milliseconds
 */
function drawShimmer(ctx, ball, radius, color, now) {
  ctx.save();
  ctx.strokeStyle = `rgba(${color}, ${0.2 + 0.1 * Math.sin(now / 240)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, radius + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * A fireball's flame: a tapering tongue of fire streaming out behind it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Ball} ball
 * @param {number} radius
 * @param {string} color "r, g, b"
 */
function drawFlame(ctx, ball, radius, color) {
  const tailX = ball.x - ball.vx * FLAME_SECONDS;
  const tailY = ball.y - ball.vy * FLAME_SECONDS;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  for (const [width, alpha, rgb] of /** @type {const} */ ([[2.2, 0.35, color], [1.2, 0.55, THEME.amber]])) {
    ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
    ctx.lineWidth = radius * width;
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Thunder's crackle: short jagged arcs around the ball that change shape many times a second.
 * They stay small and pale, so the court never flickers.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Ball} ball
 * @param {number} radius
 * @param {number} now milliseconds
 */
function drawCrackle(ctx, ball, radius, now) {
  const frame = Math.floor(now / CRACKLE_MS);
  // A repeatable scatter from the frame number, so the shape holds for a few frames.
  const jitter = (/** @type {number} */ n) => {
    const value = Math.sin(frame * 91.7 + n * 47.3) * 43758.5453;
    return value - Math.floor(value);
  };

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(191, 219, 254, 0.8)';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';

  for (let arc = 0; arc < 3; arc += 1) {
    const angle = jitter(arc) * Math.PI * 2;
    ctx.beginPath();

    for (let joint = 0; joint < 4; joint += 1) {
      const reach = radius * (1.1 + joint * 0.45);
      const bend = angle + (jitter(arc * 4 + joint + 7) - 0.5) * 0.9;
      const x = ball.x + Math.cos(bend) * reach;
      const y = ball.y + Math.sin(bend) * reach;

      if (joint === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  }

  ctx.restore();
}

/**
 * The balls a Multiball split off: the hitter's glow like the ball, but a pale core, a short
 * streak instead of a trail, and a fade over their last second. A Ghost fog hides them too.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameState} state
 * @param {GameConfig} config
 * @param {GlowSprites} glows
 */
export function drawExtraBalls(ctx, state, config, glows) {
  const radius = config.ball.radius;
  const glowSize = radius * 9;

  for (const extra of state.extraBalls) {
    if (isHidden(state, config, extra.y)) {
      continue;
    }

    const color = hitterColor(extra, config);

    ctx.save();
    ctx.globalAlpha = Math.min(1, extra.ttl);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glows.get(color), extra.x - glowSize / 2, extra.y - glowSize / 2, glowSize, glowSize);
    ctx.strokeStyle = `rgba(${color}, 0.55)`;
    ctx.lineWidth = radius * 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(extra.x, extra.y);
    ctx.lineTo(extra.x - extra.vx * STREAK_SECONDS, extra.y - extra.vy * STREAK_SECONDS);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = THEME.extraBallCore;
    ctx.beginPath();
    ctx.arc(extra.x, extra.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * A boss's attacks. A drip falls with its shadow on the paddle row, darker the nearer it is,
 * so the player sees where it will land. A beam is announced as a faint column over the
 * player's half that fills from the bottom, then burns bright. Lag has nothing on the court.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {GameState} state
 * @param {GameConfig} config
 */
export function drawHazards(ctx, state, config) {
  const { width, height, paddle } = config;
  const warning = config.boss?.warning ?? 1;
  const face = height - paddle.inset - paddle.height;
  const half = height / 2;

  for (const hazard of state.hazards) {
    ctx.save();

    if (hazard.kind === 'drip') {
      const near = Math.min(1, Math.max(0, hazard.y / face));
      const r = DRIP_RADIUS;

      ctx.fillStyle = `rgba(${THEME.drip}, ${0.1 + 0.35 * near})`;
      ctx.beginPath();
      ctx.ellipse(hazard.x, face + paddle.height / 2, r * (0.8 + 0.8 * near), r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // A drop: round below, pointed above.
      ctx.fillStyle = `rgb(${THEME.drip})`;
      ctx.beginPath();
      ctx.moveTo(hazard.x, hazard.y - r * 2.2);
      ctx.lineTo(hazard.x + r * 0.86, hazard.y - r * 0.5);
      ctx.arc(hazard.x, hazard.y, r, -Math.PI / 6, Math.PI + Math.PI / 6);
      ctx.closePath();
      ctx.fill();
    } else if (hazard.kind === 'beam') {
      const left = Math.max(0, hazard.x - BEAM_HALF_WIDTH);
      const beamWidth = Math.min(width, hazard.x + BEAM_HALF_WIDTH) - left;
      const color = THEME.side.opponent.rgb;

      if (hazard.warn > 0) {
        const filled = (height - half) * (1 - hazard.warn / warning);

        ctx.fillStyle = `rgba(${color}, 0.08)`;
        ctx.fillRect(left, half, beamWidth, height - half);
        ctx.fillStyle = `rgba(${color}, 0.2)`;
        ctx.fillRect(left, height - filled, beamWidth, filled);
        ctx.strokeStyle = `rgba(${color}, 0.6)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.strokeRect(left, half, beamWidth, height - half);
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${color}, 0.45)`;
        ctx.fillRect(left, half, beamWidth, height - half);
        ctx.fillStyle = 'rgba(255, 240, 250, 0.85)';
        ctx.fillRect(hazard.x - 6, half, 12, height - half);
      }
    }

    ctx.restore();
  }
}

/**
 * A paddle with its glow. It squashes on a hit, and glows lime while enlarged or rose while
 * shrunk, so a power-up reads at a glance; the final boss's glows in the color of its phase.
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
  const bossRgb = side === 'opponent' && isFinalBoss(config) ? phaseStyle(bossAttacks(state.score, config)).rgb : null;
  const glowRgb = wide > 0 ? THEME.lime : tiny > 0 ? THEME.rose : bossRgb ?? colors.rgb;

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
