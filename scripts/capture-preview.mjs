// Regenerates docs/preview.png from the running application: `npm run docs:preview`.
//
// The image puts two screens side by side: the title screen, and a moment of a live match.
// The match runs on a paused fake clock with a seeded random source for the effects, and the
// title screen is taken with reduced motion, so its neon sign is simply on; the image is
// identical on every run. Optional environment variables:
//   CHROMIUM_PATH    a Chromium other than the one `npx playwright install chromium` provides
//   PREVIEW_AT_MS    match time to capture, to pick another moment after UI or physics changes
//   PREVIEW_OUTPUT   where to write the image
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { chromium } from '@playwright/test';

const port = 4176;
const url = `http://127.0.0.1:${port}/`;
const output = process.env.PREVIEW_OUTPUT ?? 'docs/preview.png';

// A real rally: after the three-second countdown the paddle, waiting in the middle, returns the
// computer's shot, and the frame is taken just after that hit, with sparks flying and the
// rally counter up.
const CAPTURE_AT_MS = Number(process.env.PREVIEW_AT_MS ?? 7400);

// Each screen as a phone-shaped window onto the game, which stands alone at full height.
const SCREEN = { viewport: { width: 640, height: 900 }, deviceScaleFactor: 1.25 };
const GAP = 24;

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

/**
 * A page for a returning player, so the menu shows rather than the tutorial, with a seeded
 * random source.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {'reduce' | 'no-preference'} reducedMotion
 */
async function openGame(browser, reducedMotion) {
  const page = await browser.newPage({ ...SCREEN, reducedMotion });

  await page.addInitScript(() => {
    let seed = 7;
    Math.random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  });
  await page.addInitScript(() => {
    // Runs in the browser, where globalThis is the window.
    globalThis.localStorage.setItem('ping-pong-lab:preferences', JSON.stringify({ tutorialSeen: true }));
  });

  return page;
}

/** @param {import('@playwright/test').Browser} browser */
async function captureTitle(browser) {
  const page = await openGame(browser, 'reduce');

  await page.goto(url);
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  const image = await page.screenshot();
  await page.close();
  return image;
}

/** @param {import('@playwright/test').Browser} browser */
async function captureMatch(browser) {
  const page = await openGame(browser, 'no-preference');

  await page.clock.install({ time: 0 });
  await page.goto(url);
  await page.clock.pauseAt(60 * 60 * 1000);
  // Let the menu's entrance animation settle before the match starts.
  await delay(500);

  // Start from the keyboard: the mouse never touches the game, so the paddle stays where it
  // starts, in the middle.
  await page.keyboard.press('Space');
  await page.clock.runFor(CAPTURE_AT_MS);
  const image = await page.screenshot();
  await page.close();
  return image;
}

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {Buffer[]} images
 */
async function sideBySide(browser, images) {
  const width = SCREEN.viewport.width * SCREEN.deviceScaleFactor;
  const height = SCREEN.viewport.height * SCREEN.deviceScaleFactor;
  const page = await browser.newPage({
    viewport: { width: width * images.length + GAP * (images.length - 1), height },
    deviceScaleFactor: 1,
  });

  await page.setContent(`<!doctype html>
    <style>
      html, body { margin: 0; background: #05060f; }
      body { display: flex; gap: ${GAP}px; }
      img { display: block; width: ${width}px; height: ${height}px; }
    </style>
    ${images.map((image) => `<img alt="" src="data:image/png;base64,${image.toString('base64')}">`).join('')}`);
  await page.screenshot({ path: output });
  await page.close();
}

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  stdio: 'ignore',
});

try {
  await waitForServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  try {
    await sideBySide(browser, [await captureTitle(browser), await captureMatch(browser)]);
    console.log(`Saved ${output}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
