/** @import { TrackId } from '../application/ports.js' */

/**
 * Original backing tracks for the music player, written as step sequences. A step is a
 * sixteenth note and a bar has 16 of them. Pitches are semitones above the track's root
 * frequency; null is a rest. Every part loops, so a pattern shorter than the whole track
 * repeats (a 16-step bass line plays in every bar).
 *
 * Each track has three layers that the player brings in as a rally grows: the bass (with the
 * kick) from the first hit, the chords (with the snare and hi-hat) at 3 hits and the lead
 * at 6.
 *
 * @typedef {object} TrackPart
 * @property {OscillatorType} wave
 * @property {number} volume peak gain of one note
 * @property {number} length how long a note sounds, in steps
 *
 * @typedef {object} MusicTrack
 * @property {TrackId} id
 * @property {string} label shown on the track button
 * @property {number} bpm
 * @property {number} root frequency in Hz that every pitch counts up from
 * @property {readonly number[]} bars each bar's root, in semitones; the loop is this many bars long
 * @property {TrackPart & { notes: readonly (number | null)[] }} bass one entry per step, above the bar's root
 * @property {TrackPart & { hits: string, chords: readonly (readonly number[])[] }} chord
 *   `x` in hits strikes the chord on that step; chords are intervals above the bar's root, one per bar
 * @property {TrackPart & { every: number, notes: readonly (number | null)[] }} lead
 *   a note every `every` steps, above the track's root (not the bar's), so a melody reads as written
 * @property {{ kick: string, snare: string, hat: string } | null} drums `x` plays that drum on that step
 */

const _ = null;

/** @type {readonly MusicTrack[]} */
export const MUSIC_TRACKS = Object.freeze([
  {
    // The game's first track: a four-bar loop in A minor (A, A, F, G).
    id: 'neon',
    label: 'Neon',
    bpm: 128,
    root: 110,
    bars: [0, 0, -4, -2],
    bass: { wave: 'sawtooth', volume: 0.16, length: 3.6, notes: [0, _, _, _, 0, _, _, _, 0, _, _, _, 0, _, _, _] },
    chord: { wave: 'triangle', volume: 0.05, length: 1.8, hits: '..x...x...x...x.', chords: [[12, 15, 19]] },
    lead: {
      wave: 'square',
      volume: 0.07,
      length: 1.7,
      every: 2,
      notes: [
        24, _, 27, 24, 31, _, 29, 27,
        24, _, 27, 29, 31, _, 36, 34,
        20, _, 23, 20, 25, _, 23, 20,
        18, _, 20, 22, 25, _, 22, _,
      ],
    },
    drums: null,
  },
  {
    // Arcade fighter techno in E minor at 140 bpm: four on the floor, a bouncing octave bass
    // and a sixteenth-note lead that runs up and down the chord.
    id: 'arena',
    label: 'Arena',
    bpm: 140,
    root: 82.41,
    bars: [0, 0, 3, -2],
    bass: { wave: 'sawtooth', volume: 0.14, length: 0.9, notes: [0, _, 12, 0, _, 0, 12, _, 0, _, 12, 0, 3, _, 12, 5] },
    chord: {
      wave: 'square',
      volume: 0.035,
      length: 0.8,
      hits: '...x..x....x..x.',
      chords: [[12, 15, 19], [12, 15, 19], [12, 16, 19], [12, 16, 19]],
    },
    lead: {
      wave: 'square',
      volume: 0.05,
      length: 0.9,
      every: 1,
      notes: [
        24, _, 27, _, 31, 29, 27, _, 24, _, 22, 24, _, 27, _, _,
        24, _, 27, _, 31, 29, 27, _, 34, _, 31, _, 29, 27, 29, _,
        27, _, 31, _, 34, _, 31, 29, 27, _, 26, 27, _, 31, _, _,
        26, _, 29, _, 34, _, 31, 29, 26, 24, 22, _, 24, _, 26, _,
      ],
    },
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' },
  },
  {
    // A big synth anthem in D minor at 118 bpm: held brass chords (Dm, F, C, G), a slow bass
    // and a heroic lead.
    id: 'anthem',
    label: 'Anthem',
    bpm: 118,
    root: 73.42,
    bars: [0, 3, -2, 5],
    bass: { wave: 'sawtooth', volume: 0.15, length: 3.5, notes: [0, _, _, _, _, _, 0, _, 12, _, _, _, 0, _, _, _] },
    chord: {
      wave: 'sawtooth',
      volume: 0.022,
      length: 7.6,
      hits: 'x.......x.......',
      chords: [[12, 15, 19, 24], [12, 16, 19, 24], [12, 16, 19, 24], [12, 16, 19, 24]],
    },
    lead: {
      wave: 'sawtooth',
      volume: 0.045,
      length: 1.9,
      every: 2,
      notes: [
        31, _, 31, 32, 34, _, 31, _,
        36, _, 34, 32, 31, _, 27, _,
        34, _, 31, 34, 38, _, 36, 34,
        29, _, 33, 34, 36, _, _, _,
      ],
    },
    drums: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: '................' },
  },
  {
    // Training-montage rock in C minor at 108 bpm: a chugging eighth-note bass, power-chord
    // stabs and a punchy horn line.
    id: 'contender',
    label: 'Contender',
    bpm: 108,
    root: 65.41,
    bars: [0, 3, 5, -2],
    bass: { wave: 'sawtooth', volume: 0.15, length: 1.3, notes: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 7, _] },
    chord: { wave: 'square', volume: 0.04, length: 1.6, hits: 'x.....x...x..x..', chords: [[12, 19, 24]] },
    lead: {
      wave: 'sawtooth',
      volume: 0.045,
      length: 1.5,
      every: 2,
      notes: [
        31, _, 31, 34, _, 31, 29, 27,
        27, _, 29, 31, _, 34, _, 31,
        29, _, 29, 32, _, 34, 32, 29,
        34, _, 36, 34, 31, _, 29, _,
      ],
    },
    drums: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  },
  {
    // Heavy industrial in E Phrygian at 124 bpm: a galloping low riff, crunching power chords,
    // a stomping kick and a cold, slow synth line on top.
    id: 'iron',
    label: 'Iron',
    bpm: 124,
    root: 82.41,
    bars: [0, 0, 1, -2],
    bass: { wave: 'sawtooth', volume: 0.16, length: 0.8, notes: [0, _, 0, 0, 0, _, 0, 0, 0, _, _, 12, 0, _, 10, _] },
    chord: { wave: 'sawtooth', volume: 0.05, length: 2.6, hits: 'x.....x.....x...', chords: [[0, 7, 12]] },
    lead: {
      wave: 'square',
      volume: 0.04,
      length: 3.5,
      every: 4,
      notes: [31, _, 32, _, 31, _, 27, _, 32, _, 31, 29, 34, _, 31, _],
    },
    drums: { kick: 'x.x...x.x.x...x.', snare: '....x.......x...', hat: 'x...x...x...x...' },
  },
]);

/**
 * @param {string | undefined} id
 * @returns {MusicTrack} the track with that id, or the first one
 */
export function findTrack(id) {
  return MUSIC_TRACKS.find((track) => track.id === id) ?? MUSIC_TRACKS[0];
}
