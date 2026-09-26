/** @import { FrameScheduler } from './ports.js' */

export class FixedStepLoop {
  /**
   * @param {object} options
   * @param {number} options.stepSeconds
   * @param {number} options.maxFrameSeconds
   * @param {(deltaSeconds: number) => void} options.update
   * @param {(alpha: number) => void} options.render
   * @param {FrameScheduler} options.scheduler
   */
  constructor({ stepSeconds, maxFrameSeconds, update, render, scheduler }) {
    this.stepSeconds = stepSeconds;
    this.maxFrameSeconds = maxFrameSeconds;
    this.update = update;
    this.render = render;
    this.scheduler = scheduler;
    this.running = false;
    /** @type {number | null} */
    this.lastTimestamp = null;
    this.accumulator = 0;
    /** @type {number | null} */
    this.frameId = null;
    /** How fast simulated time passes relative to real time: 1 is normal, below 1 is slow motion. */
    this.timeScale = 1;
    /** Real seconds during which the simulation stays frozen, for hit-stop. */
    this.holdSeconds = 0;
    this.tick = this.tick.bind(this);
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastTimestamp = null;
    this.frameId = this.scheduler.request(this.tick);
  }

  stop() {
    this.running = false;
    this.lastTimestamp = null;
    this.accumulator = 0;
    this.holdSeconds = 0;
    this.timeScale = 1;

    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }
  }

  /**
   * Freezes the simulation for a moment while rendering continues: the classic hit-stop.
   *
   * @param {number} seconds
   */
  hold(seconds) {
    this.holdSeconds = Math.max(this.holdSeconds, seconds);
  }

  /** @param {number} timestamp */
  tick(timestamp) {
    this.frameId = null;

    if (!this.running) {
      return;
    }

    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
    }

    let frameSeconds = Math.min(
      (timestamp - this.lastTimestamp) / 1000,
      this.maxFrameSeconds,
    );
    this.lastTimestamp = timestamp;

    if (this.holdSeconds > 0) {
      const held = Math.min(this.holdSeconds, frameSeconds);
      this.holdSeconds -= held;
      frameSeconds -= held;
    }

    this.accumulator += frameSeconds * this.timeScale;

    // update() may stop the loop, for example when the match ends, which also clears the accumulator.
    while (this.running && this.accumulator >= this.stepSeconds) {
      this.accumulator -= this.stepSeconds;
      this.update(this.stepSeconds);
    }

    this.render(this.accumulator / this.stepSeconds);

    if (this.running) {
      this.frameId = this.scheduler.request(this.tick);
    }
  }
}
