export class FixedStepLoop {
  constructor({ stepSeconds, maxFrameSeconds, update, render, scheduler }) {
    this.stepSeconds = stepSeconds;
    this.maxFrameSeconds = maxFrameSeconds;
    this.update = update;
    this.render = render;
    this.scheduler = scheduler;
    this.running = false;
    this.lastTimestamp = null;
    this.accumulator = 0;
    this.frameId = null;
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

    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }
  }

  tick(timestamp) {
    if (!this.running) {
      return;
    }

    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
    }

    const frameSeconds = Math.min(
      (timestamp - this.lastTimestamp) / 1000,
      this.maxFrameSeconds,
    );
    this.lastTimestamp = timestamp;
    this.accumulator += frameSeconds;

    while (this.accumulator >= this.stepSeconds) {
      this.update(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
    }

    this.render(this.accumulator / this.stepSeconds);
    this.frameId = this.scheduler.request(this.tick);
  }
}
