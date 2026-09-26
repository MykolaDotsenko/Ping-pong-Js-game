// Runs the unit tests with coverage and holds the result to two bars: the whole of src, and
// every file on its own, so no module can hide behind the average (`npm run test:coverage`).
// tests/modules-load.test.js loads every module, so a file without tests counts at 0%.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

const TOTAL = { lines: 95, branches: 90, functions: 90 };
// Function coverage counts every small callback, such as a .catch(() => {}) that only runs when
// a browser API rejects, so its floor sits a little lower.
const PER_FILE = { lines: 90, branches: 85, functions: 80 };
const REPORT = 'coverage/lcov.info';

mkdirSync('coverage', { recursive: true });

const run = spawnSync(process.execPath, [
  '--test',
  '--experimental-test-coverage',
  '--test-coverage-include=src/**',
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  '--test-reporter=lcov',
  `--test-reporter-destination=${REPORT}`,
], { stdio: 'inherit' });

if (run.status !== 0) {
  process.exit(run.status ?? 1);
}

/** @typedef {{ lines: [number, number], branches: [number, number], functions: [number, number] }} Counts */

/** @returns {Map<string, Counts>} hit and found counts per file */
function parseLcov(text) {
  const files = new Map();
  let current = null;

  for (const line of text.split('\n')) {
    const [key, value] = line.split(':');

    if (key === 'SF') {
      current = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };
      files.set(relative(process.cwd(), value), current);
    } else if (current && ['LH', 'LF', 'BRH', 'BRF', 'FNH', 'FNF'].includes(key)) {
      const metric = { L: 'lines', BR: 'branches', FN: 'functions' }[key.slice(0, -1)];
      current[metric][key.endsWith('H') ? 0 : 1] = Number(value);
    }
  }

  return files;
}

const percent = ([hit, found]) => (found === 0 ? 100 : (hit / found) * 100);
const files = parseLcov(readFileSync(REPORT, 'utf8'));
const failures = [];
const totals = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };

for (const [file, counts] of files) {
  for (const metric of /** @type {const} */ (['lines', 'branches', 'functions'])) {
    totals[metric][0] += counts[metric][0];
    totals[metric][1] += counts[metric][1];

    if (percent(counts[metric]) < PER_FILE[metric]) {
      failures.push(`${file}: ${metric} ${percent(counts[metric]).toFixed(1)}% is below the per-file floor of ${PER_FILE[metric]}%`);
    }
  }
}

for (const metric of /** @type {const} */ (['lines', 'branches', 'functions'])) {
  if (percent(totals[metric]) < TOTAL[metric]) {
    failures.push(`all of src: ${metric} ${percent(totals[metric]).toFixed(1)}% is below ${TOTAL[metric]}%`);
  }
}

const summary = Object.entries(totals).map(([metric, counts]) => `${metric} ${percent(counts).toFixed(2)}%`).join(', ');
console.log(`\nCoverage over ${files.size} files in src: ${summary}.`);

if (failures.length > 0) {
  console.error(`\nCoverage gate failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}

console.log(`Every file clears the per-file floor (lines ${PER_FILE.lines}%, branches ${PER_FILE.branches}%, functions ${PER_FILE.functions}%).`);
