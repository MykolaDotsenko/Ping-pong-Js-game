// Regenerates docs/preview.png from the running application: `npm run docs:preview`.
//
// The page runs on a paused fake clock with a seeded random source for the effects, so the
// captured moment is identical on every run. Optional environment variables:
//   CHROMIUM_PATH    a Chromium other than the one `npx playwright install chromium` provides
//   PREVIEW_AT_MS    match time to capture, to pick another moment after UI or physics changes
//   PREVIEW_OUTPUT   where to write the image
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { chromium } from '@playwright/test';

const port = 4176;
const url = `http://127.0.0.1:${port}/`;
const output = process.env.PREVIEW_OUTPUT ?? 'docs/preview.png';

// A real rally: the paddle waits in the middle, returns the computer's shot, and the frame is
// taken just after that hit, with sparks flying and the rally counter up.
const CAPTURE_AT_MS = Number(process.env.PREVIEW_AT_MS ?? 5290);

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }

    await delay(100);
  }

  throw new Error(`The preview server did not start on ${url}.`);
}

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  stdio: 'ignore',
});

try {
  await waitForServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
    await page.addInitScript(() => {
      let seed = 7;
      Math.random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
    });
    await page.clock.install({ time: 0 });
    await page.goto(url);
    await page.clock.pauseAt(60 * 60 * 1000);
    // Let the menu's entrance animation settle, so the click lands on a still button.
    await delay(500);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    // Park the mouse beside the board, so the paddle stays where it starts.
    await page.mouse.move(40, 450);
    await page.clock.runFor(CAPTURE_AT_MS);
    await page.screenshot({ path: output });
    console.log(`Saved ${output}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
