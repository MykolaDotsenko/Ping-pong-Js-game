// Re-records tests/fixtures/reference-matches.json (`npm run reference:record`). Run it only
// when a change to how a classic match plays out is intended, and say why in the commit.
import { writeFile } from 'node:fs/promises';

import { playReference, SCENARIOS } from '../tests/support/reference-matches.js';

const fixtures = Object.fromEntries(SCENARIOS.map((scenario) => {
  const { digest, summary } = playReference(scenario);
  console.log(`${scenario.name.padEnd(16)} ${summary.steps} steps, ${summary.score.player}:${summary.score.opponent}, longest rally ${summary.longestRally}`);
  return [scenario.name, { digest, summary }];
}));

await writeFile('tests/fixtures/reference-matches.json', `${JSON.stringify(fixtures, null, 2)}\n`);
console.log('Recorded tests/fixtures/reference-matches.json');
