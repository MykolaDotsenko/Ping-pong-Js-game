import { expect, test } from '@playwright/test';

import { GAME_CONFIG } from '../src/config.js';

const status = (page) => page.locator('[data-game-status]');
const board = (page) => page.locator('[data-game-canvas]');

/**
 * Reads the player paddle's center, in board units, from the canvas pixels. The test
 * observes what the player sees instead of reaching into application state.
 */
function readPlayerX(page) {
  const { width, height, paddle } = GAME_CONFIG;
  const rowY = height - paddle.inset - paddle.height / 2;

  return board(page).evaluate((canvas, { boardWidth, boardRowY }) => {
    const scale = canvas.width / boardWidth;
    const row = canvas.getContext('2d')
      .getImageData(0, Math.round(boardRowY * scale), canvas.width, 1).data;
    let first = -1;
    let last = -1;

    for (let x = 0; x < canvas.width; x += 1) {
      const isPaddleWhite = row[x * 4] > 240 && row[x * 4 + 1] > 240 && row[x * 4 + 2] > 240;

      if (isPaddleWhite) {
        first = first < 0 ? x : first;
        last = x;
      }
    }

    return first < 0 ? null : (first + last) / 2 / scale;
  }, { boardWidth: width, boardRowY: rowY });
}

/** Reads the ball's center, in board units, as the centroid of the ball-colored canvas pixels. */
function readBall(page) {
  return board(page).evaluate((canvas, boardWidth) => {
    const scale = canvas.width / boardWidth;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    let sumX = 0;
    let sumY = 0;

    for (let i = 0; i < data.length; i += 4) {
      const isBall = Math.abs(data[i] - 94) < 12 && Math.abs(data[i + 1] - 234) < 12 && Math.abs(data[i + 2] - 212) < 12;

      if (isBall) {
        const pixel = i / 4;
        count += 1;
        sumX += pixel % canvas.width;
        sumY += Math.floor(pixel / canvas.width);
      }
    }

    return count === 0 ? null : { x: sumX / count / scale, y: sumY / count / scale };
  }, GAME_CONFIG.width);
}

// A point on the board relative to its top-left corner; hover() and tap() scroll it into view.
async function boardPoint(page, xFraction) {
  const box = await board(page).boundingBox();
  return { position: { x: box.width * xFraction, y: box.height / 2 } };
}

test('buttons and the Space key drive the match state machine', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Ping Pong Architecture Lab' })).toBeVisible();
  await expect(board(page)).toBeVisible();
  await expect(status(page)).toHaveText('First to 7. Start when ready.');

  // Clicking a control hands focus to the board, so Space pauses instead of re-clicking Start.
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(status(page)).toContainText('You 0');
  await expect(board(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();

  await page.keyboard.press('Space');
  await expect(status(page)).toHaveText('Game paused.');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeEnabled();

  await page.keyboard.press('Space');
  await expect(status(page)).toContainText('You 0');

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(status(page)).toHaveText('First to 7. Start when ready.');

  await page.keyboard.press('Space');
  await expect(status(page)).toContainText('You 0');

  expect(errors).toEqual([]);
});

test('the paddle follows the mouse, and the keyboard takes over while the mouse rests on the board', async ({ page, hasTouch }) => {
  test.skip(hasTouch, 'mouse scenario; touch has its own test');

  await page.goto('/');
  await page.getByRole('button', { name: 'Start' }).click();

  await board(page).hover(await boardPoint(page, 0.75));
  await expect.poll(() => readPlayerX(page)).toBeCloseTo(0.75 * GAME_CONFIG.width, -1);

  await page.keyboard.down('ArrowLeft');
  await expect.poll(() => readPlayerX(page)).toBeLessThan(GAME_CONFIG.width / 3);
  await page.keyboard.up('ArrowLeft');
});

test('A and D steer on any keyboard layout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start' }).click();

  // With a Ukrainian layout the physical A key produces "ф".
  await board(page).dispatchEvent('keydown', { key: 'ф', code: 'KeyA', bubbles: true });
  await expect.poll(() => readPlayerX(page)).toBeLessThan(GAME_CONFIG.width / 3);
  await board(page).dispatchEvent('keyup', { key: 'ф', code: 'KeyA', bubbles: true });
});

test('a tap on the board moves the paddle on touch screens', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch devices only');

  await page.goto('/');
  await page.getByRole('button', { name: 'Start' }).tap();

  await board(page).tap(await boardPoint(page, 0.25));
  await expect.poll(() => readPlayerX(page)).toBeCloseTo(0.25 * GAME_CONFIG.width, -1);
});

test('the ball waits at the center before the serve', async ({ page }) => {
  // A paused fake clock makes the timing exact, however fast the machine is. The installed
  // clock keeps flowing until paused, so pause far enough ahead to never be in the past.
  await page.clock.install({ time: 0 });
  await page.goto('/');
  await page.clock.pauseAt(60 * 60 * 1000);
  await page.getByRole('button', { name: 'Start' }).click();

  const delayMs = GAME_CONFIG.serveDelaySeconds * 1000;
  const center = { x: GAME_CONFIG.width / 2, y: GAME_CONFIG.height / 2 };

  await page.clock.runFor(delayMs / 2);
  const waiting = await readBall(page);
  expect(Math.abs(waiting.x - center.x)).toBeLessThan(2);
  expect(Math.abs(waiting.y - center.y)).toBeLessThan(2);

  await page.clock.runFor(delayMs / 2 + 300);
  expect((await readBall(page)).y).toBeGreaterThan(center.y + 50);
});

test('losing window focus pauses a running match', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(status(page)).toContainText('You 0');

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(status(page)).toHaveText('Game paused.');
});

test('idle screens keep the render loop and the live region quiet', async ({ page }) => {
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.frameRequests = 0;
    window.requestAnimationFrame = (callback) => {
      window.frameRequests += 1;
      return requestFrame(callback);
    };
  });

  await page.goto('/');
  const idleActivity = () => page.evaluate(() => new Promise((resolve) => {
    const framesBefore = window.frameRequests;
    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(document.querySelector('[data-game-status]'), {
      childList: true,
      characterData: true,
      subtree: true,
    });
    setTimeout(() => {
      observer.disconnect();
      resolve({ frames: window.frameRequests - framesBefore, mutations });
    }, 400);
  }));

  expect(await idleActivity()).toEqual({ frames: 0, mutations: 0 });

  await page.getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => page.evaluate(() => window.frameRequests)).toBeGreaterThan(5);

  await page.keyboard.press('Space');
  await expect(status(page)).toHaveText('Game paused.');
  expect(await idleActivity()).toEqual({ frames: 0, mutations: 0 });
});

test('the canvas backing store matches device pixels, keeping the board sharp', async ({ page }) => {
  await page.goto('/');

  const size = await board(page).evaluate((canvas) => ({
    backing: canvas.width,
    devicePixels: canvas.clientWidth * window.devicePixelRatio,
  }));

  expect(Math.abs(size.backing - size.devicePixels)).toBeLessThanOrEqual(1);
});
