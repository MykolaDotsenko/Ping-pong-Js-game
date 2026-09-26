// Renders the app icons from icons/icon.svg: `npm run docs:icons`.
// Set CHROMIUM_PATH to use a Chromium other than the one `npx playwright install chromium` provides.
import { readFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const svg = await readFile('icons/icon.svg', 'utf8');

// Maskable icons are cropped to a circle by some launchers, so that variant gets a safe margin.
const outputs = [
  { path: 'icons/icon-192.png', size: 192, inset: 0 },
  { path: 'icons/icon-512.png', size: 512, inset: 0 },
  { path: 'icons/icon-maskable-512.png', size: 512, inset: 0.12, background: '#05060f' },
  { path: 'icons/apple-touch-icon.png', size: 180, inset: 0, background: '#05060f' },
  { path: 'favicon.png', size: 64, inset: 0 },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

try {
  const page = await browser.newPage();

  for (const { path, size, inset, background = 'transparent' } of outputs) {
    const margin = Math.round(size * inset);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html>
      <style>
        html, body { margin: 0; background: ${background}; }
        svg { display: block; width: ${size - margin * 2}px; height: ${size - margin * 2}px; margin: ${margin}px; }
      </style>${svg}`);
    await page.screenshot({ path, omitBackground: background === 'transparent' });
    console.log(`Saved ${path}`);
  }
} finally {
  await browser.close();
}
