import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';

import { AudioOutput } from '../src/adapters/audio-output.js';
import { BrowserDevice } from '../src/adapters/browser-device.js';
import { BrowserFrameScheduler } from '../src/adapters/browser-frame-scheduler.js';

// The thin adapters over browser APIs: sharing and full screen, animation frames, audio.

function device({ share, clipboard, requestFullscreen, fullscreenElement = null, exitFullscreen } = {}) {
  const calls = { shared: [], copied: [], fullscreen: [] };
  const navigator = {
    ...(share && { share: async (data) => { calls.shared.push(data); return share(data); } }),
    ...(clipboard && { clipboard: { writeText: async (text) => { calls.copied.push(text); return clipboard(text); } } }),
  };
  const document = {
    documentElement: requestFullscreen ? { requestFullscreen: async () => { calls.fullscreen.push('enter'); return requestFullscreen(); } } : {},
    fullscreenElement,
    exitFullscreen: async () => {
      calls.fullscreen.push('exit');
      return exitFullscreen?.();
    },
  };
  return { device: new BrowserDevice({ navigator, document, location: { href: 'https://example.test/pong/#about' } }), calls };
}

const ok = () => {};
const fail = () => {
  throw Object.assign(new Error('Not allowed here'), { name: 'NotAllowedError' });
};
const cancel = () => {
  throw Object.assign(new Error('Share canceled'), { name: 'AbortError' });
};

test('a result is shared through the system sheet, with the page address and no fragment', async () => {
  const { device: phone, calls } = device({ share: ok, clipboard: ok });

  assert.equal(await phone.share('I won 7:3'), 'shared');
  assert.deepEqual(calls.shared, [{ title: 'Ping Pong Architecture Lab', text: 'I won 7:3', url: 'https://example.test/pong/' }]);
  assert.deepEqual(calls.copied, []);
});

test('closing the share sheet is respected: nothing is copied behind the player\'s back', async () => {
  const { device: phone, calls } = device({ share: cancel, clipboard: ok });

  assert.equal(await phone.share('I won'), 'cancelled');
  assert.deepEqual(calls.copied, []);
});

test('a refused share sheet, or none at all, falls back to copying the text', async () => {
  const refused = device({ share: fail, clipboard: ok });
  assert.equal(await refused.device.share('I won'), 'copied');
  assert.deepEqual(refused.calls.copied, ['I won https://example.test/pong/']);

  const desktop = device({ clipboard: ok });
  assert.equal(desktop.device.canShare, true);
  assert.equal(await desktop.device.share('I won'), 'copied');
});

test('when neither works the view is told so, never that something was copied', async () => {
  const { device: locked } = device({ share: fail, clipboard: fail });
  assert.equal(await locked.share('I won'), 'failed');

  const noClipboard = device({ share: fail });
  assert.equal(await noClipboard.device.share('I won'), 'failed');

  const bare = device();
  assert.equal(bare.device.canShare, false);
  assert.equal(await bare.device.share('I won'), 'failed');
});

test('full screen toggles on and off where the browser allows it', async () => {
  const off = device({ requestFullscreen: ok });
  assert.equal(off.device.canFullscreen, true);
  await off.device.toggleFullscreen();
  assert.deepEqual(off.calls.fullscreen, ['enter']);

  const on = device({ requestFullscreen: ok, fullscreenElement: {} });
  await on.device.toggleFullscreen();
  assert.deepEqual(on.calls.fullscreen, ['exit']);

  assert.equal(device().device.canFullscreen, false);
});

test('a refused full-screen request is ignored rather than thrown at the player', async () => {
  const { device: framed } = device({ requestFullscreen: fail });

  await assert.doesNotReject(framed.toggleFullscreen());
});

test('the frame scheduler hands callbacks to the browser\'s animation frames', () => {
  const requested = [];
  const cancelled = [];
  const scheduler = new BrowserFrameScheduler({
    requestAnimationFrame: (callback) => requested.push(callback),
    cancelAnimationFrame: (id) => cancelled.push(id),
  });
  const callback = () => {};

  const id = scheduler.request(callback);
  scheduler.cancel(id);

  assert.deepEqual(requested, [callback]);
  assert.deepEqual(cancelled, [id]);
});

class FakeAudioContext {
  static created = 0;

  constructor() {
    FakeAudioContext.created += 1;
    this.state = 'suspended';
    this.resumes = 0;
  }

  resume() {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }
}

test('one audio context is opened on first use and resumed whenever the browser suspended it', () => {
  FakeAudioContext.created = 0;
  const audio = new AudioOutput({ AudioContext: FakeAudioContext });

  const context = audio.acquire();
  assert.strictEqual(audio.acquire(), context);
  assert.equal(FakeAudioContext.created, 1);
  assert.equal(context.resumes, 1);

  context.state = 'suspended'; // for example after the phone locked
  audio.acquire();
  assert.equal(context.resumes, 2);
});

test('older Safari\'s prefixed audio context is used, and no Web Audio means no sound', () => {
  FakeAudioContext.created = 0;

  assert.ok(new AudioOutput({ webkitAudioContext: FakeAudioContext }).acquire());
  assert.equal(new AudioOutput({}).acquire(), null);
});

test('a refused resume does not surface as an error', async () => {
  class Stubborn extends FakeAudioContext {
    resume() {
      return Promise.reject(new Error('NotAllowedError'));
    }
  }
  const audio = new AudioOutput({ AudioContext: Stubborn });

  assert.ok(audio.acquire());
  await settle();
});
