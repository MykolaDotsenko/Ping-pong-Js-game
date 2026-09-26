// Regenerates docs/preview.png from the running application: `npm run docs:preview`.
//
// The page runs on a paused fake clock, so the captured moment is identical on every run.
// Optional environment variables:
//   CHROMIUM_PATH    a Chromium other than the one `npx playwright install chromium` provides
//   PREVIEW_AT_MS    match time to capture, to pick another moment after UI or physics changes
//   PREVIEW_OUTPUT   where to write the image
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { chromium } from '@playwright/test';

const port = 4176;
const url = `http://127.0.0.1:${port}/`;
const output = process.env.PREVIEW_OUTPUT ?? 'docs/preview.png';

// A short, real rally: after the serve pause the player returns the ball off the paddle's
// edge, the computer answers, and the frame is taken as the ball comes back.
const PLAYER_X_FRACTION = 0.545;
const CAPTURE_AFTER_MS = Number(process.env.PREVIEW_AT_MS ?? 3900);

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
    const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 2 });
    await page.clock.install({ time: 0 });
    await page.goto(url);
    await page.clock.pauseAt(60 * 60 * 1000);

    const board = page.locator('[data-game-canvas]');
    await page.getByRole('button', { name: 'Start' }).click();
    const box = await board.boundingBox();
    await board.hover({ position: { x: box.width * PLAYER_X_FRACTION, y: box.height / 2 } });
    await page.clock.runFor(CAPTURE_AFTER_MS);

    const card = await page.locator('.game-card').boundingBox();
    const margin = 16;
    await page.screenshot({
      path: output,
      clip: {
        x: card.x - margin,
        y: card.y - margin,
        width: card.width + margin * 2,
        height: card.height + margin * 2,
      },
    });
    console.log(`Saved ${output}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
