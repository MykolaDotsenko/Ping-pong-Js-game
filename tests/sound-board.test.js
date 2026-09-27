import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioOutput } from '../src/adapters/audio-output.js';
import { MusicPlayer } from '../src/adapters/music-player.js';
import { SoundBoard } from '../src/adapters/sound-board.js';
import { finisherFor } from '../src/adapters/finisher.js';
import { RIVALS } from '../src/catalog.js';
import { GAME_CONFIG, RUSH_CONFIG } from '../src/config.js';
import { createInitialState } from '../src/domain/game.js';

function fakeParam(value = 0) {
  const param = {
    value,
    events: [],
    setValueAtTime(value, time) {
      param.events.push(['set', value, time]);
    },
    exponentialRampToValueAtTime(value, time) {
      param.events.push(['ramp', value, time]);
    },
    linearRampToValueAtTime(value, time) {
      param.events.push(['linear', value, time]);
    },
    cancelScheduledValues(time) {
      param.events.push(['cancel', time]);
    },
  };
  return param;
}

class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 10;
    this.destination = { name: 'speakers' };
    this.oscillators = [];
    this.gains = [];
    this.resumes = 0;
    FakeAudioContext.created.push(this);
  }

  resume() {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  createGain() {
    // A browser's new gain node passes full level until something is scheduled on it.
    const gain = { gain: fakeParam(1), connections: [], connect: (node) => gain.connections.push(node) };
    this.gains.push(gain);
    return gain;
  }

  createOscillator() {
    const oscillator = {
      type: '',
      frequency: fakeParam(),
      connect: () => {},
      start: (time) => {
        oscillator.startedAt = time;
      },
      stop: (time) => {
        oscillator.stoppedAt = time;
      },
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

function setup({ sound = true, withAudio = true, jokes = false } = {}) {
  FakeAudioContext.created = [];
  const board = new SoundBoard({
    audio: new AudioOutput(withAudio ? { AudioContext: FakeAudioContext } : {}),
    preferences: { get: () => ({ sound, jokes }) },
  });
  return { board, contexts: FakeAudioContext.created };
}

/** The first match seed whose finisher, for the player's win, passes the test. */
function seedFor(test) {
  for (let seed = 0; ; seed += 1) {
    const finisher = finisherFor({ winner: 'player', twoPlayers: false, rush: false, jokes: true, seed });
    if (finisher && test(finisher)) return seed;
  }
}

const hit = (rally, side = 'player') => ({ type: 'paddle-hit', side, x: 0, y: 0, speed: 500, spin: 0, rally });

test('nothing is created while sound is off', () => {
  const { board, contexts } = setup({ sound: false });

  board.handle([{ type: 'match-start' }]);

  assert.equal(contexts.length, 0);
});

test('browsers without Web Audio are handled quietly', () => {
  const { board } = setup({ withAudio: false });

  assert.doesNotThrow(() => board.handle([{ type: 'match-start' }]));
});

test('the first event creates and resumes one audio context routed to the speakers', () => {
  const { board, contexts } = setup();

  board.handle([{ type: 'match-start' }]);
  board.handle([hit(1)]);

  assert.equal(contexts.length, 1);
  const [context] = contexts;
  assert.equal(context.resumes, 1);
  assert.deepEqual(board.master.connections, [context.destination]);
  assert.ok(context.oscillators.length > 4);
  assert.ok(context.oscillators.every((oscillator) => oscillator.stoppedAt > oscillator.startedAt));
});

test('hit pitch climbs as the rally grows', () => {
  const { board, contexts } = setup();

  board.handle([hit(1)]);
  board.handle([hit(8)]);

  const pitches = contexts[0].oscillators
    .filter((oscillator) => oscillator.type === 'square')
    .map((oscillator) => oscillator.frequency.events[0][1]);

  assert.equal(pitches.length, 2);
  assert.ok(pitches[1] > pitches[0]);
});

test('every sound starts silent, so an oscillator starting a sample early cannot click', () => {
  const { board, contexts } = setup();

  board.handle([hit(5, 'player'), { type: 'game-over', winner: 'player' }]);

  const envelopes = contexts[0].gains.slice(1);
  assert.ok(envelopes.length > 5);
  assert.ok(envelopes.every((gain) => gain.gain.value === 0.0001));
});

test('the effects play well below full scale, leaving headroom for the music', () => {
  const { board, contexts } = setup();

  board.handle([hit(1)]);

  assert.ok(contexts[0].gains[0].gain.value <= 0.5);
});

test('every event type has a sound, and milestone rallies add a chime', () => {
  const { board, contexts } = setup();
  const events = [
    { type: 'countdown', value: 3 },
    { type: 'countdown', value: 1 },
    { type: 'serve', x: 0, y: 0 },
    { type: 'pickup-spawn', kind: 'wide', x: 0, y: 0 },
    { type: 'pickup', kind: 'wide', side: 'player', x: 0, y: 0 },
    { type: 'pickup', kind: 'ghost', side: 'opponent', x: 0, y: 0 },
    { type: 'paddle-graze', side: 'player', x: 0, y: 0, speed: 500 },
    { type: 'wall-bounce', x: 0, y: 0, speed: 400 },
    { type: 'match-point', side: 'player' },
    { type: 'life-lost', lives: 2 },
    { type: 'point', scorer: 'player', x: 0, y: 0 },
    { type: 'point', scorer: 'opponent', x: 0, y: 0 },
    { type: 'game-over', winner: 'player' },
    { type: 'game-over', winner: 'opponent' },
    { type: 'paused' },
    { type: 'resumed' },
    { type: 'hazard-warn', kind: 'drip', x: 0 },
    { type: 'hazard-warn', kind: 'beam', x: 0 },
    { type: 'hazard-warn', kind: 'lag', x: 0 },
    { type: 'hazard-hit', kind: 'drip', x: 0, y: 0 },
    { type: 'hazard-hit', kind: 'beam', x: 0, y: 0 },
    { type: 'hazard-hit', kind: 'lag', x: 0, y: 0 },
  ];

  for (const event of events) {
    const before = FakeAudioContext.created[0]?.oscillators.length ?? 0;
    board.handle([event]);
    assert.ok(contexts[0].oscillators.length > before, event.type);
  }

  const beforeMilestone = contexts[0].oscillators.length;
  board.handle([hit(5, 'opponent')]);
  assert.equal(contexts[0].oscillators.length - beforeMilestone, 5);

  // A Multiball ball's return sounds like a hit, but is no fifth hit of the rally.
  const beforeExtra = contexts[0].oscillators.length;
  board.handle([{ ...hit(5, 'opponent'), extra: true }]);
  assert.equal(contexts[0].oscillators.length - beforeExtra, 2);
});

test('supers sound off: a meter filling, each super its own way, a swerve and a save', () => {
  const { board, contexts } = setup();
  const count = (events) => {
    const before = contexts[0]?.oscillators.length ?? 0;
    board.handle(events);
    return contexts[0].oscillators.length - before;
  };
  const plain = count([hit(1)]);
  const kinds = ['fireball', 'zigzag', 'phantom', 'thunder'].map((kind) => {
    const before = contexts[0].oscillators.length;
    board.handle([{ ...hit(1), super: kind }]);
    return contexts[0].oscillators.slice(before + plain).map((oscillator) => `${oscillator.type}@${oscillator.frequency.events[0][1]}`).join(' ');
  });

  assert.equal(new Set(kinds).size, 4, 'each super sounds different');
  assert.ok(kinds.every((sound) => sound.length > 0));
  assert.ok(count([{ ...hit(1), saved: 'zigzag' }]) > plain, 'a save clangs');
  assert.equal(count([{ type: 'super-ready', side: 'player', kind: 'zigzag' }]), 4);
  assert.equal(count([{ type: 'super-ready', side: 'opponent', kind: 'zigzag' }]), 3);
  assert.equal(count([{ type: 'super-swerve', x: 0, y: 0 }]), 1);
});

test('sound effects and music share one audio context', () => {
  FakeAudioContext.created = [];
  const audio = new AudioOutput({ AudioContext: FakeAudioContext });
  const preferences = { get: () => ({ sound: true, music: true }) };
  const board = new SoundBoard({ audio, preferences });
  const music = new MusicPlayer({ audio, timers: { setInterval: () => 1, clearInterval: () => {} }, preferences });

  board.handle([{ type: 'match-start' }]);
  music.handle([{ type: 'match-start' }], { phase: 'running' });

  assert.equal(FakeAudioContext.created.length, 1);
  assert.strictEqual(board.context, music.context);
});

test('the finisher lands with a crunch on top of the fanfare, only where a finisher plays', () => {
  const won = { type: 'game-over', winner: 'player' };
  const lost = { type: 'game-over', winner: 'opponent' };
  // A match whose seed draws a finisher that crunches, not a comic one.
  const seed = seedFor((finisher) => finisher.kind === 'shatter');
  const over = { ...createInitialState(GAME_CONFIG, 1), seed, score: { player: 7, opponent: 3 } };
  // A null state stands for none at all.
  const count = (options, event, config, state = over) => {
    const { board, contexts } = setup(options);
    board.handle([event], state ?? undefined, config);
    return contexts[0].oscillators.length;
  };

  const fanfare = count({ jokes: false }, won, GAME_CONFIG);
  assert.equal(count({ jokes: true }, won, GAME_CONFIG), fanfare + 2);
  assert.equal(count({ jokes: true }, lost, GAME_CONFIG), count({ jokes: false }, lost, GAME_CONFIG));
  assert.equal(count({ jokes: true }, lost, RUSH_CONFIG), count({ jokes: false }, lost, RUSH_CONFIG));
  assert.equal(count({ jokes: true }, won, undefined), fanfare, 'without the match config it cannot tell, so it stays quiet');
  assert.equal(count({ jokes: true }, won, GAME_CONFIG, null), fanfare, 'nor without the final state');
});

test('a super\'s finisher sounds the super again, and the comic ones sob or snore instead of crunching', () => {
  const won = { type: 'game-over', winner: 'player' };
  const sounds = (event, seed) => {
    const { board, contexts } = setup({ jokes: true });
    board.handle([event], { ...createInitialState(GAME_CONFIG, 1), seed, score: { player: 7, opponent: 2 } }, GAME_CONFIG);
    return contexts[0].oscillators.map((oscillator) => `${oscillator.type}@${oscillator.frequency.events[0][1]}`);
  };
  const plain = sounds(won, seedFor((finisher) => finisher.kind === 'shatter'));
  const superWin = sounds({ ...won, super: 'thunder' }, 1);
  const tiny = sounds(won, seedFor((finisher) => finisher.kind === 'tiny'));
  const snooze = sounds(won, seedFor((finisher) => finisher.kind === 'snooze'));

  assert.equal(superWin.length, plain.length + 2, 'thunder\'s crack and rumble after the crunch');
  assert.notDeepEqual(tiny, plain);
  assert.notDeepEqual(snooze, plain);
  assert.notDeepEqual(tiny, snooze);
});

test('the landlord laughs at every point it takes with the fun extras on, longer at the one that wins', () => {
  const landlord = RIVALS.at(-1).config;
  const point = { type: 'point', scorer: 'opponent', x: 250, y: 800 };
  const sounds = (events, { jokes = true, config = landlord, phase = 'running' } = {}) => {
    const { board, contexts } = setup({ jokes });
    board.handle(events, { ...createInitialState(config, 1), phase }, config);
    return contexts[0].oscillators.length;
  };
  const plain = sounds([point], { jokes: false });

  assert.equal(sounds([point]), plain + 3, 'ha, ha, ha');
  assert.equal(sounds([point], { phase: 'game-over' }), plain + 5);
  assert.equal(sounds([point], { config: RIVALS[8].config }), plain, 'no other rival laughs');
  assert.equal(sounds([{ ...point, scorer: 'player', y: 0 }]), sounds([{ ...point, scorer: 'player', y: 0 }], { jokes: false }));
});

test('the final boss rings a gong on the first serve and sounds a sting as it changes phase', () => {
  const landlord = RIVALS.at(-1).config;
  const count = (events, config, serveNumber = 0) => {
    const { board, contexts } = setup();
    board.handle(events, { ...createInitialState(config, 1), serveNumber }, config);
    return contexts[0].oscillators.length;
  };
  const serve = { type: 'serve', x: 250, y: 400 };

  assert.equal(count([serve], landlord), count([serve], GAME_CONFIG) + 2);
  assert.equal(count([serve], landlord, 2), count([serve], GAME_CONFIG, 2), 'only on the first serve');
  assert.equal(count([{ type: 'boss-phase', phase: 1 }], landlord), 4, 'a sweep and three notes');
  assert.equal(count([{ type: 'boss-phase', phase: 1 }], GAME_CONFIG), 0);
});

test('an EVICTALITY rumbles after the crunch', () => {
  const landlord = RIVALS.at(-1).config;
  const won = [{ type: 'game-over', winner: 'player' }];
  const over = { ...createInitialState(landlord, 1), phase: 'game-over', score: { player: 7, opponent: 3 } };
  const sounds = (jokes) => {
    const { board, contexts } = setup({ jokes });
    board.handle(won, over, landlord);
    return contexts[0].oscillators.length;
  };

  assert.equal(sounds(true), sounds(false) + 3, 'the crunch, and the building coming down');
});
