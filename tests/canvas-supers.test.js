import test from 'node:test';
import assert from 'node:assert/strict';

import { GlowSprites } from '../src/adapters/canvas/court.js';
import { calloutFor, playEvents } from '../src/adapters/canvas/event-effects.js';
import { drawMeters, meterBox } from '../src/adapters/canvas/hud.js';
import { ballColor, drawBall, drawTrail } from '../src/adapters/canvas/scene.js';
import { SUPER_STYLE, THEME } from '../src/adapters/canvas/theme.js';
import { Effects } from '../src/adapters/effects.js';
import { GAME_CONFIG, TWO_PLAYER_CONFIG, tuned } from '../src/config.js';
import { createInitialState, startGame } from '../src/domain/game.js';
import { EMPTY_METER, phantomBand } from '../src/domain/supers.js';
import { callsNamed, createRecordingContext, FakeCanvas } from './support/fake-canvas.js';

// What supers look like: the ball in its super's color, a phantom that only shimmers, the
// meters in the corners, and the callouts when a super fires, is saved, or can finish a match.

const SUPERS = tuned(GAME_CONFIG, { supers: { enabled: true } });
const DUO = tuned(TWO_PLAYER_CONFIG, { supers: { enabled: true } });
const { width, height } = GAME_CONFIG;
const glows = () => new GlowSprites(() => new FakeCanvas());
const shot = (kind, side = 'player') => ({ kind, side, speed: 500 });

function playing(config = SUPERS, overrides = {}) {
  return {
    ...startGame(createInitialState(config, 2), config),
    serveCountdown: 0,
    ball: { x: 200, y: 300, vx: 0, vy: -700, spin: 0 },
    ...overrides,
  };
}

test('a super wears its own color, over Turbo and the hitter\'s', () => {
  for (const kind of Object.keys(SUPER_STYLE)) {
    assert.equal(ballColor(playing(SUPERS, { superShot: shot(kind), turbo: 2 }), SUPERS), SUPER_STYLE[kind].rgb);
  }

  assert.equal(ballColor(playing(SUPERS, { superShot: shot('fireball'), serveCountdown: 0.5 }), SUPERS), THEME.violet, 'not while it waits to be served');
});

test('a phantom halfway across is only a faint ring, with no white core to give it away', () => {
  const hidden = playing(SUPERS, { superShot: shot('phantom'), ball: { x: 200, y: height / 2, vx: 0, vy: -700, spin: 0.3 } });
  const ctx = createRecordingContext();

  drawBall(ctx, hidden, SUPERS, 1000, glows());

  assert.equal(callsNamed(ctx, 'fill').length, 0, 'no core');
  assert.equal(callsNamed(ctx, 'drawImage').length, 0, 'no glow');
  const ring = callsNamed(ctx, 'stroke');
  assert.equal(ring.length, 1);
  assert.ok(ring[0].brush.strokeStyle.startsWith(`rgba(${SUPER_STYLE.phantom.rgb}`));

  // Out of the hidden stretch it is a ball like any other.
  const seen = createRecordingContext();
  drawBall(seen, { ...hidden, ball: { ...hidden.ball, y: 700 } }, SUPERS, 1000, glows());
  assert.ok(callsNamed(seen, 'arc').some((call) => call.brush.fillStyle === THEME.ballCore));
});

test('a fireball streams a flame behind it and thunder crackles, both around a white core', () => {
  const fireball = createRecordingContext();
  drawBall(fireball, playing(SUPERS, { superShot: shot('fireball'), ball: { x: 200, y: 300, vx: 0, vy: -1100, spin: 0 } }), SUPERS, 0, glows());
  const flame = callsNamed(fireball, 'lineTo');
  assert.equal(flame.length, 2, 'two tongues of fire');
  assert.ok(flame.every((call) => call.args[1] > 300), 'streaming out behind the ball');
  assert.ok(callsNamed(fireball, 'arc').some((call) => call.brush.fillStyle === THEME.ballCore));

  const thunder = createRecordingContext();
  drawBall(thunder, playing(SUPERS, { superShot: shot('thunder') }), SUPERS, 0, glows());
  assert.equal(callsNamed(thunder, 'stroke').length, 3, 'three arcs');

  // The crackle keeps its shape for a few frames, then changes it.
  const later = createRecordingContext();
  drawBall(later, playing(SUPERS, { superShot: shot('thunder') }), SUPERS, 20, glows());
  const much = createRecordingContext();
  drawBall(much, playing(SUPERS, { superShot: shot('thunder') }), SUPERS, 200, glows());
  const first = (ctx) => callsNamed(ctx, 'moveTo')[0].args;
  assert.deepEqual(first(later), first(thunder));
  assert.notDeepEqual(first(much), first(thunder));
});

test('a phantom leaves no trail where nobody can see it', () => {
  const band = phantomBand(shot('phantom'), SUPERS);
  const points = [{ x: 10, y: 720 }, { x: 20, y: (band.from + band.to) / 2 }, { x: 30, y: band.from + 1 }];
  const ctx = createRecordingContext();

  drawTrail(ctx, points, playing(SUPERS, { superShot: shot('phantom') }), SUPERS);

  assert.equal(callsNamed(ctx, 'fill').length, 1);
});

const texts = (ctx) => callsNamed(ctx, 'fillText').map((call) => call.args[0]);

test('the meters show only while supers are on and a match is under way', () => {
  const off = createRecordingContext();
  drawMeters(off, playing(GAME_CONFIG), GAME_CONFIG, 0);
  assert.equal(off.calls.length, 0);

  const ready = createRecordingContext();
  drawMeters(ready, createInitialState(SUPERS, 1), SUPERS, 0);
  assert.equal(ready.calls.length, 0);

  const on = createRecordingContext();
  drawMeters(on, playing(), SUPERS, 0);
  assert.deepEqual(texts(on), ['SUPER', 'SUPER']);
});

test('a meter sits in its own corner and fills from the corner in', () => {
  const player = meterBox('player', SUPERS);
  const opponent = meterBox('opponent', SUPERS);

  assert.ok(player.x < width / 4 && player.y > height - 40);
  assert.ok(opponent.x + opponent.width > width * 0.75 && opponent.y < 40);

  const ctx = createRecordingContext();
  drawMeters(ctx, playing(SUPERS, { meters: { player: { charge: 0.5, kind: null }, opponent: { charge: 0.25, kind: null } } }), SUPERS, 0);
  const starts = callsNamed(ctx, 'moveTo').map((call) => call.args[0]);

  // Tracks and fills are rounded rectangles, each starting one radius in from its left edge.
  const radius = player.height / 2;
  assert.ok(starts.includes(player.x + radius), 'the player\'s fill starts at the left');
  assert.ok(starts.some((x) => Math.abs(x - (opponent.x + opponent.width - opponent.width * 0.25 + radius)) < 1e-9), 'the top one ends at the right');
});

test('a full meter names its super, and reminds a person to flick', () => {
  const ctx = createRecordingContext();
  drawMeters(ctx, playing(SUPERS, { meters: { player: { charge: 1, kind: 'fireball' }, opponent: { charge: 1, kind: 'phantom' } } }), SUPERS, 0);

  assert.deepEqual(texts(ctx), ['FIREBALL · FLICK', 'PHANTOM']);
  const labels = callsNamed(ctx, 'fillText');
  assert.ok(labels[0].brush.fillStyle.startsWith(`rgba(${SUPER_STYLE.fireball.rgb}`));
  assert.equal(callsNamed(ctx, 'rotate').length, 0);
});

test('between two people the top meter\'s name faces the top player', () => {
  const ctx = createRecordingContext();
  drawMeters(ctx, playing(DUO, { meters: { player: EMPTY_METER, opponent: { charge: 1, kind: 'zigzag' } } }), DUO, 0);

  assert.deepEqual(texts(ctx), ['SUPER', 'ZIGZAG · FLICK']);
  assert.deepEqual(callsNamed(ctx, 'rotate').map((call) => call.args[0]), [Math.PI]);
});

const context = (state) => ({ config: SUPERS, random: () => 0.5, state });
const hit = (overrides = {}) => ({ type: 'paddle-hit', side: 'player', x: 60, y: 734, speed: 1100, spin: 0, offset: 0, rally: 3, ...overrides });

function play(events, state = playing()) {
  const effects = new Effects({ random: () => 0.5 });
  playEvents(effects, events, context(state));
  return effects;
}

test('a super goes off with its name, big and centered, and a blast in its color', () => {
  const plain = play([hit({ speed: 500 })]);
  const fired = play([hit({ super: 'fireball' })]);

  assert.deepEqual(calloutFor(hit({ super: 'thunder' }), SUPERS), { text: 'THUNDER!', rgb: SUPER_STYLE.thunder.rgb });
  assert.equal(fired.labels[0].text, 'FIREBALL!');
  assert.equal(fired.labels[0].x, width / 2);
  assert.equal(fired.labels[0].size, 38);
  assert.ok(fired.particles.length > plain.particles.length);
  assert.ok(fired.rings.length > plain.rings.length);
  assert.equal(fired.flashColor, `rgb(${SUPER_STYLE.fireball.rgb})`);
});

test('answering a super is SAVED!, in the saver\'s color', () => {
  const effects = play([hit({ side: 'opponent', y: 66, saved: 'zigzag', speed: 500 })]);

  assert.equal(effects.labels[0].text, 'SAVED!');
  assert.equal(effects.labels[0].color, `rgb(${THEME.side.opponent.rgb})`);
});

test('a zigzag\'s swerve sparks where it turns', () => {
  const effects = play([{ type: 'super-swerve', x: 120, y: 533 }]);

  assert.ok(effects.particles.length > 0);
  assert.deepEqual([effects.rings[0].x, effects.rings[0].y], [120, 533]);
});

test('a meter that fills rings out at the meter, in its super\'s color', () => {
  const effects = play([{ type: 'super-ready', side: 'opponent', kind: 'thunder' }]);
  const box = meterBox('opponent', SUPERS);

  assert.equal(effects.rings[0].x, box.x + box.width / 2);
  assert.equal(effects.rings[0].color, `rgb(${SUPER_STYLE.thunder.rgb})`);
  assert.deepEqual(effects.labels, [], 'no callout away from match point');
});

test('one point from winning with a super in hand, the side is told to FINISH IT!', () => {
  const loaded = playing(SUPERS, { score: { player: 6, opponent: 2 }, meters: { player: { charge: 1, kind: 'phantom' }, opponent: EMPTY_METER } });
  const empty = playing(SUPERS, { score: { player: 6, opponent: 2 } });

  assert.equal(play([{ type: 'match-point', side: 'player' }], loaded).labels[0].text, 'FINISH IT!');
  assert.equal(play([{ type: 'match-point', side: 'player' }], empty).labels[0].text, 'MATCH POINT');

  const filling = play([{ type: 'super-ready', side: 'player', kind: 'phantom' }], loaded);
  assert.equal(filling.labels[0].text, 'FINISH IT!');
  assert.equal(filling.labels[0].color, `rgb(${THEME.side.player.rgb})`);

  const opponentFills = play([{ type: 'super-ready', side: 'opponent', kind: 'zigzag' }], loaded);
  assert.deepEqual(opponentFills.labels, [], 'the other side is not at match point');
});

test('without the state to read the meters from, a match point is announced plainly', () => {
  const effects = new Effects({ random: () => 0.5 });

  playEvents(effects, [{ type: 'match-point', side: 'player' }, { type: 'super-ready', side: 'player', kind: 'zigzag' }], { config: SUPERS, random: () => 0.5 });

  assert.equal(effects.labels[0].text, 'MATCH POINT');
});
