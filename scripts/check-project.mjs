import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'script.js',
  'style.css',
  'src/config.js',
  'src/domain/game.js',
  'src/domain/physics.js',
  'src/domain/opponent.js',
  'src/application/game-loop.js',
  'src/application/game-controller.js',
  'src/adapters/input-controller.js',
  'src/adapters/canvas-renderer.js',
  'src/adapters/dom-game-view.js',
  'src/adapters/browser-frame-scheduler.js',
  'tests/game.test.js',
  'tests/game-loop.test.js',
  'tests/physics.test.js',
  'tests/opponent.test.js',
  'e2e/game.spec.js',
  'playwright.config.js',
  'eslint.config.js',
  'ARCHITECTURE.md',
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

if (/onclick\s*=|onmousemove\s*=/i.test(html)) {
  throw new Error('Inline event handlers are not allowed.');
}

if (!script.includes('new GameController')) {
  throw new Error('script.js must stay a thin composition root.');
}

if (script.split('\n').length > 70) {
  throw new Error('script.js is too large for a composition root.');
}

const browserOnlyTokens = [
  'window.',
  'document.',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getContext(',
  'addEventListener(',
];

const coreFiles = [
  'src/domain/game.js',
  'src/domain/physics.js',
  'src/domain/opponent.js',
  'src/application/game-loop.js',
  'src/application/game-controller.js',
];

for (const file of coreFiles) {
  const source = await readFile(file, 'utf8');

  for (const token of browserOnlyTokens) {
    if (source.includes(token)) {
      throw new Error(`${file} leaks browser concern "${token}" into the core.`);
    }
  }

  if (file.startsWith('src/application/') && source.includes('/adapters/')) {
    throw new Error(`${file} must not depend on adapters.`);
  }
}

console.log('Project structure and architecture boundary checks passed.');
