import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { URL } from 'node:url';

// Every module under src is loaded here, so the coverage report lists all of them: a file
// that no test exercises shows up at 0% instead of being left out of the numbers. Loading
// them in Node also proves that no module reaches for browser globals when it is imported;
// those arrive only through the composition root.

const SOURCE = new URL('../src/', import.meta.url);

test('every source module loads without a browser', async () => {
  const files = (await readdir(SOURCE, { recursive: true }))
    .filter((file) => file.endsWith('.js'))
    .sort();

  assert.ok(files.length >= 25, `found ${files.length} modules`);

  for (const file of files) {
    await assert.doesNotReject(import(new URL(file, SOURCE).href), file);
  }
});
