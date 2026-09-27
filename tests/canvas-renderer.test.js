import test from 'node:test';
import assert from 'node:assert/strict';

import { THEME } from '../src/adapters/canvas/theme.js';
import { CanvasRenderer } from '../src/adapters/canvas-renderer.js';
import { GAME_CONFIG } from '../src/config.js';
import { createInitialState, GAME_PHASE, startGame } from '../src/domain/game.js';
import { callsNamed, createFrameScheduler, createRendererWindow, FakeCanvas } from './support/fake-canvas.js';

function setup({ clientWidth = 400, devicePixelRatio = 1, reducedMotion = false, jokes = false } = {}) {
  const canvas = new FakeCanvas({ clientWidth });
  const window = createRendererWindow({ devicePixelRatio, reducedMotion });
  const scheduler = createFrameScheduler();
  const renderer = new CanvasRenderer({ canvas, window, scheduler, config: GAME_CONFIG, preferences: { get: () => ({ jokes }) }, random: () => 0.5 });
  return { canvas, window, scheduler, renderer, ctx: () => canvas.contexts[0] };
}

const running = (overrides = {}) => ({
  ...startGame(createInitialState(GAME_CONFIG), GAME_CONFIG),
  serveCountdown: 0,
  ball: { x: 200, y: 300, vx: 0, vy: -440, spin: 0 },
  ...overrides,
});

const clearCalls = (canvas) => {
  canvas.calls.length = 0;
};

test('without Canvas 2D the renderer says so instead of failing later', () => {
  assert.throws(
    () => new CanvasRenderer({ canvas: new FakeCanvas({ contextAvailable: false }), window: createRendererWindow(), scheduler: createFrameScheduler(), config: GAME_CONFIG }),
    /Canvas 2D/,
  );
});

test('the backing store matches the displayed size in device pixels, capped at twice the CSS size', () => {
  const sharp = setup({ clientWidth: 400, devicePixelRatio: 1.5 });
  assert.deepEqual([sharp.canvas.width, sharp.canvas.height], [600, 960]);
  assert.equal(sharp.renderer.scale, 600 / GAME_CONFIG.width);

  const capped = setup({ clientWidth: 400, devicePixelRatio: 3 });
  assert.equal(capped.canvas.width, 800);

  const unlaidOut = setup({ clientWidth: 0 });
  assert.equal(unlaidOut.canvas.width, GAME_CONFIG.width, 'falls back to the board size before layout');
});

test('resizing repaints only when the size really changed, and redraws the last frame', () => {
  const { canvas, renderer, window } = setup();
  renderer.connect();
  renderer.render(running(), GAME_CONFIG);
  clearCalls(canvas);

  window.observers[0].callback();
  assert.equal(canvas.calls.length, 0, 'same size: nothing to do');

  canvas.clientWidth = 320;
  window.observers[0].callback();
  assert.equal(canvas.width, 320);
  assert.ok(callsNamed(canvas.contexts[0], 'drawImage').length > 0, 'the frame is drawn again at the new size');
});

test('a change of pixel ratio, from zoom or another display, resizes and keeps watching', () => {
  const { canvas, renderer, window } = setup({ clientWidth: 400 });
  renderer.connect();

  window.devicePixelRatio = 2;
  const query = window.queries.find((media) => media.query.includes('dppx'));
  query.change(true);

  assert.equal(canvas.width, 800);
  assert.equal(window.queries.filter((media) => media.query.includes('dppx')).length, 2, 'a new query for the new ratio');
});

test('disconnecting stops observing, listening and requesting frames', () => {
  const { renderer, window, scheduler } = setup();
  renderer.connect();
  renderer.handle([{ type: 'game-over', winner: 'player' }]);
  renderer.render({ ...running(), phase: GAME_PHASE.GAME_OVER }, GAME_CONFIG);
  assert.equal(scheduler.pending.size, 1);

  renderer.disconnect();

  assert.equal(window.observers[0].disconnected, true);
  assert.equal(scheduler.pending.size, 0);
  assert.ok(window.queries.every((media) => media.listeners.size === 0));
});

test('turning on reduced motion while playing calms the effects at once', () => {
  const { renderer, window } = setup();
  renderer.connect();

  window.queries.find((media) => media.query.includes('reduced-motion')).change(true);

  assert.equal(renderer.effects.reducedMotion, true);
});

test('a frame draws the court, the ball core at the ball and both paddles', () => {
  const { canvas, renderer } = setup();

  renderer.render(running(), GAME_CONFIG);

  const ctx = canvas.contexts[0];
  assert.equal(callsNamed(ctx, 'fillRect')[0].brush.fillStyle, THEME.background);
  const core = callsNamed(ctx, 'arc').find((call) => call.brush.fillStyle === THEME.ballCore);
  assert.deepEqual(core.args.slice(0, 2), [200, 300]);
  const paddleBodies = callsNamed(ctx, 'fill').filter((call) => [THEME.side.player.body, THEME.side.opponent.body].includes(call.brush.fillStyle));
  assert.equal(paddleBodies.length, 2);
});

test('the ready screen starts clean: no leftover effects or trail', () => {
  const { renderer } = setup();
  renderer.handle([{ type: 'point', scorer: 'player', x: 250, y: 0 }]);
  renderer.trail.points.push({ x: 1, y: 1 });

  renderer.render(createInitialState(GAME_CONFIG), GAME_CONFIG);

  assert.equal(renderer.effects.active, false);
  assert.deepEqual(renderer.trail.points, []);
});

test('a new match clears the old trail', () => {
  const { renderer } = setup();
  renderer.trail.points.push({ x: 1, y: 1 }, { x: 2, y: 2 });

  renderer.handle([{ type: 'match-start' }]);

  assert.deepEqual(renderer.trail.points, []);
});

test('after a match ends, the renderer keeps requesting frames until the fireworks settle', () => {
  const { renderer, scheduler, window } = setup();
  const over = { ...running(), phase: GAME_PHASE.GAME_OVER };

  renderer.render(over, GAME_CONFIG);
  renderer.handle([{ type: 'game-over', winner: 'opponent' }]);
  assert.equal(scheduler.pending.size, 1);

  let frames = 0;
  while (scheduler.pending.size > 0 && frames < 1000) {
    window.advance(16);
    scheduler.flush();
    frames += 1;
  }

  assert.ok(frames > 10 && frames < 1000, `settled after ${frames} frames`);
  assert.equal(renderer.effects.active, false);
});

test('while the match runs or is paused the game loop owns the frames', () => {
  const { renderer, scheduler } = setup();

  renderer.render(running(), GAME_CONFIG);
  renderer.handle([{ type: 'point', scorer: 'player', x: 250, y: 0 }]);
  assert.equal(scheduler.pending.size, 0);

  renderer.render({ ...running(), phase: GAME_PHASE.PAUSED }, GAME_CONFIG);
  assert.equal(scheduler.pending.size, 0);
});

test('a paused frame freezes the effects in place', () => {
  const { renderer, window } = setup();
  renderer.render(running(), GAME_CONFIG);
  renderer.handle([{ type: 'point', scorer: 'player', x: 250, y: 0 }]);
  const before = renderer.effects.particles.map((particle) => particle.life);

  window.advance(100);
  renderer.render({ ...running(), phase: GAME_PHASE.PAUSED }, GAME_CONFIG);

  assert.deepEqual(renderer.effects.particles.map((particle) => particle.life), before);
});

test('a flash covers the whole board in the event\'s color', () => {
  const { canvas, renderer, window } = setup();
  renderer.render(running(), GAME_CONFIG);
  renderer.handle([{ type: 'life-lost', lives: 2 }]);
  clearCalls(canvas);

  window.advance(16);
  renderer.render(running(), GAME_CONFIG);

  const flash = callsNamed(canvas.contexts[0], 'fillRect').at(-1);
  assert.equal(flash.brush.fillStyle, `rgb(${THEME.rose})`);
  assert.ok(flash.brush.globalAlpha > 0 && flash.brush.globalAlpha < 1);
});

test('drawing before any state has arrived does nothing', () => {
  const { canvas, renderer } = setup();
  clearCalls(canvas);

  renderer.draw();

  assert.equal(canvas.calls.length, 0);
});

test('while the finisher plays, the destroyed paddle is not drawn, and the next match brings it back', () => {
  const { renderer, canvas } = setup({ jokes: true });
  const over = { ...running(), phase: GAME_PHASE.GAME_OVER };
  const opponentCoreDrawn = () => canvas.contexts[0].calls.some((call) => call.name === 'fill' && call.brush.fillStyle === THEME.side.opponent.core);

  renderer.render(over, GAME_CONFIG);
  renderer.handle([{ type: 'game-over', winner: 'player' }], over);
  clearCalls(canvas);
  renderer.draw();
  assert.equal(opponentCoreDrawn(), false, 'the computer\'s paddle is in pieces');
  assert.ok(canvas.contexts[0].calls.some((call) => call.name === 'fillRect' && call.brush.fillStyle === THEME.side.opponent.body) || renderer.effects.particles.length > 50);

  renderer.handle([{ type: 'match-start' }], running());
  renderer.render(running(), GAME_CONFIG);
  clearCalls(canvas);
  renderer.draw();
  assert.equal(opponentCoreDrawn(), true);
});

test('under the Lag boss\'s attack the balls show where they were, a few times a second, with no trail', () => {
  const { canvas, renderer, window } = setup();
  const lagging = (x) => running({
    ball: { x, y: 300, vx: 400, vy: -440, spin: 0 },
    modifiers: { player: { wide: 0, tiny: 0, ghost: 0, lag: 2 }, opponent: { wide: 0, tiny: 0, ghost: 0, lag: 0 } },
  });
  const coreX = () => callsNamed(canvas.contexts[0], 'arc').filter((call) => call.brush.fillStyle === THEME.ballCore).at(-1).args[0];

  renderer.render(lagging(100), GAME_CONFIG);
  assert.equal(coreX(), 100);

  window.advance(60);
  renderer.render(lagging(124), GAME_CONFIG);
  assert.equal(coreX(), 100, 'still the old picture');

  window.advance(90);
  renderer.render(lagging(160), GAME_CONFIG);
  assert.equal(coreX(), 160, 'a new picture, jumping ahead');

  clearCalls(canvas);
  window.advance(16);
  renderer.render(lagging(166), GAME_CONFIG);
  assert.equal(callsNamed(canvas.contexts[0], 'arc').filter((call) => call.brush.fillStyle !== THEME.ballCore && call.brush.globalAlpha < 0.5).length, 0, 'no trail gives it away');

  // Once it wears off, the ball is drawn where it is again.
  window.advance(16);
  renderer.render(running({ ball: { x: 170, y: 300, vx: 400, vy: -440, spin: 0 } }), GAME_CONFIG);
  assert.equal(coreX(), 170);
});

test('a boss\'s attacks are drawn on the court', () => {
  const { canvas, renderer } = setup();

  renderer.render(running({ hazards: [{ kind: 'drip', x: 120, y: 300, warn: 0, ttl: 0 }] }), GAME_CONFIG);

  assert.equal(callsNamed(canvas.contexts[0], 'ellipse')[0].args[0], 120, 'the drip\'s shadow');
});
