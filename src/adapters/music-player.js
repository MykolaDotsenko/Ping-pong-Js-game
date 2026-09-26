/**
 * @import { GameEvent, GameState } from '../domain/types.js'
 * @import { FeedbackPort, PreferencesPort } from '../application/ports.js'
 */

// A four-bar loop in A minor: bass on the root, a pulsing chord and a lead line that only
// joins once the rally heats up. Steps are sixteenths at 128 bpm.
const BPM = 128;
const STEPS_PER_BAR = 16;
const BARS = 4;
const STEP_SECONDS = 60 / BPM / 4;
const A2 = 110;

/** Semitone offsets from A2 for each bar's bass note. */
const BASS_LINE = [0, 0, -4, -2]; // A, A, F, G
/** Chord tones over each bar, as semitones from the bar's bass. */
const CHORD = [12, 15, 19]; // root, minor third, fifth, an octave up
/** The lead melody, one note per eighth, with null for rests. */
const LEAD = [12, null, 15, 12, 19, null, 17, 15, 12, null, 15, 17, 19, null, 24, 22, 12, null, 15, 12, 17, null, 15, 12, 8, null, 10, 12, 15, null, 12, null];

const LAYER_GAIN = Object.freeze({ bass: 0.16, chord: 0.05, lead: 0.07 });
const FADE_SECONDS = 0.6;
const LOOKAHEAD_SECONDS = 0.25;
const SCHEDULE_INTERVAL_MS = 80;

/** @param {number} semitones */
const pitch = (semitones) => A2 * 2 ** (semitones / 12);

/**
 * A synthesized backing track that builds with the rally: bass alone at first, the chord
 * layer from a short rally on, and the lead line once the rally is long. It fades out on
 * pause and stops at the menu, and it can be switched off separately from the sound effects.
 *
 * @implements {FeedbackPort}
 */
export class MusicPlayer {
  /**
   * @param {object} options
   * @param {{ AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext, setInterval: typeof setInterval, clearInterval: typeof clearInterval }} options.window
   * @param {PreferencesPort} options.preferences
   */
  constructor({ window, preferences }) {
    this.window = window;
    this.preferences = preferences;
    /** @type {AudioContext | null} */
    this.context = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {Record<'bass' | 'chord' | 'lead', GainNode> | null} */
    this.layers = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.timer = null;
    this.nextStepTime = 0;
    this.step = 0;
    this.intensity = 0;
    this.playing = false;
  }

  get enabled() {
    return this.preferences.get().music;
  }

  /**
   * @param {readonly GameEvent[]} events
   * @param {GameState} state
   */
  handle(events, state) {
    for (const event of events) {
      switch (event.type) {
        case 'match-start':
          // A new match starts from the bass alone, whatever the last rally built up to.
          this.setIntensity(0, 0);
          this.start();
          break;
        case 'resumed':
          this.start();
          break;
        case 'menu':
          this.setIntensity(0, 0);
          this.stop();
          break;
        case 'paused':
        case 'game-over':
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
    if (state.phase === 'running' && this.playing !== this.enabled) {
      if (this.enabled) this.start();
      else this.stop();
    }
  }

  /** @returns {boolean} whether the audio graph is ready */
  ensureContext() {
    if (!this.context) {
      const AudioContextClass = this.window.AudioContext ?? this.window.webkitAudioContext;

      if (!AudioContextClass) {
        return false;
      }

      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      this.layers = { bass: this.context.createGain(), chord: this.context.createGain(), lead: this.context.createGain() };

      for (const [name, gain] of Object.entries(this.layers)) {
        gain.gain.value = name === 'bass' ? 1 : 0;
        gain.connect(this.master);
      }
    }

    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }

    return true;
  }

  start() {
    if (this.playing || !this.enabled || !this.ensureContext()) {
      return;
    }

    const context = /** @type {AudioContext} */ (this.context);
    const master = /** @type {GainNode} */ (this.master);

    this.playing = true;
    this.nextStepTime = context.currentTime + 0.05;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setValueAtTime(master.gain.value, context.currentTime);
    master.gain.linearRampToValueAtTime(1, context.currentTime + FADE_SECONDS);
    this.timer = this.window.setInterval(() => this.schedule(), SCHEDULE_INTERVAL_MS);
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
      this.window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Brings layers in as the rally grows: the chord at 3 hits, the lead at 6.
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
      this.step = (this.step + 1) % (STEPS_PER_BAR * BARS);
      this.nextStepTime += STEP_SECONDS;
    }
  }

  /**
   * @param {number} step
   * @param {number} time
   */
  playStep(step, time) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const inBar = step % STEPS_PER_BAR;
    const bass = BASS_LINE[bar];

    if (inBar % 4 === 0) {
      this.tone('bass', pitch(bass), time, STEP_SECONDS * 3.6, 'sawtooth', LAYER_GAIN.bass);
    }

    if (inBar % 4 === 2) {
      for (const interval of CHORD) {
        this.tone('chord', pitch(bass + interval), time, STEP_SECONDS * 1.8, 'triangle', LAYER_GAIN.chord);
      }
    }

    if (inBar % 2 === 0) {
      const note = LEAD[Math.floor(step / 2) % LEAD.length];

      if (note !== null) {
        this.tone('lead', pitch(bass + note + 12), time, STEP_SECONDS * 1.7, 'square', LAYER_GAIN.lead);
      }
    }
  }

  /**
   * @param {'bass' | 'chord' | 'lead'} layer
   * @param {number} frequency
   * @param {number} start
   * @param {number} duration
   * @param {OscillatorType} type
   * @param {number} volume
   */
  tone(layer, frequency, start, duration, type, volume) {
    const context = /** @type {AudioContext} */ (this.context);
    const layers = /** @type {NonNullable<typeof this.layers>} */ (this.layers);
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(layers[layer]);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
}
