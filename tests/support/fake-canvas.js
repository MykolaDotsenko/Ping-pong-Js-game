// A stand-in for the Canvas 2D API that records every drawing call together with the brush
// state at that moment (colors, alpha, blending, transform-free font), so tests can ask what
// was drawn, where and how, without a browser.

const BRUSH = ['fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation', 'lineWidth', 'font'];

/**
 * @returns {CanvasRenderingContext2D & { calls: Array<{ name: string, args: unknown[], brush: Record<string, unknown> }> }}
 */
export function createRecordingContext() {
  const calls = [];
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  const saved = [];
  const gradient = (kind, args) => ({ kind, args, stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } });
  const record = (name, args) => {
    calls.push({ name, args, brush: Object.fromEntries(BRUSH.map((key) => [key, state[key]])) });
  };

  return new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      if (name in state) return state[name];

      switch (name) {
        case 'createLinearGradient':
        case 'createRadialGradient':
          return (...args) => {
            record(name, args);
            return gradient(name, args);
          };
        case 'save':
          return () => {
            record(name, []);
            saved.push({ ...state });
          };
        case 'restore':
          return () => {
            record(name, []);
            Object.assign(state, saved.pop());
          };
        default:
          return (...args) => record(name, args);
      }
    },
    set(_, name, value) {
      state[name] = value;
      return true;
    },
  });
}

/** A canvas element whose 2D context records its drawing. */
export class FakeCanvas {
  constructor({ clientWidth = 0, contextAvailable = true } = {}) {
    this.clientWidth = clientWidth;
    this.width = 300;
    this.height = 150;
    this.contexts = [];
    this.contextAvailable = contextAvailable;
    this.ownerDocument = { createElement: () => new FakeCanvas() };
  }

  getContext() {
    if (!this.contextAvailable) {
      return null;
    }

    const context = createRecordingContext();
    this.contexts.push(context);
    return context;
  }

  /** The drawing calls on this canvas's first context. */
  get calls() {
    return this.contexts[0]?.calls ?? [];
  }
}

/**
 * A browser window for the renderer: pixel ratio, media queries, resize observers and a
 * clock the test moves by hand.
 */
export function createRendererWindow({ devicePixelRatio = 1, reducedMotion = false } = {}) {
  const queries = [];
  const observers = [];
  let now = 0;

  const window = {
    devicePixelRatio,
    queries,
    observers,
    performance: { now: () => now },
    advance(ms) {
      now += ms;
    },
    matchMedia(query) {
      const listeners = new Set();
      const media = {
        query,
        matches: query.includes('reduced-motion') ? reducedMotion : false,
        listeners,
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener),
        change(matches) {
          media.matches = matches;
          [...listeners].forEach((listener) => listener());
        },
      };
      queries.push(media);
      return media;
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.disconnected = false;
        observers.push(this);
      }

      observe(element) {
        this.observed.push(element);
      }

      disconnect() {
        this.disconnected = true;
      }
    },
  };

  return window;
}

/** A frame scheduler the test drives by hand. */
export function createFrameScheduler() {
  let nextId = 1;
  const pending = new Map();

  return {
    pending,
    request(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(0));
    },
  };
}

/** Calls of one kind, for example every arc. */
export const callsNamed = (context, name) => context.calls.filter((call) => call.name === name);
