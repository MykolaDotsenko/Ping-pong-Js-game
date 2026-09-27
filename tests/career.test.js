import test from 'node:test';
import assert from 'node:assert/strict';

import { EASE_AFTER, easedConfig, MAX_STARS, starsFor, unlockedRival } from '../src/application/career.js';
import { MATCH_CATALOG, RIVALS } from '../src/catalog.js';
import { DIFFICULTY_CONFIGS, GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG } from '../src/config.js';
import { advanceGame, createInitialState, startGame } from '../src/domain/game.js';

/** @import { GameConfig } from '../src/domain/types.js' */

// The Last Arcade: the career ladder and its rules.

test('a win earns a star, a clear win two, and conceding at most one point three', () => {
  assert.equal(starsFor({ player: 3, opponent: 7 }), 0);
  assert.equal(starsFor({ player: 7, opponent: 6 }), 1);
  assert.equal(starsFor({ player: 7, opponent: 4 }), 1);
  assert.equal(starsFor({ player: 7, opponent: 3 }), 2);
  assert.equal(starsFor({ player: 7, opponent: 2 }), 2);
  assert.equal(starsFor({ player: 7, opponent: 1 }), MAX_STARS);
  assert.equal(starsFor({ player: 7, opponent: 0 }), MAX_STARS);
});

test('the ladder is open up to the first rival not yet beaten, and to the end once all are', () => {
  assert.equal(unlockedRival([], 9), 0);
  assert.equal(unlockedRival([1, 3, 2], 9), 3);
  assert.equal(unlockedRival([1, 0, 2], 9), 1, 'a gap closes the ladder behind it');
  assert.equal(unlockedRival([1, 1, 1, 1, 1, 1, 1, 1, 1], 9), 8);
  assert.equal(unlockedRival([1, 1, 1, 1, 1, 1, 1, 1, 1], 10), 9, 'a ladder that grew opens its new top');
});

test('a rival that has beaten the player twice in a row plays tired, and a boss attacks less', () => {
  const [janitor] = RIVALS.filter((rival) => rival.boss);
  const tired = easedConfig(janitor.config);
  const boss = /** @type {NonNullable<typeof tired.boss>} */ (tired.boss);
  const fresh = /** @type {NonNullable<typeof janitor.config.boss>} */ (janitor.config.boss);

  assert.equal(EASE_AFTER, 2);
  assert.ok(tired.opponent.maxSpeed < janitor.config.opponent.maxSpeed);
  assert.ok(tired.opponent.error > janitor.config.opponent.error);
  assert.ok(boss.every[0] > fresh.every[0] && boss.every[1] > fresh.every[1]);
  assert.ok(boss.shrinkSeconds < fresh.shrinkSeconds);
  assert.equal(easedConfig(RIVALS[0].config).boss, null, 'a rival that is no boss stays one');
  assert.ok(Object.isFrozen(tired) && Object.isFrozen(tired.opponent));
});

test('ten rivals, four of them bosses, the last the final boss, each with a story and a short name', () => {
  assert.equal(RIVALS.length, 10);
  assert.deepEqual(RIVALS.map((rival, index) => (rival.boss ? index : null)).filter((index) => index !== null), [3, 6, 8, 9]);

  for (const rival of RIVALS) {
    assert.ok(rival.short.length > 0 && rival.short.length <= 9, `${rival.name}: "${rival.short}" fits the scoreboard`);
    assert.ok(rival.story.length > 10 && rival.story.length <= 70, `${rival.name} has one line of story`);
    assert.equal(rival.config.opponent.controller, 'cpu');
    assert.equal(rival.config.rules.kind, 'match');
    assert.equal(Boolean(rival.config.boss), rival.boss, `${rival.name}: a boss attacks, and only a boss`);
  }

  assert.equal(new Set(RIVALS.map((rival) => rival.name)).size, RIVALS.length);
});

test('the final boss borrows the other bosses\' attacks in turn, then all of them at once', () => {
  const bosses = RIVALS.filter((rival) => rival.boss);
  const final = /** @type {NonNullable<GameConfig['boss']>} */ (bosses.at(-1)?.config.boss);
  const borrowed = bosses.slice(0, -1).map((rival) => rival.config.boss?.attack);

  assert.ok(final.phases, 'only the final boss has phases');
  assert.ok(bosses.slice(0, -1).every((rival) => !rival.config.boss?.phases));
  assert.deepEqual(final.phases[0], [final.attack], 'its first phase is its own attack');
  assert.deepEqual(final.phases.slice(0, -1).map((phase) => phase[0]), borrowed, 'one boss after another');
  assert.deepEqual([...(final.phases.at(-1) ?? [])].sort(), [...borrowed].sort(), 'and in the end every one of them');
  assert.ok(Object.isFrozen(easedConfig(RIVALS[9].config).boss), 'a tired final boss keeps its phases');
  assert.deepEqual(easedConfig(RIVALS[9].config).boss?.phases, final.phases);
});

test('each rival plays a real match: points, hits, and for a boss its attacks', () => {
  for (const rival of RIVALS) {
    const { config } = rival;
    let state = startGame(createInitialState(config, 7), config);
    const seen = new Set();

    for (let i = 0; i < 60 / config.fixedStepSeconds && state.phase === 'running'; i += 1) {
      state = advanceGame(state, config.fixedStepSeconds, { horizontalAxis: 0, pointerX: state.ball.x, opponentAxis: 0, opponentPointerX: null }, config);
      state.events.forEach((event) => seen.add(event.type));
    }

    assert.ok(seen.has('paddle-hit') && seen.has('point'), `${rival.name} plays`);
    assert.equal(seen.has('hazard-warn'), rival.boss, `${rival.name} ${rival.boss ? 'attacks' : 'never attacks'}`);
  }
});

test('the catalog hands the application every choosable match, the classic ones unchanged', () => {
  assert.strictEqual(MATCH_CATALOG.difficulties, DIFFICULTY_CONFIGS);
  assert.strictEqual(MATCH_CATALOG.rush, RUSH_CONFIG);
  assert.strictEqual(MATCH_CATALOG.duo, TWO_PLAYER_CONFIG);
  assert.strictEqual(MATCH_CATALOG.career, RIVALS);
  assert.equal(GAME_CONFIG.boss, null);
  assert.deepEqual([GAME_CONFIG.opponent.curve, GAME_CONFIG.opponent.widthScale], [0, 1]);
});
