import test from 'node:test';
import assert from 'node:assert/strict';

import { ESLint } from 'eslint';

// The layer rules live in eslint.config.js. These tests prove they still reject violations,
// so the architecture cannot erode silently if someone loosens the configuration.

const eslint = new ESLint();

async function ruleViolations(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => message.ruleId);
}

test('the core cannot reach browser or host globals', async () => {
  assert.deepEqual(await ruleViolations('src/domain/probe.js', 'export const width = window.innerWidth;\n'), ['no-undef']);
  assert.deepEqual(await ruleViolations('src/application/probe.js', 'setTimeout(() => {}, 0);\n'), ['no-undef']);
  assert.deepEqual(await ruleViolations('src/domain/probe.js', 'export const w = globalThis.window;\n'), ['no-restricted-globals']);
});

test('the core stays deterministic: no clock, no randomness', async () => {
  assert.deepEqual(await ruleViolations('src/domain/probe.js', 'export const now = Date.now();\n'), ['no-restricted-globals']);
  assert.deepEqual(await ruleViolations('src/application/probe.js', 'export const roll = Math.random();\n'), ['no-restricted-properties']);
});

test('dependencies point inward', async () => {
  assert.deepEqual(await ruleViolations('src/domain/probe.js', "import '../application/ports.js';\n"), ['no-restricted-imports']);
  assert.deepEqual(await ruleViolations('src/domain/probe.js', "import '../adapters/canvas-renderer.js';\n"), ['no-restricted-imports']);
  assert.deepEqual(await ruleViolations('src/application/probe.js', "import '../adapters/dom-game-view.js';\n"), ['no-restricted-imports']);
  assert.deepEqual(await ruleViolations('src/adapters/probe.js', "import '../application/ports.js';\nimport '../domain/game.js';\n"), []);
});

test('only the composition root touches browser globals', async () => {
  assert.deepEqual(await ruleViolations('script.js', 'document.title = window.name;\n'), []);
  assert.deepEqual(await ruleViolations('src/adapters/probe.js', 'export const doc = document;\n'), ['no-undef']);
});
