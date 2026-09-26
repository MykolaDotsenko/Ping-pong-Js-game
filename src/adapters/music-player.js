import { GAME_PHASE } from '../domain/game.js';
import { findTrack } from './music-tracks.js';

/**
 * @import { GameEvent, GameState } from '../domain/types.js'
 * @import { FeedbackPort, PreferencesPort, TrackId } from '../application/ports.js'
 * @import { AudioOutput } from './audio-output.js'
 * @import { MusicTrack } from './music-tracks.js'
 */

const STEPS_PER_BAR = 16;
const FADE_SECONDS = 0.6;
const LOOKAHEAD_SECONDS = 0.25;
const SCHEDULE_INTERVAL_MS = 80;
/** A preview plays the full arrangement for about two bars, then fades out. */
const PREVIEW_MS = 4000;
const PREVIEW_RALLY = 6;
const NOISE_SECONDS = 0.5;
/** Peak gains of the synthesized drums. */
const DRUM_GAIN = Object.freeze({ kick: 0.16, snare: 0.07, hat: 0.03 });

/**
 * @typedef {'bass' | 'chord' | 'lead'} Layer
 * @typedef {object} Timers
 * @property {typeof setInterval} setInterval
 * @property {typeof clearInterval} clearInterval
 * @property {typeof setTimeout} setTimeout
 * @property {typeof clearTimeout} clearTimeout
 */

/**
 * @param {string} pattern
 * @param {number} step
 */
const strikes = (pattern, step) => pattern[step % pattern.length] === 'x';

/**
 * A synthesized backing track that builds with the rally: bass and kick alone at first, the
 * chords with snare and hi-hat from a short rally on, and the lead once the rally is long.
 * It fades out on pause and stops at the menu, and it can be switched off separately from
 * the sound effects. The player picks one of several tracks; choosing one in a menu plays a
 * short preview.
 *
 * @implements {FeedbackPort}
 */
export class MusicPlayer {
  /**
   * @param {object} options
   * @param {AudioOutput} options.audio the audio context shared with the sound effects
   * @param {Timers} options.timers
   * @param {PreferencesPort} options.preferences
   */
  constructor({ audio, timers, preferences }) {
    this.audio = audio;
    this.timers = timers;
    this.preferences = preferences;
    /** @type {AudioContext | null} */
    this.context = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {Record<Layer, GainNode> | null} */
    this.layers = null;
    /** @type {AudioBuffer | null} */
    this.noise = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.timer = null;
    /** @type {MusicTrack} */
    this.track = findTrack(preferences.get().track);
    this.nextStepTime = 0;
    this.step = 0;
    this.intensity = 0;
    this.playing = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.previewTimer = null;
    this.rallyBeforePreview = 0;
  }

  get enabled() {
    return this.preferences.get().music;
  }

  get previewing() {
    return this.previewTimer !== null;
  }

  /**
   * @param {readonly GameEvent[]} events
   * @param {GameState} state
   */
  handle(events, state) {
    for (const event of events) {
      switch (event.type) {
        case 'match-start':
          this.endPreview();
          // A new match starts from the top, with the bass alone, whatever came before.
          this.setIntensity(0, 0);
          if (!this.playing) this.step = 0;
          this.start();
          break;
        case 'resumed':
          this.endPreview();
          this.start();
          break;
        case 'menu':
          this.endPreview();
          this.setIntensity(0, 0);
          this.stop();
          break;
        case 'paused':
        case 'game-over':
          this.endPreview();
          this.stop();
          break;
        case 'paddle-hit':
          this.setIntensity(event.rally);
          break;
        case 'point':
          this.setIntensity(0);
          break;
        default:
          break;
      }
    }

    // A change to the music switch takes effect at the next event, without a restart.
    if (state.phase === GAME_PHASE.RUNNING && this.playing !== this.enabled) {
      if (this.enabled) this.start();
      else this.stop();
    }
  }

  /**
   * Plays a few seconds of a track with every layer in, so a player can hear what they
   * picked. Music of a match in progress is never cut short for it.
   *
   * @param {TrackId} id
   */
  preview(id) {
    if ((this.playing && !this.previewing) || !this.enabled) {
      return;
    }

    this.endPreview();

    if (!this.ensureContext()) {
      return;
    }

    this.useTrack(id);
    this.step = 0;
    this.rallyBeforePreview = this.intensity;
    this.setIntensity(PREVIEW_RALLY, 0);
    // Set before start(), which otherwise switches to the track saved in the preferences.
    this.previewTimer = this.timers.setTimeout(() => this.endPreview(), PREVIEW_MS);
    this.start();
  }

  endPreview() {
    if (this.previewTimer === null) {
      return;
    }

    this.timers.clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.stop();
    this.setIntensity(this.rallyBeforePreview);
  }

  /**
   * Switches to a track; a different one starts from its first bar.
   *
   * @param {TrackId | undefined} id
   */
  useTrack(id) {
    const track = findTrack(id);

    if (track !== this.track) {
      this.track = track;
      this.step = 0;
    }
  }

  get stepSeconds() {
    return 60 / this.track.bpm / 4;
  }

  /** @returns {boolean} whether the audio graph is ready */
  ensureContext() {
    const context = this.audio.acquire();

    if (!context) {
      return false;
    }

    if (!this.master) {
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = 0;
      this.master.connect(context.destination);
      this.layers = { bass: context.createGain(), chord: context.createGain(), lead: context.createGain() };

      for (const [name, gain] of Object.entries(this.layers)) {
        gain.gain.value = name === 'bass' ? 1 : 0;
        gain.connect(this.master);
      }
    }

    return true;
  }

  start() {
    if (this.playing || !this.enabled || !this.ensureContext()) {
      return;
    }

    if (!this.previewing) {
      this.useTrack(this.preferences.get().track);
    }

    const context = /** @type {AudioContext} */ (this.context);
    const master = /** @type {GainNode} */ (this.master);

    this.playing = true;
    this.nextStepTime = context.currentTime + 0.05;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setValueAtTime(master.gain.value, context.currentTime);
    master.gain.linearRampToValueAtTime(1, context.currentTime + FADE_SECONDS);
    this.timer = this.timers.setInterval(() => this.schedule(), SCHEDULE_INTERVAL_MS);
    this.schedule();
  }

  stop() {
    if (!this.playing) {
      return;
    }

    const context = /** @type {AudioContext} */ (this.context);
    const master = /** @type {GainNode} */ (this.master);

    this.playing = false;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setValueAtTime(master.gain.value, context.currentTime);
    master.gain.linearRampToValueAtTime(0, context.currentTime + FADE_SECONDS);

    if (this.timer !== null) {
      this.timers.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Brings layers in as the rally grows: the chords at 3 hits, the lead at 6.
   *
   * @param {number} rally
   * @param {number} [rampSeconds] how long the layers take to reach their new level
   */
  setIntensity(rally, rampSeconds = 0.4) {
    this.intensity = rally;

    if (!this.layers || !this.context) {
      return;
    }

    const now = this.context.currentTime;
    const target = { chord: rally >= 3 ? 1 : 0, lead: rally >= 6 ? 1 : 0 };

    for (const name of /** @type {const} */ (['chord', 'lead'])) {
      const gain = this.layers[name].gain;
      gain.cancelScheduledValues(now);

      if (rampSeconds > 0) {
        gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(target[name], now + rampSeconds);
      } else {
        gain.setValueAtTime(target[name], now);
      }
    }
  }

  // Schedules every step that falls inside the lookahead window, so timing stays exact even
  // when the interval timer is late.
  schedule() {
    const context = /** @type {AudioContext} */ (this.context);

    while (this.nextStepTime < context.currentTime + LOOKAHEAD_SECONDS) {
      this.playStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % (STEPS_PER_BAR * this.track.bars.length);
      this.nextStepTime += this.stepSeconds;
    }
  }

  /**
   * @param {number} step
   * @param {number} time
   */
  playStep(step, time) {
    const { root, bars, bass, chord, lead, drums } = this.track;
    const bar = Math.floor(step / STEPS_PER_BAR) % bars.length;
    const barRoot = bars[bar];
    /** @param {number} semitones */
    const pitch = (semitones) => root * 2 ** (semitones / 12);
    const seconds = this.stepSeconds;
    const bassNote = bass.notes[step % bass.notes.length];

    if (bassNote !== null) {
      this.tone('bass', pitch(barRoot + bassNote), time, seconds * bass.length, bass.wave, bass.volume);
    }

    if (strikes(chord.hits, step)) {
      for (const interval of chord.chords[bar % chord.chords.length]) {
        this.tone('chord', pitch(barRoot + interval), time, seconds * chord.length, chord.wave, chord.volume);
      }
    }

    if (step % lead.every === 0) {
      const note = lead.notes[Math.floor(step / lead.every) % lead.notes.length];

      if (note !== null) {
        this.tone('lead', pitch(note), time, seconds * lead.length, lead.wave, lead.volume);
      }
    }

    if (drums) {
      if (strikes(drums.kick, step)) this.kick(time);
      if (strikes(drums.snare, step)) this.snare(time);
      if (strikes(drums.hat, step)) this.hat(time);
    }
  }

  /**
   * An envelope that rises in 10 ms and dies away over the duration, feeding a layer.
   *
   * @param {Layer} layer
   * @param {number} start
   * @param {number} duration
   * @param {number} volume
   */
  envelope(layer, start, duration, volume) {
    const context = /** @type {AudioContext} */ (this.context);
    const layers = /** @type {NonNullable<typeof this.layers>} */ (this.layers);
    const envelope = context.createGain();

    // A new gain node passes sound at full level until its first scheduled value. A source
    // that starts a sample early would click at full volume, so it starts silent instead.
    envelope.gain.value = 0.0001;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    envelope.connect(layers[layer]);
    return envelope;
  }

  /**
   * @param {Layer} layer
   * @param {number} frequency
   * @param {number} start
   * @param {number} duration
   * @param {OscillatorType} type
   * @param {number} volume
   */
  tone(layer, frequency, start, duration, type, volume) {
    const oscillator = /** @type {AudioContext} */ (this.context).createOscillator();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.connect(this.envelope(layer, start, duration, volume));
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  /**
   * A falling sine thump, on the bass layer so the beat is there from the first hit.
   *
   * @param {number} time
   */
  kick(time) {
    const oscillator = /** @type {AudioContext} */ (this.context).createOscillator();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(150, time);
    oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    oscillator.connect(this.envelope('bass', time, 0.22, DRUM_GAIN.kick));
    oscillator.start(time);
    oscillator.stop(time + 0.24);
  }

  /** @param {number} time */
  snare(time) {
    this.burst(time, 1500, 0.14, DRUM_GAIN.snare);
    this.tone('chord', 190, time, 0.08, 'triangle', DRUM_GAIN.snare * 0.7);
  }

  /** @param {number} time */
  hat(time) {
    this.burst(time, 7000, 0.04, DRUM_GAIN.hat);
  }

  /**
   * High-passed white noise, for the snare's rattle and the hi-hat. Both join with the chords.
   *
   * @param {number} time
   * @param {number} cutoff
   * @param {number} duration
   * @param {number} volume
   */
  burst(time, cutoff, duration, volume) {
    const context = /** @type {AudioContext} */ (this.context);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();

    source.buffer = this.whiteNoise();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(cutoff, time);
    source.connect(filter);
    filter.connect(this.envelope('chord', time, duration, volume));
    source.start(time);
    source.stop(time + duration + 0.02);
  }

  /** @returns {AudioBuffer} half a second of noise, made once and reused by every drum hit */
  whiteNoise() {
    if (!this.noise) {
      const context = /** @type {AudioContext} */ (this.context);
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * NOISE_SECONDS), context.sampleRate);
      const samples = buffer.getChannelData(0);

      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = Math.random() * 2 - 1;
      }

      this.noise = buffer;
    }

    return this.noise;
  }
}
