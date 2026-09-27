import { DIFFICULTY_CONFIGS, GAME_CONFIG, RUSH_CONFIG, TWO_PLAYER_CONFIG, tuned } from './config.js';

/**
 * @import { MatchCatalog, Rival } from './application/ports.js'
 */

// The matches a player can choose, handed to the application: the three difficulties of a
// Solo match, Rush, two players, and the career ladder below.

// The Last Arcade: the career ladder. Nine regulars of the last arcade in town, each with a
// tuning and one line of story, from a first-timer to the router in the back room, and at the
// top the landlord who wants the place gone. The fourth, the seventh and the ninth are bosses,
// which attack the player's end of the court; the landlord is the final boss, who borrows all
// three of their attacks, one after another as the player closes in on winning. Every name is
// made up and names nobody.

const NO_POWER_UPS = Object.freeze({ enabled: false });

/** @type {readonly Rival[]} */
export const RIVALS = Object.freeze([
  {
    name: 'Rookie Roma',
    short: 'Roma',
    story: 'First night at the arcade. Holds the paddle like a shawarma.',
    boss: false,
    config: tuned(GAME_CONFIG, {
      ball: { initialSpeed: 380, maxSpeed: 820, speedIncrease: 1.035 },
      opponent: { maxSpeed: 210, reach: 0.4, predictionWeight: 0.3, error: 130, aim: 0 },
      powerUps: NO_POWER_UPS,
    }),
  },
  {
    name: 'Aunt Halyna',
    short: 'Halyna',
    story: 'Runs the cloakroom. Wide paddle, slow hands, zero mercy.',
    boss: false,
    config: tuned(GAME_CONFIG, {
      ball: { initialSpeed: 400, maxSpeed: 900, speedIncrease: 1.04 },
      opponent: { maxSpeed: 185, reach: 0.5, predictionWeight: 0.45, error: 105, aim: 0.1, widthScale: 1.4 },
      powerUps: NO_POWER_UPS,
    }),
  },
  {
    name: 'Twisty Taras',
    short: 'Taras',
    story: 'Everything he hits comes back bent. Rules included.',
    boss: false,
    config: tuned(GAME_CONFIG, {
      ball: { initialSpeed: 420, maxSpeed: 980, speedIncrease: 1.045 },
      opponent: { maxSpeed: 260, reach: 0.55, predictionWeight: 0.6, error: 85, aim: 0.2, curve: 0.45 },
      powerUps: NO_POWER_UPS,
    }),
  },
  {
    name: 'The Janitor',
    short: 'Janitor',
    story: 'Mops the floor with players. His bucket leaks on purpose.',
    boss: true,
    config: tuned(GAME_CONFIG, {
      opponent: { maxSpeed: 280, reach: 0.6, predictionWeight: 0.65, error: 72, aim: 0.25 },
      powerUps: NO_POWER_UPS,
      boss: { attack: 'drip', every: [7, 10], warning: 1, shrinkSeconds: 2.5, lagSeconds: 0 },
    }),
  },
  {
    name: 'Hoarder Hryts',
    short: 'Hryts',
    story: 'Never met a power-up he did not pocket.',
    boss: false,
    config: tuned(GAME_CONFIG, {
      powerUps: { enabled: true, spawnDelay: [2.5, 4.5] },
    }),
  },
  {
    name: 'Sniper Sanya',
    short: 'Sanya',
    story: 'Aims for the corners. Blames the lag when he misses.',
    boss: false,
    config: tuned(GAME_CONFIG, {
      ball: { initialSpeed: 450, maxSpeed: 1100, speedIncrease: 1.055 },
      opponent: { maxSpeed: 420, reach: 0.7, predictionWeight: 0.9, error: 30, aim: 0.75 },
      powerUps: NO_POWER_UPS,
    }),
  },
  {
    name: 'DJ Wobble',
    short: 'DJ Wobble',
    story: 'Drops the bass, then a beam right where you stand.',
    boss: true,
    config: tuned(GAME_CONFIG, {
      ball: { initialSpeed: 450, maxSpeed: 1100, speedIncrease: 1.05 },
      opponent: { maxSpeed: 400, reach: 0.68, predictionWeight: 0.8, error: 40, aim: 0.35 },
      powerUps: NO_POWER_UPS,
      boss: { attack: 'beam', every: [7, 9.5], warning: 1, shrinkSeconds: 2.5, lagSeconds: 0 },
    }),
  },
  {
    name: 'Grandmaster Zina',
    short: 'Zina',
    story: 'Unbeaten since the arcade opened. Knits between points.',
    boss: false,
    config: tuned(GAME_CONFIG, {
      ball: { initialSpeed: 480, maxSpeed: 1200, speedIncrease: 1.06 },
      opponent: { maxSpeed: 480, reach: 0.8, predictionWeight: 0.9, error: 30, aim: 0.45, curve: 0.25 },
      powerUps: NO_POWER_UPS,
    }),
  },
  {
    name: 'LAG',
    short: 'LAG',
    story: 'The router in the back room. Buffering since 1998.',
    boss: true,
    config: tuned(GAME_CONFIG, {
      ball: { initialSpeed: 480, maxSpeed: 1200, speedIncrease: 1.06 },
      opponent: { maxSpeed: 480, reach: 0.8, predictionWeight: 0.9, error: 30, aim: 0.4 },
      powerUps: NO_POWER_UPS,
      boss: { attack: 'lag', every: [9, 12], warning: 1, shrinkSeconds: 0, lagSeconds: 2.2 },
    }),
  },
  {
    name: 'The Landlord',
    short: 'Landlord',
    story: 'Owns the building. Wants a parking lot where the arcade stands.',
    boss: true,
    config: tuned(GAME_CONFIG, {
      ball: { initialSpeed: 480, maxSpeed: 1200, speedIncrease: 1.06 },
      opponent: { maxSpeed: 480, reach: 0.8, predictionWeight: 0.9, error: 30, aim: 0.45, widthScale: 1.15 },
      powerUps: NO_POWER_UPS,
      supers: { cpuChance: 0.75 },
      boss: {
        attack: 'drip',
        phases: [['drip'], ['beam'], ['lag'], ['drip', 'beam', 'lag']],
        every: [7, 9.5],
        warning: 1,
        shrinkSeconds: 2.5,
        lagSeconds: 2,
      },
    }),
  },
]);

/** @type {MatchCatalog} */
export const MATCH_CATALOG = Object.freeze({
  difficulties: DIFFICULTY_CONFIGS,
  rush: RUSH_CONFIG,
  duo: TWO_PLAYER_CONFIG,
  career: RIVALS,
});
