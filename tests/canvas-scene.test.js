import test from 'node:test';
import assert from 'node:assert/strict';

import { BallTrail } from '../src/adapters/canvas/ball-trail.js';
import { GlowSprites, paintCourt, paintGrid } from '../src/adapters/canvas/court.js';
import { drawLabels, drawRally, drawServeCountdown } from '../src/adapters/canvas/hud.js';
import { ballColor, drawBall, drawGhostFog, drawPaddle, drawPickups, drawTrail, hiddenBand, isHidden } from '../src/adapters/canvas/scene.js';
import { FEVER_RALLY, mixRgb, PICKUP_STYLE, roundedRect, speedIntensity, THEME } from '../src/adapters/canvas/theme.js';
import { GAME_CONFIG } from '../src/config.js';
import { createInitialState, GAME_PHASE, startGame } from '../src/domain/game.js';
import { callsNamed, createRecordingContext, FakeCanvas } from './support/fake-canvas.js';

const { width, height, ball: ballConfig, paddle } = GAME_CONFIG;
const noGhost = { wide: 0, tiny: 0, ghost: 0 };

/** A running match past the countdown, the ball in flight toward the opponent. */
function playing(overrides = {}) {
  return {
    ...startGame(createInitialState(GAME_CONFIG), GAME_CONFIG),
    serveCountdown: 0,
    ball: { x: 200, y: 300, vx: 0, vy: -ballConfig.initialSpeed, spin: 0 },
    ...overrides,
  };
}

const ghosted = (side) => ({ modifiers: { player: noGhost, opponent: noGhost, [side]: { ...noGhost, ghost: 3 } } });
const glows = () => new GlowSprites(() => new FakeCanvas());

test('mixRgb blends two colors and speedIntensity maps serve speed to 0 and top speed to 1', () => {
  assert.equal(mixRgb('0, 0, 0', '200, 100, 50', 0.5), '100, 50, 25');
  assert.equal(speedIntensity(ballConfig.initialSpeed, GAME_CONFIG), 0);
  assert.equal(speedIntensity(ballConfig.maxSpeed, GAME_CONFIG), 1);
  assert.equal(speedIntensity(ballConfig.maxSpeed * 2, GAME_CONFIG), 1);
  assert.equal(speedIntensity(0, GAME_CONFIG), 0);
});

test('roundedRect traces a closed path and never rounds more than half the shorter side', () => {
  const ctx = createRecordingContext();

  roundedRect(ctx, 0, 0, 100, 10, 50);

  assert.deepEqual(ctx.calls.map((call) => call.name), ['beginPath', 'moveTo', 'arcTo', 'arcTo', 'arcTo', 'arcTo', 'closePath']);
  assert.ok(callsNamed(ctx, 'arcTo').every((call) => call.args[4] === 5));
});

test('the court is painted once: tinted halves, a full grid, a glowing center line and border', () => {
  const ctx = createRecordingContext();

  paintCourt(ctx, GAME_CONFIG);

  const fills = callsNamed(ctx, 'fillRect');
  assert.equal(fills[0].brush.fillStyle, THEME.background);
  const gridLines = (width / 25 - 1) + (height / 25 - 1);
  assert.ok(callsNamed(ctx, 'stroke').length >= gridLines + 3, 'grid, center line, circle and border');
  assert.equal(callsNamed(ctx, 'createRadialGradient').length, 1, 'the vignette');
});

test('the grid marks every fourth line as major', () => {
  const ctx = createRecordingContext();

  paintGrid(ctx, GAME_CONFIG, 'minor', 'major');

  const colors = callsNamed(ctx, 'stroke').map((call) => call.brush.strokeStyle);
  // Lines every 25 units inside the court; every 100 units is major: 4 across, 7 down.
  assert.equal(colors.filter((color) => color === 'major').length, (width / 100 - 1) + (height / 100 - 1));
  assert.ok(colors.includes('minor'));
});

test('glow sprites are rendered once per color and then reused', () => {
  const created = [];
  const sprites = new GlowSprites(() => {
    const canvas = new FakeCanvas();
    created.push(canvas);
    return canvas;
  });

  const cyan = sprites.get(THEME.side.player.rgb);
  assert.strictEqual(sprites.get(THEME.side.player.rgb), cyan);
  sprites.get(THEME.amber);

  assert.equal(created.length, 2);
  assert.equal(cyan.width, 128);
  assert.equal(callsNamed(cyan.contexts[0], 'createRadialGradient').length, 1);
});

test('a ghosted side cannot see its own half', () => {
  assert.equal(hiddenBand(playing(), GAME_CONFIG), null);
  assert.deepEqual(hiddenBand(playing(ghosted('player')), GAME_CONFIG), { from: height / 2, to: height });
  assert.deepEqual(hiddenBand(playing(ghosted('opponent')), GAME_CONFIG), { from: 0, to: height / 2 });
  assert.equal(isHidden(playing(ghosted('player')), GAME_CONFIG, height - 10), true);
  assert.equal(isHidden(playing(ghosted('player')), GAME_CONFIG, 10), false);
});

test('the Ghost fog covers only the hidden half', () => {
  const clear = createRecordingContext();
  drawGhostFog(clear, playing(), GAME_CONFIG);
  assert.equal(clear.calls.length, 0);

  const fogged = createRecordingContext();
  drawGhostFog(fogged, playing(ghosted('opponent')), GAME_CONFIG);
  assert.deepEqual(callsNamed(fogged, 'fillRect')[0].args, [0, 0, width, height / 2]);
});

test('the ball wears the hitter\'s color, heats with speed, burns in a long rally, and turns amber under Turbo', () => {
  const waiting = playing({ serveCountdown: 0.5 });
  const fromPlayer = playing();
  const fast = playing({ ball: { x: 0, y: 0, vx: 0, vy: -ballConfig.maxSpeed, spin: 0 } });
  const fromOpponent = playing({ ball: { x: 0, y: 0, vx: 0, vy: ballConfig.initialSpeed, spin: 0 } });

  assert.equal(ballColor(waiting, GAME_CONFIG), THEME.violet);
  assert.equal(ballColor(createInitialState(GAME_CONFIG), GAME_CONFIG), THEME.violet);
  assert.equal(ballColor(fromPlayer, GAME_CONFIG), THEME.side.player.rgb);
  assert.equal(ballColor(fromOpponent, GAME_CONFIG), THEME.side.opponent.rgb);
  assert.equal(ballColor(fast, GAME_CONFIG), THEME.amber);
  assert.notEqual(ballColor(playing({ rally: FEVER_RALLY }), GAME_CONFIG), THEME.side.player.rgb);
  assert.equal(ballColor(playing({ turbo: 2 }), GAME_CONFIG), THEME.amber);
});

test('the ball core is pure white at the ball, with a spin marker only while it curves', () => {
  const still = createRecordingContext();
  drawBall(still, playing(), GAME_CONFIG, 0, glows());
  const core = callsNamed(still, 'arc').find((call) => call.brush.fillStyle === THEME.ballCore);
  assert.deepEqual(core.args.slice(0, 3), [200, 300, ballConfig.radius]);
  assert.equal(callsNamed(still, 'arc').length, 1);

  const curving = createRecordingContext();
  drawBall(curving, playing({ ball: { x: 200, y: 300, vx: 0, vy: -500, spin: 0.8 } }), GAME_CONFIG, 1000, glows());
  assert.equal(callsNamed(curving, 'arc').length, 2);
});

test('a ball in the fog is not drawn, except while it waits to be served', () => {
  const inFog = playing({ ...ghosted('opponent'), ball: { x: 200, y: 100, vx: 0, vy: -400, spin: 0 } });

  const hidden = createRecordingContext();
  drawBall(hidden, inFog, GAME_CONFIG, 0, glows());
  assert.equal(hidden.calls.length, 0);

  const serving = createRecordingContext();
  drawBall(serving, { ...inFog, serveCountdown: 0.4 }, GAME_CONFIG, 0, glows());
  assert.ok(serving.calls.length > 0);
});

test('paddles are drawn at their width, which power-ups change, and glow in the effect\'s color', () => {
  const drawn = (state, side) => {
    const ctx = createRecordingContext();
    drawPaddle(ctx, state, side, GAME_CONFIG, 0, glows());
    const body = callsNamed(ctx, 'arcTo');
    const xs = body.flatMap((call) => [call.args[0], call.args[2]]);
    return { width: Math.max(...xs) - Math.min(...xs), ctx };
  };

  assert.equal(drawn(playing(), 'player').width, paddle.width);
  const wide = playing({ modifiers: { player: { ...noGhost, wide: 4 }, opponent: noGhost } });
  assert.equal(drawn(wide, 'player').width, paddle.width * GAME_CONFIG.powerUps.wideScale);
  const tiny = playing({ modifiers: { player: noGhost, opponent: { ...noGhost, tiny: 4 } } });
  assert.equal(drawn(tiny, 'opponent').width, paddle.width * GAME_CONFIG.powerUps.shrinkScale);
});

test('a widened paddle glows lime and a shrunk one rose, like their power-ups', () => {
  const glowOf = (state, side) => {
    const asked = [];
    drawPaddle(createRecordingContext(), state, side, GAME_CONFIG, 0, { get: (rgb) => asked.push(rgb) && new FakeCanvas() });
    return asked[0];
  };

  assert.equal(glowOf(playing({ modifiers: { player: { ...noGhost, wide: 4 }, opponent: noGhost } }), 'player'), THEME.lime);
  assert.equal(glowOf(playing({ modifiers: { player: noGhost, opponent: { ...noGhost, tiny: 4 } } }), 'opponent'), THEME.rose);
});

test('a squashed paddle is wider and thinner for a moment after a hit', () => {
  const ctx = createRecordingContext();
  drawPaddle(ctx, playing(), 'player', GAME_CONFIG, 1, glows());
  const xs = callsNamed(ctx, 'arcTo').slice(0, 4).flatMap((call) => [call.args[0], call.args[2]]);

  assert.ok(Math.max(...xs) - Math.min(...xs) > paddle.width);
});

test('power-ups bob in place, fade as they expire, and hide in the fog', () => {
  const pickups = [
    { id: 1, kind: 'turbo', x: 100, y: 300, ttl: 5 },
    { id: 2, kind: 'ghost', x: 300, y: 600, ttl: 0.5 },
  ];
  const ctx = createRecordingContext();
  drawPickups(ctx, playing({ pickups }), GAME_CONFIG, 0, glows());

  const glyphs = callsNamed(ctx, 'fillText');
  assert.deepEqual(glyphs.map((call) => call.args[0]), [PICKUP_STYLE.turbo.glyph, PICKUP_STYLE.ghost.glyph]);
  assert.equal(glyphs[1].brush.globalAlpha, 0.5, 'fading out over its last second');

  const fogged = createRecordingContext();
  drawPickups(fogged, playing({ pickups, ...ghosted('player') }), GAME_CONFIG, 0, glows());
  assert.deepEqual(callsNamed(fogged, 'fillText').map((call) => call.args[0]), [PICKUP_STYLE.turbo.glyph]);
});

test('the trail fades in from its oldest point and skips points in the fog', () => {
  const points = [{ x: 10, y: 100 }, { x: 20, y: 500 }, { x: 30, y: 110 }];
  const ctx = createRecordingContext();
  drawTrail(ctx, points, playing(), GAME_CONFIG);
  const dots = callsNamed(ctx, 'fill');
  assert.equal(dots.length, 3);
  assert.ok(dots[0].brush.globalAlpha < dots[2].brush.globalAlpha);

  const fogged = createRecordingContext();
  drawTrail(fogged, points, playing(ghosted('player')), GAME_CONFIG);
  assert.equal(callsNamed(fogged, 'fill').length, 2);

  const tooShort = createRecordingContext();
  drawTrail(tooShort, points.slice(0, 1), playing(), GAME_CONFIG);
  assert.equal(tooShort.calls.length, 0);
});

test('the serve countdown shows its number only before the first serve of a match', () => {
  const first = createRecordingContext();
  drawServeCountdown(first, playing({ serveNumber: 0, serveCountdown: 2.4 }), GAME_CONFIG);
  assert.deepEqual(callsNamed(first, 'fillText').map((call) => call.args[0]), ['3']);

  const later = createRecordingContext();
  drawServeCountdown(later, playing({ serveNumber: 3, serveCountdown: 0.5 }), GAME_CONFIG);
  assert.equal(callsNamed(later, 'fillText').length, 0);
  assert.equal(callsNamed(later, 'arc').length, 2, 'the closing ring and the filling arc');

  const none = createRecordingContext();
  drawServeCountdown(none, playing(), GAME_CONFIG);
  drawServeCountdown(none, createInitialState(GAME_CONFIG), GAME_CONFIG);
  assert.equal(none.calls.length, 0);
});

test('the rally counter appears from the second hit and turns amber in a fever rally', () => {
  const short = createRecordingContext();
  drawRally(short, playing({ rally: 1 }), GAME_CONFIG, 0);
  assert.equal(short.calls.length, 0);

  const counting = createRecordingContext();
  drawRally(counting, playing({ rally: 4 }), GAME_CONFIG, 1);
  assert.deepEqual(callsNamed(counting, 'fillText').map((call) => call.args[0]), ['4', 'RALLY']);

  const fever = createRecordingContext();
  drawRally(fever, playing({ rally: FEVER_RALLY }), GAME_CONFIG, 0);
  assert.ok(callsNamed(fever, 'fillText')[0].brush.fillStyle.includes(THEME.amber));
});

test('callouts are outlined for contrast and fade out at the end of their life', () => {
  const ctx = createRecordingContext();
  drawLabels(ctx, [
    { text: 'CURVE!', x: 100, y: 100, color: '#fff', life: 0.9, maxLife: 0.9, size: 30 },
    { text: 'EDGE!', x: 100, y: 100, color: '#fff', life: 0.15, maxLife: 0.9, size: 30 },
  ]);

  assert.deepEqual(callsNamed(ctx, 'strokeText').map((call) => call.args[0]), ['CURVE!', 'EDGE!']);
  const [fresh, fading] = callsNamed(ctx, 'fillText');
  assert.equal(fresh.brush.globalAlpha, 1);
  assert.equal(fading.brush.globalAlpha, 0.5);
});

test('the trail follows the ball in play and starts over with each serve', () => {
  const trail = new BallTrail();
  let state = playing({ serveNumber: 1 });

  for (let i = 0; i < 30; i += 1) {
    state = { ...state, ball: { ...state.ball, y: 300 - i * 5 } };
    trail.update(state);
  }
  assert.equal(trail.points.length, 18, 'a fixed length');

  trail.update({ ...state, rally: FEVER_RALLY, ball: { ...state.ball, y: 150 } });
  for (let i = 0; i < 20; i += 1) trail.update({ ...state, turbo: 1, ball: { ...state.ball, y: 150 - i } });
  assert.equal(trail.points.length, 26, 'longer in a fever rally or under Turbo');

  trail.update({ ...state, serveNumber: 2 });
  assert.equal(trail.points.length, 1, 'a new serve starts a new trail');

  trail.update({ ...state, serveNumber: 2, ball: { ...state.ball, x: 480, y: 700 } });
  assert.equal(trail.points.length, 1, 'a jump across the court is a reset, not motion');

  trail.update({ ...state, serveNumber: 2, serveCountdown: 0.5 });
  trail.update({ ...state, serveNumber: 2, phase: GAME_PHASE.PAUSED });
  assert.equal(trail.points.length, 0, 'nothing while the ball waits or the game is paused');

  trail.clear();
  assert.deepEqual(trail.points, []);
});
