export class BrowserFrameScheduler {
  request(callback) {
    return window.requestAnimationFrame(callback);
  }

  cancel(frameId) {
    window.cancelAnimationFrame(frameId);
  }
}
