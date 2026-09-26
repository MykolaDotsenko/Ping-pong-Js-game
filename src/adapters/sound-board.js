/**
 * @import { GameEvent } from '../domain/types.js'
 * @import { FeedbackPort, PreferencesPort } from '../application/ports.js'
 */

// Equal-tempered note frequencies in Hz.
const NOTE = Object.freeze({
  C4: 261.63,
  E4: 329.63,
  G4: 392,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  C6: 1046.5,
  E6: 1318.51,
  G6: 1567.98,
});

const MASTER_VOLUME = 0.28;

/**
 * @typedef {object} Tone
 * @property {number} frequency start frequency in Hz
 * @property {number} [endFrequency] frequency reached by the end, for sweeps
 * @property {number} duration seconds
 * @property {OscillatorType} type
 * @property {number} volume peak gain, from 0 to 1
 * @property {number} [delay] seconds from now
 */

/**
 * Synthesized arcade sound effects: every sound is built from oscillators at play time, so
 * there are no audio files to load. The audio context is created on the first event, which
 * always follows a click or key press, as browsers require before playing sound.
 *
 * @implements {FeedbackPort}
 */
export class SoundBoard {
  /**
   * @param {object} options
   * @param {{ AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }} options.window
   * @param {PreferencesPort} options.preferences
   */
  constructor({ window, preferences }) {
    this.window = window;
    this.preferences = preferences;
    /** @type {AudioContext | null} */
    this.context = null;
    /** @type {GainNode | null} */
    this.master = null;
  }

  /** @param {readonly GameEvent[]} events */
  handle(events) {
    if (!this.preferences.get().sound || !this.ensureContext()) {
      return;
    }

    for (const event of events) {
      this.play(event);
    }
  }

  /** @returns {boolean} whether sound can play */
  ensureContext() {
    if (!this.context) {
      const AudioContextClass = this.window.AudioContext ?? this.window.webkitAudioContext;

      if (!AudioContextClass) {
        return false;
      }

      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = MASTER_VOLUME;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }

    return true;
  }

  /** @param {GameEvent} event */
  play(event) {
    switch (event.type) {
      case 'match-start':
        this.arpeggio([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 0.07, 'triangle', 0.45);
        break;
      case 'countdown':
        // Three short ticks, then a longer one on "1" that leads into the serve.
        this.tone({ frequency: event.value === 1 ? NOTE.C6 : NOTE.G5, duration: event.value === 1 ? 0.2 : 0.08, type: 'square', volume: 0.22 });
        break;
      case 'serve':
        this.tone({ frequency: 320, endFrequency: 760, duration: 0.14, type: 'sine', volume: 0.35 });
        break;
      case 'pickup-spawn':
        this.tone({ frequency: NOTE.E6, endFrequency: NOTE.G6, duration: 0.12, type: 'sine', volume: 0.18 });
        break;
      case 'pickup':
        if (event.side === 'player') {
          this.arpeggio([NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6], 0.045, 'triangle', 0.36);
        } else {
          this.tone({ frequency: NOTE.G5, endFrequency: NOTE.E4, duration: 0.25, type: 'triangle', volume: 0.28 });
        }
        break;
      case 'match-point':
        this.arpeggio([NOTE.E5, NOTE.E5, NOTE.G5], 0.11, 'sawtooth', 0.3, 0.15);
        break;
      case 'life-lost':
        this.tone({ frequency: 200, endFrequency: 60, duration: 0.5, type: 'sawtooth', volume: 0.3 });
        break;
      case 'paddle-hit': {
        // Pitch climbs with the rally, so a long exchange audibly builds tension.
        const base = event.side === 'player' ? 520 : 390;
        const pitch = base * Math.min(2, 1 + event.rally * 0.035);
        this.tone({ frequency: pitch, duration: 0.09, type: 'square', volume: 0.3 });
        this.tone({ frequency: pitch * 2, duration: 0.05, type: 'sine', volume: 0.16 });

        if (event.rally % 5 === 0) {
          this.arpeggio([NOTE.C6, NOTE.E6, NOTE.G6], 0.05, 'sine', 0.22, 0.04);
        }
        break;
      }
      case 'paddle-graze':
        // A dull knock off the paddle's edge, lower and shorter than a proper hit.
        this.tone({ frequency: 180, endFrequency: 120, duration: 0.07, type: 'triangle', volume: 0.26 });
        break;
      case 'wall-bounce':
        this.tone({ frequency: 1000, endFrequency: 760, duration: 0.05, type: 'sine', volume: 0.16 });
        break;
      case 'point':
        if (event.scorer === 'player') {
          this.arpeggio([NOTE.E5, NOTE.G5, NOTE.C6], 0.08, 'triangle', 0.42);
        } else {
          this.tone({ frequency: 420, endFrequency: 130, duration: 0.42, type: 'sawtooth', volume: 0.26 });
        }
        break;
      case 'game-over':
        if (event.winner === 'player') {
          this.arpeggio([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6], 0.1, 'triangle', 0.45, 0.3);
        } else {
          this.arpeggio([NOTE.G4, NOTE.E4, NOTE.C4], 0.2, 'sawtooth', 0.3, 0.25);
        }
        break;
      case 'paused':
        this.tone({ frequency: 520, endFrequency: 360, duration: 0.09, type: 'sine', volume: 0.22 });
        break;
      case 'resumed':
        this.tone({ frequency: 360, endFrequency: 620, duration: 0.09, type: 'sine', volume: 0.22 });
        break;
      default:
        break;
    }
  }

  /**
   * @param {number[]} notes
   * @param {number} step seconds between notes
   * @param {OscillatorType} type
   * @param {number} volume
   * @param {number} [tail] extra ring time per note
   */
  arpeggio(notes, step, type, volume, tail = 0) {
    notes.forEach((frequency, index) => {
      this.tone({ frequency, duration: step + tail, type, volume, delay: index * step });
    });
  }

  /** @param {Tone} tone */
  tone({ frequency, endFrequency = frequency, duration, type, volume, delay = 0 }) {
    const context = /** @type {AudioContext} */ (this.context);
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);

    if (endFrequency !== frequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    }

    // A fast attack and an exponential decay keep every sound short and click-free.
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(envelope);
    envelope.connect(/** @type {GainNode} */ (this.master));
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
}
