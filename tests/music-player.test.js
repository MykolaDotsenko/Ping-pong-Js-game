import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioOutput } from '../src/adapters/audio-output.js';
import { MusicPlayer } from '../src/adapters/music-player.js';

// A small Web Audio stand-in that records what the player schedules.
class FakeParam {
  constructor(value) {
    this.current = value;
    this.events = [];
  }

  get value() {
    return this.current;
  }

  // Setting the value directly is recorded too: it is the level before any scheduled change.
  set value(value) {
    this.events.push(['assign', value]);
    this.current = value;
  }

  setValueAtTime(value, time) {
    this.events.push(['set', value, time]);
    this.current = value;
  }

  linearRampToValueAtTime(value, time) {
    this.events.push(['ramp', value, time]);
    this.current = value;
  }

  exponentialRampToValueAtTime(value, time) {
    this.events.push(['exponential', value, time]);
  }

  cancelScheduledValues(time) {
    this.events.push(['cancel', time]);
  }
}

class FakeNode {
  constructor() {
    this.outputs = [];
  }

  connect(node) {
    this.outputs.push(node);
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'suspended';
    this.destination = new FakeNode();
    this.gains = [];
    this.oscillators = [];
    this.buffers = [];
    this.noiseSources = [];
    this.filters = [];
  }

  createBuffer(channels, length, sampleRate) {
    const data = new Float32Array(length);
    const buffer = { channels, length, sampleRate, getChannelData: () => data };
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource() {
    const source = Object.assign(new FakeNode(), {
      buffer: null,
      start(time) {
        this.startedAt = time;
      },
      stop(time) {
        this.stoppedAt = time;
      },
    });
    this.noiseSources.push(source);
    return source;
  }

  createBiquadFilter() {
    const filter = Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(350) });
    this.filters.push(filter);
    return filter;
  }

  createGain() {
    const gain = Object.assign(new FakeNode(), { gain: new FakeParam(1) });
    this.gains.push(gain);
    return gain;
  }

  createOscillator() {
    const oscillator = Object.assign(new FakeNode(), {
      type: 'sine',
      frequency: new FakeParam(440),
      start(time) {
        this.startedAt = time;
      },
      stop(time) {
        this.stoppedAt = time;
      },
    });
    this.oscillators.push(oscillator);
    return oscillator;
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

function setup({ music = true, audio = true, track } = {}) {
  const contexts = [];
  const timers = new Map();
  const timeouts = new Map();
  let nextTimer = 1;
  const window = {
    ...(audio && {
      AudioContext: class extends FakeAudioContext {
        constructor() {
          super();
          contexts.push(this);
        }
      },
    }),
    setInterval(callback, ms) {
      timers.set(nextTimer, { callback, ms });
      return nextTimer++;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    setTimeout(callback, ms) {
      timeouts.set(nextTimer, { callback, ms });
      return nextTimer++;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
  };
  let values = { music, ...(track && { track }) };
  const preferences = { get: () => values, set: (changes) => { values = { ...values, ...changes }; } };
  const player = new MusicPlayer({ audio: new AudioOutput(window), timers: window, preferences });

  return { player, contexts, timers, timeouts, preferences, context: () => contexts[0] };
}

const running = { phase: 'running' };
const events = (...types) => types.map((type) => ({ type }));
const hit = (rally) => ({ type: 'paddle-hit', side: 'player', x: 0, y: 0, speed: 500, spin: 0, offset: 0, rally });
const layerGain = (player, name) => player.layers[name].gain.value;
const frequenciesAt = (context, time) =>
  context.oscillators.filter((oscillator) => oscillator.startedAt === time).map((oscillator) => Math.round(oscillator.frequency.value));

test('music starts with the match: the bass fades in and a scheduler keeps notes queued ahead', () => {
  const { player, timers, context } = setup();

  player.handle(events('match-start'), running);

  assert.equal(player.playing, true);
  assert.equal(context().state, 'running', 'resumed after the tap that started the match');
  assert.deepEqual(player.master.gain.events.at(-1)[0], 'ramp');
  assert.equal(player.master.gain.value, 1);
  assert.equal(timers.size, 1);
  assert.ok(context().oscillators.length > 0, 'the first notes are already scheduled');
  assert.ok(context().oscillators.every((oscillator) => oscillator.startedAt < 0.25 + 0.05 + 1e-9), 'within the lookahead');
});

test('the scheduler catches up after a late timer, so the beat never drifts', () => {
  const { player, timers, context } = setup();

  player.handle(events('match-start'), running);
  const before = context().oscillators.length;
  context().currentTime = 2;
  timers.values().next().value.callback();

  const latest = Math.max(...context().oscillators.map((oscillator) => oscillator.startedAt));
  assert.ok(context().oscillators.length > before);
  assert.ok(latest >= 2 && latest < 2.25 + 1e-9);
});

test('music fades out on pause, at the menu and when the match ends, and comes back on resume', () => {
  const phaseAfter = { paused: 'paused', menu: 'ready', 'game-over': 'game-over' };

  for (const stop of ['paused', 'menu', 'game-over']) {
    const { player, timers } = setup();

    player.handle(events('match-start'), running);
    player.handle(events(stop), { phase: phaseAfter[stop] });
    assert.equal(player.playing, false, stop);
    assert.equal(player.master.gain.value, 0, stop);
    assert.equal(timers.size, 0, `${stop} clears the scheduler`);
  }

  const { player } = setup();
  player.handle(events('match-start'), running);
  player.handle(events('paused'), { phase: 'paused' });
  player.handle(events('resumed'), running);
  assert.equal(player.playing, true);
});

test('layers join as the rally grows and leave when a point ends it', () => {
  const { player } = setup();

  player.handle(events('match-start'), running);
  player.handle([hit(2)], running);
  assert.deepEqual([layerGain(player, 'chord'), layerGain(player, 'lead')], [0, 0]);

  player.handle([hit(3)], running);
  assert.deepEqual([layerGain(player, 'chord'), layerGain(player, 'lead')], [1, 0]);

  player.handle([hit(6)], running);
  assert.deepEqual([layerGain(player, 'chord'), layerGain(player, 'lead')], [1, 1]);

  player.handle(events('point'), running);
  assert.deepEqual([layerGain(player, 'chord'), layerGain(player, 'lead')], [0, 0]);
});

test('a new match starts from the bass alone, even when the last one was left mid-rally', () => {
  const { player } = setup();

  player.handle(events('match-start'), running);
  player.handle([hit(9)], running);
  // Restart in the middle of that long rally.
  player.handle(events('match-start'), running);

  assert.deepEqual([layerGain(player, 'chord'), layerGain(player, 'lead')], [0, 0]);
  assert.deepEqual(player.layers.chord.gain.events.at(-1)[0], 'set', 'at once, not faded over the countdown');
});

test('turning music off or on during a match takes effect at the next event', () => {
  const { player, preferences } = setup();

  player.handle(events('match-start'), running);
  preferences.set({ music: false });
  player.handle([hit(1)], running);
  assert.equal(player.playing, false);

  preferences.set({ music: true });
  player.handle([hit(2)], running);
  assert.equal(player.playing, true);
});

test('with music off, or without Web Audio, nothing is created and nothing breaks', () => {
  const off = setup({ music: false });
  off.player.handle(events('match-start'), running);
  assert.equal(off.contexts.length, 0);

  const silent = setup({ audio: false });
  silent.player.handle([...events('match-start'), hit(4), ...events('paused')], running);
  assert.equal(silent.player.playing, false);
});

test('the first track still opens as it always has: an A2 bass under an A4 lead', () => {
  const { player, context } = setup();

  player.handle(events('match-start'), running);

  assert.deepEqual(frequenciesAt(context(), 0.05).sort((a, b) => a - b), [110, 440]);
  assert.equal(context().noiseSources.length, 0, 'no drums on Neon');
});

test('each track plays at its own tempo, from the track saved in the preferences', () => {
  for (const [track, bpm] of [['neon', 128], ['arena', 140], ['anthem', 118], ['contender', 108], ['iron', 124]]) {
    const { player } = setup({ track });

    player.handle(events('match-start'), running);
    const scheduled = (player.nextStepTime - 0.05) / player.step;

    assert.equal(player.track.id, track);
    assert.ok(Math.abs(scheduled - 60 / bpm / 4) < 1e-9, `${track} steps are sixteenths at ${bpm} bpm`);
  }
});

test('drum tracks lay a kick under the bass and noise snares and hi-hats under the chords', () => {
  const { player, context } = setup({ track: 'arena' });

  player.handle(events('match-start'), running);
  context().currentTime = 1.5;
  player.schedule();

  const kicks = context().oscillators.filter((oscillator) => oscillator.frequency.events.some(([kind, value]) => kind === 'exponential' && value === 45));
  const cutoffs = new Set(context().filters.map((filter) => filter.frequency.value));

  assert.ok(kicks.length >= 3, 'four on the floor');
  assert.ok(cutoffs.has(1500) && cutoffs.has(7000), 'both the snare and the hi-hat played');
  assert.equal(context().buffers.length, 1, 'one noise buffer, reused by every hit');
  assert.ok(context().noiseSources.every((source) => source.buffer === context().buffers[0]));
  assert.ok(context().buffers[0].getChannelData(0).some((sample) => sample !== 0), 'filled with noise');
});

test('every note and drum hit starts silent, so a source starting a sample early cannot click', () => {
  const { player, context } = setup({ track: 'contender' });

  player.handle(events('match-start'), running);
  context().currentTime = 2;
  player.schedule();

  // The first gains are the master and the three layers; every later one is a note's envelope.
  const envelopes = context().gains.slice(4);
  assert.ok(envelopes.length > 20);
  assert.ok(envelopes.every((gain) => gain.gain.events[0][0] === 'assign' && gain.gain.events[0][1] === 0.0001));
});

test('a track changed during a pause plays from its first bar on resume', () => {
  const { player, preferences } = setup();

  player.handle(events('match-start'), running);
  player.handle(events('paused'), { phase: 'paused' });
  preferences.set({ track: 'iron' });
  player.handle(events('resumed'), running);

  assert.equal(player.track.id, 'iron');
  assert.ok(player.step < 16, 'started over at the top of the loop');
});

test('a preview plays a few seconds of a track with every layer in, then fades out', () => {
  const { player, timeouts } = setup();

  player.preview('contender');

  assert.equal(player.playing, true);
  assert.equal(player.track.id, 'contender');
  assert.deepEqual([layerGain(player, 'chord'), layerGain(player, 'lead')], [1, 1]);
  assert.equal(timeouts.size, 1);

  timeouts.values().next().value.callback();

  assert.equal(player.playing, false);
  assert.equal(player.master.gain.value, 0);
  assert.deepEqual([layerGain(player, 'chord'), layerGain(player, 'lead')], [0, 0], 'back to where the rally was');
});

test('picking tracks in a row restarts the preview instead of stacking them', () => {
  const { player, timers, timeouts } = setup();

  player.preview('arena');
  player.preview('anthem');

  assert.equal(player.track.id, 'anthem');
  assert.equal(timers.size, 1, 'one scheduler');
  assert.equal(timeouts.size, 1, 'one pending fade-out');
});

test('a match that starts during a preview ends it and plays the saved track', () => {
  const { player, timeouts, preferences } = setup({ track: 'anthem' });

  player.preview('iron');
  player.handle(events('match-start'), running);

  assert.equal(timeouts.size, 0);
  assert.equal(player.playing, true);
  assert.equal(player.track.id, preferences.get().track);
  assert.deepEqual([layerGain(player, 'chord'), layerGain(player, 'lead')], [0, 0]);
});

test('a preview never cuts into the music of a match, and stays silent with music off', () => {
  const live = setup();
  live.player.handle(events('match-start'), running);
  live.player.preview('iron');
  assert.equal(live.player.track.id, 'neon');
  assert.equal(live.timeouts.size, 0);

  const off = setup({ music: false });
  off.player.preview('iron');
  assert.equal(off.contexts.length, 0);

  const silent = setup({ audio: false });
  silent.player.preview('iron');
  assert.equal(silent.player.playing, false);
  assert.equal(silent.timeouts.size, 0);
});

test('the loop moves through all its bars before it repeats', () => {
  const { player, context } = setup();

  player.handle(events('match-start'), running);
  // Neon's third bar drops to F: 110 Hz four semitones down. It starts 32 steps in.
  context().currentTime = 32 * (60 / 128 / 4);
  player.schedule();

  assert.ok(context().oscillators.some((oscillator) => Math.abs(oscillator.frequency.value - 110 * 2 ** (-4 / 12)) < 1e-6));
  assert.ok(player.step < 64);
});

test('each bar plays its own chord: Arena turns major in its second half', () => {
  const { player, context } = setup({ track: 'arena' });
  const { root, bars } = player.track;
  const stepSeconds = 60 / 140 / 4;
  // Step 35 is the first chord of the third bar, over G: the bass on G and a G major chord.
  const at = 0.05 + 35 * stepSeconds;
  const semitones = (frequency) => Math.round(12 * Math.log2(frequency / root)) - bars[2];

  player.handle(events('match-start'), running);
  context().currentTime = at;
  player.schedule();

  const struck = context().oscillators.filter((oscillator) => Math.abs(oscillator.startedAt - at) < 1e-6);
  assert.deepEqual(struck.map((oscillator) => semitones(oscillator.frequency.value)).sort((a, b) => a - b), [0, 12, 16, 19]);
});

test('resuming a match during a preview ends it and goes back to the saved track', () => {
  const { player, timeouts, preferences } = setup({ track: 'anthem' });

  player.handle(events('match-start'), running);
  player.handle(events('paused'), { phase: 'paused' });
  player.preview('iron');
  player.handle(events('resumed'), running);

  assert.equal(timeouts.size, 0, 'no fade-out left to cut the match music');
  assert.equal(player.playing, true);
  assert.equal(player.track.id, preferences.get().track);
});
