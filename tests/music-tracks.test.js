import test from 'node:test';
import assert from 'node:assert/strict';

import { TRACK_IDS } from '../src/application/ports.js';
import { MUSIC_TRACKS, findTrack } from '../src/adapters/music-tracks.js';

// The tracks are data, so a typo would only show up as a wrong note or a skipped beat. These
// checks keep every part in step with the loop and every note in a range a phone can play.

const STEPS_PER_BAR = 16;

test('every track id the preferences accept has a track, in the same order', () => {
  assert.deepEqual(MUSIC_TRACKS.map((track) => track.id), TRACK_IDS);
  assert.equal(new Set(MUSIC_TRACKS.map((track) => track.label)).size, MUSIC_TRACKS.length, 'labels are distinct');
});

test('every part loops evenly within its track', () => {
  for (const track of MUSIC_TRACKS) {
    const loop = STEPS_PER_BAR * track.bars.length;
    const patterns = [track.chord.hits, ...(track.drums ? Object.values(track.drums) : [])];

    assert.equal(loop % track.bass.notes.length, 0, `${track.id} bass`);
    assert.equal(loop % (track.lead.notes.length * track.lead.every), 0, `${track.id} lead`);
    assert.equal(track.bars.length % track.chord.chords.length, 0, `${track.id} chords`);

    for (const pattern of patterns) {
      assert.match(pattern, /^[x.]+$/, `${track.id} patterns use x and .`);
      assert.equal(loop % pattern.length, 0, `${track.id} pattern ${pattern}`);
    }
  }
});

test('every note lands between 30 Hz and 2 kHz and every part has a sensible sound', () => {
  for (const track of MUSIC_TRACKS) {
    const pitch = (semitones) => track.root * 2 ** (semitones / 12);
    const notes = [
      ...track.bars.flatMap((root) => track.bass.notes.filter((note) => note !== null).map((note) => pitch(root + note))),
      ...track.bars.flatMap((root) => track.chord.chords.flat().map((interval) => pitch(root + interval))),
      ...track.lead.notes.filter((note) => note !== null).map(pitch),
    ];

    for (const frequency of notes) {
      assert.ok(frequency >= 30 && frequency <= 2000, `${track.id}: ${frequency.toFixed(1)} Hz`);
    }

    for (const part of [track.bass, track.chord, track.lead]) {
      assert.ok(['sine', 'square', 'sawtooth', 'triangle'].includes(part.wave), track.id);
      assert.ok(part.volume > 0 && part.volume <= 0.2, `${track.id} volume`);
      assert.ok(part.length > 0, `${track.id} length`);
    }

    assert.ok(track.bpm >= 90 && track.bpm <= 160, `${track.id} tempo`);
  }
});

test('an unknown or missing track id falls back to the first track', () => {
  assert.equal(findTrack('iron').id, 'iron');
  assert.equal(findTrack('polka'), MUSIC_TRACKS[0]);
  assert.equal(findTrack(undefined), MUSIC_TRACKS[0]);
});
