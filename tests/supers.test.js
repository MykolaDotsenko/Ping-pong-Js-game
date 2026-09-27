import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG, tuned } from '../src/config.js';
import { advanceGame, createInitialState, startGame } from '../src/domain/game.js';
import { calculateOpponentTarget } from '../src/domain/opponent.js';
import {
  chargeMeter,
  CURVE_SPIN,
  EDGE_OFFSET,
  EMPTY_METER,
  isLoaded,
  launchSuper,
  PHANTOM_FROM,
  PHANTOM_TO,
  phantomHidden,
  returnCharge,
  SUPER_KINDS,
} from '../src/domain/supers.js';

// Supers: returns fill a meter, and a full meter fires a super with the next flick at a
// return, or, for the computer, when chance says so. Each of the four is hard to return in
// its own way, and a point won with one is named, down to the last point of the match.

const { width, height, paddle, ball: ballConfig } = GAME_CONFIG;
const step = GAME_CONFIG.fixedStepSeconds;
const idle = Object.freeze({ horizontalAxis: 0, pointerX: null, opponentAxis: 0, opponentPointerX: null });
const SUPERS = tuned(GAME_CONFIG, { powerUps: { enabled: false }, supers: { enabled: true } });
// Two people: neither paddle moves unless told to, so every return is exactly as set up.
const DUO = tuned(TWO_PLAYER_CONFIG, { powerUps: { enabled: false }, supers: { enabled: true } });
const { perHit, perSkill, perSave, perConceded } = SUPERS.supers;
const playerFace = height - paddle.inset - paddle.height - ballConfig.radius;
const opponentFace = paddle.inset + paddle.height + ballConfig.radius;
const loaded = (kind) => ({ charge: 1, kind });
const near = (actual, expected, tolerance = 1e-9) => Math.abs(actual - expected) <= tolerance;

/** A match past the countdown. */
function running(config, overrides = {}) {
  return { ...startGame(createInitialState(config, 5), config), serveCountdown: 0, ...overrides };
}

/** The ball one step from the given side's paddle, straight at its center. */
function aboutToReturn(side, ball = {}) {
  return side === 'player'
    ? { ball: { x: width / 2, y: playerFace - 2, vx: 0, vy: 360, spin: 0, ...ball }, player: { x: width / 2, vx: 0 } }
    : { ball: { x: width / 2, y: opponentFace + 2, vx: 0, vy: -360, spin: 0, ...ball }, opponent: { x: width / 2, vx: 0 } };
}

const hitOf = (state) => state.events.find((event) => event.type === 'paddle-hit');
const meters = (player, opponent = EMPTY_METER) => ({ player, opponent });

test('a new match starts with both meters empty and no super in flight', () => {
  const state = createInitialState(SUPERS, 1);

  assert.deepEqual(state.meters, meters(EMPTY_METER));
  assert.equal(state.superShot, null);
  assert.equal(isLoaded(EMPTY_METER), false);
  assert.equal(isLoaded(loaded('zigzag')), true);
});

test('with supers off a return fills no meter, draws nothing and tags nothing, as it always did', () => {
  const plain = tuned(GAME_CONFIG, { powerUps: { enabled: false } });
  const state = running(plain, { ...aboutToReturn('player'), player: { x: width / 2, vx: 800 } });
  const next = advanceGame(state, step, idle, plain);

  assert.equal(plain.supers.enabled, false, 'classic play has supers off');
  assert.equal(RUSH_CONFIG.supers.enabled, false, 'and so does Rush');
  assert.deepEqual(next.meters, meters(EMPTY_METER));
  assert.equal(next.superShot, null);
  assert.equal(next.seed, state.seed);
  assert.deepEqual(Object.keys(hitOf(next)).sort(), ['offset', 'rally', 'side', 'speed', 'spin', 'type', 'x', 'y']);
});

test('charge adds up until the meter is full, which draws a super and announces it', () => {
  const events = [];
  let state = running(SUPERS);

  for (let i = 0; i < 9; i += 1) {
    state = chargeMeter(state, 'player', 0.1, events);
  }

  assert.deepEqual(events, []);
  assert.ok(near(state.meters.player.charge, 0.9));

  // Ten tenths fall a hair short of 1 in floating point; that still fills the meter.
  const before = state;
  state = chargeMeter(state, 'player', 0.1, events);

  assert.equal(state.meters.player.charge, 1);
  assert.ok(SUPER_KINDS.includes(state.meters.player.kind));
  assert.deepEqual(events, [{ type: 'super-ready', side: 'player', kind: state.meters.player.kind }]);
  assert.notEqual(state.seed, before.seed, 'the super is drawn from the seed');
  assert.strictEqual(chargeMeter(state, 'player', 0.5, events), state, 'a full meter takes no more');
  assert.strictEqual(chargeMeter(state, 'opponent', 0, events), state, 'nothing to add changes nothing');
  assert.equal(events.length, 1);
});

test('a fresh super is never the one that side fired last, and every kind turns up', () => {
  for (const last of SUPER_KINDS) {
    const drawn = new Set();

    for (let seed = 0; seed < 60; seed += 1) {
      const state = { ...running(SUPERS), seed, meters: meters({ charge: 0.95, kind: last }) };
      drawn.add(chargeMeter(state, 'player', 0.1, []).meters.player.kind);
    }

    assert.deepEqual([...drawn].sort(), SUPER_KINDS.filter((kind) => kind !== last).sort());
  }
});

test('a return charges the hitter\'s meter, more off the paddle\'s edge and more with curve', () => {
  const plain = advanceGame(running(DUO, aboutToReturn('player')), step, idle, DUO);
  assert.ok(near(plain.meters.player.charge, perHit));
  assert.equal(plain.meters.opponent.charge, 0);

  const edge = advanceGame(running(DUO, aboutToReturn('player', { x: width / 2 + paddle.width / 2 - 4 })), step, idle, DUO);
  assert.ok(Math.abs(hitOf(edge).offset) >= EDGE_OFFSET);
  assert.ok(near(edge.meters.player.charge, perHit + perSkill));

  // A flick with an empty meter only curves the return.
  const curve = advanceGame(running(DUO, { ...aboutToReturn('player'), player: { x: width / 2, vx: 800 } }), step, idle, DUO);
  assert.ok(Math.abs(curve.ball.spin) >= CURVE_SPIN);
  assert.equal(curve.superShot, null);
  assert.ok(near(curve.meters.player.charge, perHit + perSkill));
});

test('a full meter fires its super when the player flicks as they hit, and only then', () => {
  const ready = running(DUO, { ...aboutToReturn('player'), meters: meters(loaded('fireball')) });
  const still = advanceGame(ready, step, idle, DUO);

  assert.equal(still.superShot, null);
  assert.deepEqual(still.meters.player, loaded('fireball'), 'the super waits for a flick');
  assert.equal('super' in hitOf(still), false);

  const flicked = advanceGame({ ...ready, player: { x: width / 2, vx: 800 } }, step, idle, DUO);
  const ordinary = 360 * ballConfig.speedIncrease;

  assert.equal(hitOf(flicked).super, 'fireball');
  assert.equal(hitOf(flicked).speed, Math.hypot(flicked.ball.vx, flicked.ball.vy), 'the event reports the super\'s speed');
  assert.deepEqual(flicked.meters.player, { charge: 0, kind: 'fireball' }, 'the meter empties and remembers what it fired');
  assert.equal(flicked.superShot.kind, 'fireball');
  assert.equal(flicked.superShot.side, 'player');
  assert.ok(near(flicked.superShot.speed, ordinary), 'it remembers the pace of an ordinary return');
  assert.ok(flicked.ball.vy < 0);
});

test('between two people the top player fires with a flick as well, never by chance', () => {
  const duo = tuned(DUO, { supers: { cpuChance: 1 } });
  const ready = running(duo, { ...aboutToReturn('opponent'), meters: meters(EMPTY_METER, loaded('phantom')) });

  assert.equal(advanceGame(ready, step, idle, duo).superShot, null);

  const flicked = advanceGame({ ...ready, opponent: { x: width / 2, vx: -800 } }, step, idle, duo);
  assert.deepEqual([flicked.superShot.kind, flicked.superShot.side], ['phantom', 'opponent']);
  assert.ok(flicked.ball.vy > 0);
});

test('the computer fires a full meter by chance, drawn from the seed', () => {
  const always = tuned(SUPERS, { supers: { cpuChance: 1 } });
  const never = tuned(SUPERS, { supers: { cpuChance: 0 } });
  const ready = (config) => running(config, { ...aboutToReturn('opponent'), meters: meters(EMPTY_METER, loaded('zigzag')) });

  const fired = advanceGame(ready(always), step, idle, always);
  assert.equal(hitOf(fired).super, 'zigzag');
  assert.equal(fired.meters.opponent.charge, 0);

  const held = advanceGame(ready(never), step, idle, never);
  assert.equal(held.superShot, null);
  assert.equal(held.meters.opponent.charge, 1);
  assert.notEqual(held.seed, ready(never).seed, 'the chance is drawn even when it says no');

  const empty = running(always, aboutToReturn('opponent'));
  assert.equal(advanceGame(empty, step, idle, always).seed, empty.seed, 'without a full meter nothing is drawn');
});

test('a return that fires a super earns no charge; one that answers a super earns extra', () => {
  const strike = (overrides) => ({ state: running(SUPERS), fired: null, saved: null, ...overrides });

  assert.equal(returnCharge(strike({ fired: 'thunder' }), 1, SUPERS), 0);
  assert.ok(near(returnCharge(strike({ saved: 'thunder' }), 0, SUPERS), perHit + perSave));
});

/** A return from the player's paddle, launched as a super against a receiver at receiverX. */
function launched(kind, receiverX, ball = {}) {
  const state = { ...running(DUO), opponent: { x: receiverX, vx: 0 } };
  return launchSuper(kind, { x: width / 2, y: playerFace, vx: 0, vy: -400, spin: 0, ...ball }, 'player', state, DUO);
}

/** Where a ball flying straight would cross the top paddle's face line. */
const landing = (ball) => ball.x + ball.vx * ((ball.y - opponentFace) / -ball.vy);

test('every super flies most of the top speed or faster, still toward the other end', () => {
  for (const kind of SUPER_KINDS) {
    const ball = launched(kind, 150);
    assert.ok(Math.hypot(ball.vx, ball.vy) >= ballConfig.maxSpeed * 0.72 - 1e-9, kind);
    assert.ok(ball.vy < 0, kind);
  }

  const fireball = launched('fireball', 150);
  assert.ok(Math.hypot(fireball.vx, fireball.vy) > ballConfig.maxSpeed, 'a fireball outruns any ordinary ball');
  assert.equal(fireball.spin, 0);
});

test('a fireball and a phantom go wide of the receiver, toward the side of the court left open', () => {
  for (const kind of ['fireball', 'phantom']) {
    const fromLeft = landing(launched(kind, 120));
    const fromRight = landing(launched(kind, 380));

    assert.ok(fromLeft > 120 + 40, `${kind}: past a receiver on the left, to the right`);
    assert.ok(fromRight < 380 - 40, `${kind}: past a receiver on the right, to the left`);
  }

  // A receiver in the middle leaves no side open: the super goes the way the return leans.
  assert.ok(landing(launched('fireball', width / 2, { vx: -60 })) < width / 2 - 100);
  assert.ok(landing(launched('fireball', width / 2, { vx: 60 })) > width / 2 + 100);
  assert.ok(launched('phantom', 120).spin > 0, 'a phantom curves on toward the open side');
});

/** Flies a ball launched from the player's paddle to the top face line, with nobody returning it. */
function fly(kind, receiverX, ball = {}) {
  let state = {
    ...running(DUO),
    opponent: { x: receiverX, vx: 0 },
    ball: launched(kind, receiverX, ball),
    superShot: { kind, side: 'player', speed: 400 },
  };
  const swerves = [];
  const hidden = [];

  while (state.ball.y > opponentFace) {
    state = advanceGame(state, step, idle, DUO);
    swerves.push(...state.events.filter((event) => event.type === 'super-swerve'));
    hidden.push({ x: state.ball.x, y: state.ball.y, hidden: phantomHidden(state, DUO) });
  }

  return { state, swerves, hidden };
}

test('a zigzag leans toward the open side and swerves the other way at each third of the court', () => {
  const start = launched('zigzag', 120);
  assert.ok(start.vx > 0, 'toward the open side');
  assert.equal(start.spin, 0);

  const { state, swerves } = fly('zigzag', 120);

  assert.equal(swerves.length, 2);
  assert.ok(near(swerves[0].y, (height * 2) / 3, 12) && near(swerves[1].y, height / 3, 12));
  assert.ok(state.ball.vx > 0, 'two swerves: it ends leaning the way it began');
});

test('a phantom vanishes halfway across and shows again before it reaches the paddle', () => {
  const { hidden } = fly('phantom', 120);
  const span = playerFace - opponentFace;
  const progress = (y) => (playerFace - y) / span;

  for (const sample of hidden) {
    const inside = progress(sample.y) > PHANTOM_FROM + 0.01 && progress(sample.y) < PHANTOM_TO - 0.01;
    const outside = progress(sample.y) < PHANTOM_FROM - 0.01 || progress(sample.y) > PHANTOM_TO + 0.01;

    if (inside) assert.equal(sample.hidden, true, `hidden at ${sample.y}`);
    if (outside) assert.equal(sample.hidden, false, `seen at ${sample.y}`);
  }

  // Only a phantom ever hides.
  const midCourt = { ...running(DUO), ball: { x: 250, y: height / 2, vx: 0, vy: -500, spin: 0 } };
  assert.equal(phantomHidden({ ...midCourt, superShot: { kind: 'phantom', side: 'player', speed: 400 } }, DUO), true);
  assert.equal(phantomHidden({ ...midCourt, superShot: { kind: 'fireball', side: 'player', speed: 400 } }, DUO), false);
  assert.equal(phantomHidden(midCourt, DUO), false);
});

test('thunder heads straight for the receiver and breaks late toward the open side', () => {
  for (const [receiverX, open] of [[430, -1], [70, 1]]) {
    const start = launched('thunder', receiverX);
    assert.ok(near(landing(start), receiverX, 1), 'aimed at the receiver\'s paddle');

    const { state, hidden } = fly('thunder', receiverX);
    const broke = (state.ball.x - receiverX) * open;
    assert.ok(broke > 90 && broke < 190, `broke ${broke} toward the open side`);

    // Late: two thirds of the way across it has barely left the line to the receiver.
    const twoThirds = hidden.find((sample) => sample.y < playerFace - ((playerFace - opponentFace) * 2) / 3);
    const straight = start.x + start.vx * ((start.y - twoThirds.y) / -start.vy);
    assert.ok(Math.abs(twoThirds.x - straight) < broke * 0.35, 'most of the break comes in the last third');
  }
});

test('returning a super takes the sting out: the ball goes on at an ordinary rally\'s pace', () => {
  const state = running(DUO, {
    ...aboutToReturn('opponent', { vy: -1150 }),
    superShot: { kind: 'fireball', side: 'player', speed: 500 },
  });
  const next = advanceGame(state, step, idle, DUO);

  assert.equal(hitOf(next).saved, 'fireball');
  assert.equal('super' in hitOf(next), false);
  assert.equal(next.superShot, null);
  assert.ok(near(Math.hypot(next.ball.vx, next.ball.vy), 500 * ballConfig.speedIncrease, 1e-6));
  assert.ok(near(next.meters.opponent.charge, perHit + perSave));
});

test('a ball the firer meets again, say after a glance, ends the super without counting as saved', () => {
  const state = running(DUO, { ...aboutToReturn('player'), superShot: { kind: 'thunder', side: 'player', speed: 420 } });
  const next = advanceGame(state, step, idle, DUO);

  assert.equal(next.superShot, null);
  assert.equal('saved' in hitOf(next), false);
  assert.ok(near(Math.hypot(next.ball.vx, next.ball.vy), 420 * ballConfig.speedIncrease, 1e-6));
});

test('a point won by a super is named, charges the loser\'s meter and ends the super', () => {
  const past = { x: 30, y: -ballConfig.radius + 2, vx: 0, vy: -600, spin: 0 };
  const state = running(DUO, { ball: past, opponent: { x: 400, vx: 0 }, superShot: { kind: 'phantom', side: 'player', speed: 500 } });
  const next = advanceGame(state, step, idle, DUO);
  const point = next.events.find((event) => event.type === 'point');

  assert.equal(point.super, 'phantom');
  assert.equal(next.superShot, null);
  assert.ok(near(next.meters.opponent.charge, perConceded), 'the loser of the point is helped back');
  assert.equal(next.meters.player.charge, 0);

  const final = advanceGame({ ...state, score: { player: 6, opponent: 3 } }, step, idle, DUO);
  const over = final.events.find((event) => event.type === 'game-over');
  assert.deepEqual(over, { type: 'game-over', winner: 'player', super: 'phantom' });
  assert.equal(final.superShot, null);
});

test('an ordinary point names no super, nor does one scored against the side that fired', () => {
  const past = { x: 30, y: -ballConfig.radius + 2, vx: 0, vy: -600, spin: 0 };
  const plain = advanceGame(running(DUO, { ball: past, opponent: { x: 400, vx: 0 } }), step, idle, DUO);
  const theirs = advanceGame(running(DUO, {
    ball: past,
    opponent: { x: 400, vx: 0 },
    superShot: { kind: 'zigzag', side: 'opponent', speed: 500 },
  }), step, idle, DUO);

  for (const next of [plain, theirs]) {
    assert.equal('super' in next.events.find((event) => event.type === 'point'), false);
  }
});

test('a Multiball ball that scores is no super, even with a super in flight', () => {
  const state = running(DUO, {
    ball: { x: 250, y: 400, vx: 0, vy: -300, spin: 0 },
    extraBalls: [{ x: 30, y: -ballConfig.radius + 2, vx: 0, vy: -600, spin: 0, id: 1, ttl: 5 }],
    opponent: { x: 400, vx: 0 },
    superShot: { kind: 'fireball', side: 'player', speed: 500 },
  });
  const point = advanceGame(state, step, idle, DUO).events.find((event) => event.type === 'point');

  assert.equal(point.scorer, 'player');
  assert.equal('super' in point, false);
});

test('a lost point charges nothing with supers off', () => {
  const plain = tuned(TWO_PLAYER_CONFIG, { powerUps: { enabled: false } });
  const past = { x: 30, y: -ballConfig.radius + 2, vx: 0, vy: -600, spin: 0 };
  const next = advanceGame(running(plain, { ball: past, opponent: { x: 400, vx: 0 } }), step, idle, plain);

  assert.deepEqual(next.meters, meters(EMPTY_METER));
});

test('while a phantom is out of sight the computer can only guess where it went', () => {
  const state = running(SUPERS, { ball: { x: 250, y: height / 2, vx: 120, vy: -700, spin: 0 }, serveNumber: 3, rally: 2 });
  const seen = calculateOpponentTarget(state, SUPERS);
  const shot = (kind) => ({ ...state, superShot: { kind, side: 'player', speed: 500 } });

  assert.notEqual(calculateOpponentTarget(shot('phantom'), SUPERS), seen);
  assert.equal(calculateOpponentTarget(shot('fireball'), SUPERS), seen, 'any other super it sees as well as any ball');
});
