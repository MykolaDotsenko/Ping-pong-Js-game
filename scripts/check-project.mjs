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
  'tests/game.test.js',
  'tests/physics.test.js',
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

console.log('Project structure checks passed.');
