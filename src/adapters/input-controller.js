export class InputController {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.leftPressed = false;
    this.rightPressed = false;
    this.pointerX = null;
    this.listeners = [];
  }

  connect() {
    this.listen(window, 'keydown', (event) => this.handleKey(event, true));
    this.listen(window, 'keyup', (event) => this.handleKey(event, false));
    this.listen(this.canvas, 'pointermove', (event) => this.handlePointer(event));
    this.listen(this.canvas, 'pointerleave', () => {
      this.pointerX = null;
    });
  }

  disconnect() {
    for (const [target, type, listener] of this.listeners) {
      target.removeEventListener(type, listener);
    }
    this.listeners = [];
  }

  listen(target, type, listener) {
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }

  handleKey(event, isPressed) {
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      this.leftPressed = isPressed;
      event.preventDefault();
    }

    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      this.rightPressed = isPressed;
      event.preventDefault();
    }
  }

  handlePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const normalized = (event.clientX - rect.left) / rect.width;
    this.pointerX = normalized * this.config.width;
  }

  snapshot() {
    const horizontalAxis = Number(this.rightPressed) - Number(this.leftPressed);
    return {
      horizontalAxis,
      pointerX: this.pointerX,
    };
  }
}
