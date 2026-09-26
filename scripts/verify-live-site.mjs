// Proves a deploy is live: every file of the published site must come back from the live URL
// byte for byte (`node scripts/verify-live-site.mjs <site dir> <page url> [cache buster]`).
// A stale build, or a Pages source still set to a branch, cannot pass this, which a check of
// the page title alone could not tell apart when the title had not changed.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [siteDir, pageUrl, cacheBuster = String(Date.now())] = process.argv.slice(2);
// A fresh deploy can take a little while to reach every edge server.
const ATTEMPTS = Number(process.env.VERIFY_ATTEMPTS ?? 6);
const RETRY_SECONDS = Number(process.env.VERIFY_RETRY_SECONDS ?? 10);

if (!siteDir || !pageUrl) {
  console.error('Usage: node scripts/verify-live-site.mjs <site dir> <page url> [cache buster]');
  process.exit(2);
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const base = pageUrl.endsWith('/') ? pageUrl : `${pageUrl}/`;
const files = (await readdir(siteDir, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => relative(siteDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
  .sort();
const expected = new Map(await Promise.all(files.map(async (file) => [file, digest(await readFile(join(siteDir, file)))])));

/** @returns {Promise<string[]>} the files the live site does not serve as published */
async function staleFiles() {
  const results = await Promise.all(files.map(async (file) => {
    try {
      // The query string gets past the CDN cache, which can hold a page for ten minutes.
      const response = await fetch(`${base}${file}?deployed=${cacheBuster}`, { cache: 'no-store' });
      const served = response.ok ? digest(new Uint8Array(await response.arrayBuffer())) : `HTTP ${response.status}`;
      return served === expected.get(file) ? null : `${file} (${response.ok ? 'different content' : served})`;
    } catch (error) {
      return `${file} (${error.cause?.code ?? error.message})`;
    }
  }));

  return results.filter((result) => result !== null);
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  const stale = await staleFiles();

  if (stale.length === 0) {
    console.log(`Live: ${base} serves all ${files.length} published files byte for byte.`);
    process.exit(0);
  }

  console.log(`Attempt ${attempt}: ${stale.length} of ${files.length} files not live yet: ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ', …' : ''}`);

  if (attempt < ATTEMPTS) {
    await sleep(RETRY_SECONDS * 1000);
  }
}

console.error(`::error::${base} still serves an older build. In Settings > Pages the source must be 'GitHub Actions'.`);
process.exit(1);
