/** @import { FrameScheduler } from '../application/ports.js' */

/** @implements {FrameScheduler} */
export class BrowserFrameScheduler {
  /** @param {Window} window */
  constructor(window) {
    this.window = window;
  }

  /** @param {(timestamp: number) => void} callback */
  request(callback) {
    return this.window.requestAnimationFrame(callback);
  }

  /** @param {number} frameId */
  cancel(frameId) {
    this.window.cancelAnimationFrame(frameId);
  }
}
