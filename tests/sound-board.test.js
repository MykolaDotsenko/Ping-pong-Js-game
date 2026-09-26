import test from 'node:test';
import assert from 'node:assert/strict';

import { SoundBoard } from '../src/adapters/sound-board.js';

function fakeParam() {
  const param = {
    value: 0,
    events: [],
    setValueAtTime(value, time) {
      param.events.push(['set', value, time]);
    },
    exponentialRampToValueAtTime(value, time) {
      param.events.push(['ramp', value, time]);
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
    this.resumes = 0;
    FakeAudioContext.created.push(this);
  }

  resume() {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  createGain() {
    const gain = { gain: fakeParam(), connections: [], connect: (node) => gain.connections.push(node) };
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

function setup({ sound = true, withAudio = true } = {}) {
  FakeAudioContext.created = [];
  const board = new SoundBoard({
    window: withAudio ? { AudioContext: FakeAudioContext } : {},
    preferences: { get: () => ({ sound }) },
  });
  return { board, contexts: FakeAudioContext.created };
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

test('every event type has a sound, and milestone rallies add a chime', () => {
  const { board, contexts } = setup();
  const events = [
    { type: 'serve', x: 0, y: 0 },
    { type: 'wall-bounce', x: 0, y: 0, speed: 400 },
    { type: 'point', scorer: 'player', x: 0, y: 0 },
    { type: 'point', scorer: 'opponent', x: 0, y: 0 },
    { type: 'game-over', winner: 'player' },
    { type: 'game-over', winner: 'opponent' },
    { type: 'paused' },
    { type: 'resumed' },
  ];

  for (const event of events) {
    const before = FakeAudioContext.created[0]?.oscillators.length ?? 0;
    board.handle([event]);
    assert.ok(contexts[0].oscillators.length > before, event.type);
  }

  const beforeMilestone = contexts[0].oscillators.length;
  board.handle([hit(5, 'opponent')]);
  assert.equal(contexts[0].oscillators.length - beforeMilestone, 5);
});
