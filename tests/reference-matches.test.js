import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { playReference, SCENARIOS } from './support/reference-matches.js';

// Classic play must not change under new features: every step of these recorded bot matches
// must come out exactly as it did when the fixture was recorded. A change that is meant to
// alter classic play re-records the fixture with `npm run reference:record` and says why.

const fixtures = JSON.parse(await readFile(new URL('./fixtures/reference-matches.json', import.meta.url), 'utf8'));

for (const scenario of SCENARIOS) {
  test(`the ${scenario.name} reference match plays out exactly as recorded`, () => {
    const recorded = fixtures[scenario.name];
    assert.ok(recorded, `no fixture for ${scenario.name}; run npm run reference:record`);

    const { digest, summary } = playReference(scenario);

    assert.deepEqual(summary, recorded.summary, `${scenario.name}: the match went differently`);
    assert.equal(digest, recorded.digest, `${scenario.name}: the same summary, but some step differs`);
  });
}

test('the reference matches cover real play: points, hits and long rallies', () => {
  for (const scenario of SCENARIOS) {
    const { summary } = fixtures[scenario.name];
    assert.ok(summary.hits.player + summary.hits.opponent >= 15, `${scenario.name} has hits`);
    assert.ok(summary.score.player + summary.score.opponent >= 1, `${scenario.name} has points`);
    assert.ok(summary.longestRally >= 4, `${scenario.name} has rallies`);
  }
});
