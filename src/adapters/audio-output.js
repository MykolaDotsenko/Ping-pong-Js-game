/**
 * @typedef {{ AudioContext?: typeof AudioContext, webkitAudioContext?: typeof AudioContext }} AudioWindow
 */

/**
 * The one audio context that sound effects and music share. Browsers limit how many a page
 * may open, and each costs a real-time audio thread, so the game opens a single one. It is
 * created on first use, which always follows a click or key press as browsers require, and
 * resumed whenever the browser has suspended it.
 */
export class AudioOutput {
  /** @param {AudioWindow} window */
  constructor(window) {
    this.window = window;
    /** @type {AudioContext | null} */
    this.context = null;
  }

  /** @returns {AudioContext | null} a context ready to play, or null where Web Audio is missing */
  acquire() {
    if (!this.context) {
      const AudioContextClass = this.window.AudioContext ?? this.window.webkitAudioContext;

      if (!AudioContextClass) {
        return null;
      }

      this.context = new AudioContextClass();
    }

    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }

    return this.context;
  }
}
