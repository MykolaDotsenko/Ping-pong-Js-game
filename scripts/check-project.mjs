import { access, readFile } from 'node:fs/promises';

// Layer boundaries and determinism are enforced by eslint.config.js and verified by
// tests/architecture-rules.test.js. This script guards the project structure itself.

const requiredFiles = [
  'index.html',
  'script.js',
  'style.css',
  'src/config.js',
  'src/domain/types.js',
  'src/domain/random.js',
  'src/domain/game.js',
  'src/domain/physics.js',
  'src/domain/opponent.js',
  'src/domain/power-ups.js',
  'src/application/ports.js',
  'src/application/game-loop.js',
  'src/application/interpolation.js',
  'src/application/game-controller.js',
  'src/adapters/input-controller.js',
  'src/adapters/canvas-renderer.js',
  'src/adapters/canvas/theme.js',
  'src/adapters/canvas/court.js',
  'src/adapters/canvas/scene.js',
  'src/adapters/canvas/hud.js',
  'src/adapters/canvas/ball-trail.js',
  'src/adapters/canvas/event-effects.js',
  'src/adapters/effects.js',
  'src/adapters/dom-game-view.js',
  'src/adapters/audio-output.js',
  'src/adapters/sound-board.js',
  'src/adapters/music-player.js',
  'src/adapters/haptics.js',
  'src/adapters/wake-lock.js',
  'src/adapters/browser-device.js',
  'src/adapters/local-preferences.js',
  'src/adapters/browser-frame-scheduler.js',
  'tests/architecture-rules.test.js',
  'tests/browser-adapters.test.js',
  'tests/canvas-event-effects.test.js',
  'tests/canvas-renderer.test.js',
  'tests/canvas-scene.test.js',
  'tests/collisions.test.js',
  'tests/dom-game-view.test.js',
  'tests/effects.test.js',
  'tests/game.test.js',
  'tests/game-controller.test.js',
  'tests/game-loop.test.js',
  'tests/haptics.test.js',
  'tests/input-controller.test.js',
  'tests/interpolation.test.js',
  'tests/local-preferences.test.js',
  'tests/modules-load.test.js',
  'tests/music-player.test.js',
  'tests/physics.test.js',
  'tests/opponent.test.js',
  'tests/power-ups.test.js',
  'tests/random.test.js',
  'tests/sound-board.test.js',
  'tests/wake-lock.test.js',
  'tests/support/fake-canvas.js',
  'e2e/game.spec.js',
  'playwright.config.js',
  'eslint.config.js',
  'tsconfig.json',
  'package-lock.json',
  'ARCHITECTURE.md',
  'LICENSE',
  'docs/preview.png',
  'scripts/capture-preview.mjs',
  'scripts/coverage-gate.mjs',
  'scripts/render-icons.mjs',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

await Promise.all(requiredFiles.map((file) => access(file)));

const html = await readFile('index.html', 'utf8');
const script = await readFile('script.js', 'utf8');

if (!html.includes('<script type="module" src="script.js"></script>')) {
  throw new Error('index.html must load script.js as an ES module.');
}

if (!html.includes('data-game-canvas')) {
  throw new Error('index.html must expose the game canvas hook.');
}

if (/\son[a-z]+\s*=/i.test(html)) {
  throw new Error('Inline event handlers are not allowed.');
}

if (!script.includes('new GameController')) {
  throw new Error('script.js must stay a thin composition root.');
}

if (script.split('\n').length > 70) {
  throw new Error('script.js is too large for a composition root.');
}

console.log('Project structure checks passed.');
