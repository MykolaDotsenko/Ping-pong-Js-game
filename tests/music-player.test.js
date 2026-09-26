import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioOutput } from '../src/adapters/audio-output.js';
import { MusicPlayer } from '../src/adapters/music-player.js';

// A small Web Audio stand-in that records what the player schedules.
class FakeParam {
  constructor(value) {
    this.value = value;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.events.push(['set', value, time]);
    this.value = value;
  }

  linearRampToValueAtTime(value, time) {
    this.events.push(['ramp', value, time]);
    this.value = value;
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
    this.state = 'suspended';
    this.destination = new FakeNode();
    this.gains = [];
    this.oscillators = [];
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

function setup({ music = true, audio = true } = {}) {
  const contexts = [];
  const timers = new Map();
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
  };
  let values = { music };
  const preferences = { get: () => values, set: (changes) => { values = { ...values, ...changes }; } };
  const player = new MusicPlayer({ audio: new AudioOutput(window), timers: window, preferences });

  return { player, contexts, timers, preferences, context: () => contexts[0] };
}

const running = { phase: 'running' };
const events = (...types) => types.map((type) => ({ type }));
const hit = (rally) => ({ type: 'paddle-hit', side: 'player', x: 0, y: 0, speed: 500, spin: 0, offset: 0, rally });
const layerGain = (player, name) => player.layers[name].gain.value;

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
