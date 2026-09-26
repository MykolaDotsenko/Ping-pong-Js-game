import { expect, test as base } from '@playwright/test';

import { GAME_CONFIG } from '../src/config.js';

// A first visit opens the tutorial over the menu. Most tests model a returning player, so
// they store that choice before the page loads; the tutorial has a test of its own.
const test = base.extend({
  tutorialSeen: [true, { option: true }],
  context: async ({ context, tutorialSeen }, use) => {
    // Runs before every page load, so it must not overwrite choices a test has since made.
    await context.addInitScript((seen) => {
      const key = 'ping-pong-lab:preferences';

      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, JSON.stringify({ tutorialSeen: seen }));
      }
    }, tutorialSeen);
    await use(context);
  },
});

const status = (page) => page.locator('[data-game-status]');
const board = (page) => page.locator('[data-game-canvas]');
const playButton = (page) => page.getByRole('button', { name: 'Play', exact: true });

/**
 * Reads the player paddle's center, in board units, from the canvas pixels: the paddle's
 * core stripe has a color nothing else on the board uses. The test observes what the
 * player sees instead of reaching into application state.
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
      const [red, green, blue] = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]];

      if (red > 135 && red < 195 && green > 225 && blue > 235) {
        first = first < 0 ? x : first;
        last = x;
      }
    }

    return first < 0 ? null : (first + last) / 2 / scale;
  }, { boardWidth: width, boardRowY: rowY });
}

/** The top paddle's center, found the same way by its own core stripe color. */
function readOpponentX(page) {
  const { width, paddle } = GAME_CONFIG;
  const rowY = paddle.inset + paddle.height / 2;

  return board(page).evaluate((canvas, { boardWidth, boardRowY }) => {
    const scale = canvas.width / boardWidth;
    const row = canvas.getContext('2d')
      .getImageData(0, Math.round(boardRowY * scale), canvas.width, 1).data;
    let first = -1;
    let last = -1;

    for (let x = 0; x < canvas.width; x += 1) {
      const [red, green, blue] = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]];

      if (red > 240 && green > 195 && green < 220 && blue > 220) {
        first = first < 0 ? x : first;
        last = x;
      }
    }

    return first < 0 ? null : (first + last) / 2 / scale;
  }, { boardWidth: width, boardRowY: rowY });
}

/** Reads the ball's center, in board units, as the centroid of the pure-white pixels of its core. */
function readBall(page) {
  return board(page).evaluate((canvas, boardWidth) => {
    const scale = canvas.width / boardWidth;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    let sumX = 0;
    let sumY = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) {
        const pixel = i / 4;
        count += 1;
        sumX += pixel % canvas.width;
        sumY += Math.floor(pixel / canvas.width);
      }
    }

    return count === 0 ? null : { x: sumX / count / scale, y: sumY / count / scale };
  }, GAME_CONFIG.width);
}

// A point relative to an element's top-left corner; hover() and tap() scroll it into view.
async function pointOn(locator, xFraction) {
  const box = await locator.boundingBox();
  return { position: { x: box.width * xFraction, y: box.height / 2 } };
}

// A paused fake clock makes timing exact, however fast the machine is. The installed clock
// keeps flowing until paused, so pause far enough ahead to never be in the past.
async function freezeTime(page) {
  await page.clock.install({ time: 0 });
  await page.goto('/');
  await page.clock.pauseAt(60 * 60 * 1000);
}

test('Play, Space and the menus drive the match state machine', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Ping Pong Architecture Lab' })).toBeAttached();
  await expect(board(page)).toBeVisible();
  await expect(status(page)).toHaveText('First to 7. Start when ready.');

  // Clicking a control hands focus to the board, so Space pauses instead of re-clicking it.
  await playButton(page).click();
  await expect(status(page)).toContainText('You 0');
  await expect(board(page)).toBeFocused();
  await expect(playButton(page)).toBeHidden();

  await page.keyboard.press('Space');
  await expect(status(page)).toHaveText('Game paused.');
  await expect(page.getByRole('button', { name: 'Resume' }).first()).toBeVisible();

  await page.keyboard.press('Space');
  await expect(status(page)).toContainText('You 0');

  await page.keyboard.press('Escape');
  await expect(status(page)).toHaveText('Game paused.');

  await page.getByRole('button', { name: 'Menu' }).first().click();
  await expect(status(page)).toHaveText('First to 7. Start when ready.');
  await expect(playButton(page)).toBeVisible();

  await page.keyboard.press('Space');
  await expect(status(page)).toContainText('You 0');

  expect(errors).toEqual([]);
});

test('the paddle follows the mouse, and the keyboard takes over while the mouse rests on the board', async ({ page, hasTouch }) => {
  test.skip(hasTouch, 'mouse scenario; touch has its own test');

  await page.goto('/');
  await playButton(page).click();

  await board(page).hover(await pointOn(board(page), 0.75));
  await expect.poll(() => readPlayerX(page)).toBeCloseTo(0.75 * GAME_CONFIG.width, -1);

  await page.keyboard.down('ArrowLeft');
  await expect.poll(() => readPlayerX(page)).toBeLessThan(GAME_CONFIG.width / 3);
  await page.keyboard.up('ArrowLeft');
});

test('A and D steer on any keyboard layout', async ({ page }) => {
  await page.goto('/');
  await playButton(page).click();

  // With a Ukrainian layout the physical A key produces "ф".
  await board(page).dispatchEvent('keydown', { key: 'ф', code: 'KeyA', bubbles: true });
  await expect.poll(() => readPlayerX(page)).toBeLessThan(GAME_CONFIG.width / 3);
  await board(page).dispatchEvent('keyup', { key: 'ф', code: 'KeyA', bubbles: true });
});

test('on a touch screen the thumb rail below the board steers the paddle', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'touch devices only');

  await page.goto('/');
  await playButton(page).tap();

  const rail = page.locator('.rail');
  await expect(rail).toBeVisible();
  await rail.tap(await pointOn(rail, 0.25));
  await expect.poll(() => readPlayerX(page)).toBeCloseTo(0.25 * GAME_CONFIG.width, -1);

  await board(page).tap(await pointOn(board(page), 0.7));
  await expect.poll(() => readPlayerX(page)).toBeCloseTo(0.7 * GAME_CONFIG.width, -1);
});

// On a phone the layout viewport widens to fit content that overflows, so innerWidth would
// hide the overflow; clientWidth is the width of the screen itself.
const phoneLayout = (page) => page.evaluate(() => {
  const boardBox = document.querySelector('.board').getBoundingClientRect();
  const screenWidth = document.documentElement.clientWidth;
  return {
    boardHeightShare: boardBox.height / window.innerHeight,
    boardWidthShare: boardBox.width / screenWidth,
    fitsVertically: boardBox.bottom <= window.innerHeight,
    overflowsSideways: document.documentElement.scrollWidth > screenWidth,
  };
});

test('the game fills a phone screen without sideways scrolling', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'phone layout');

  await page.goto('/');
  const layout = await phoneLayout(page);

  expect(layout.boardHeightShare).toBeGreaterThan(0.6);
  expect(layout.boardWidthShare).toBeGreaterThan(0.75);
  expect(layout.fitsVertically).toBe(true);
  expect(layout.overflowsSideways).toBe(false);
});

test.describe('on the narrowest phones', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('the heads-up display tightens instead of scrolling the page sideways', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'phone layout');

    await page.goto('/');

    expect((await phoneLayout(page)).overflowsSideways).toBe(false);
    await expect(page.getByRole('button', { name: 'Sound' }).first()).toBeInViewport({ ratio: 1 });

    // The scores sit between the buttons without touching them.
    const clearance = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const parts = [...document.querySelectorAll('.scoreboard > *:not(.lives)')]
        .map((element) => element.getBoundingClientRect())
        .filter((part) => part.width > 0);
      return {
        left: Math.min(...parts.map((part) => part.left)) - box('[data-hud-pause]').right,
        right: box('.hud__group').left - Math.max(...parts.map((part) => part.right)),
      };
    });
    expect(clearance.left).toBeGreaterThanOrEqual(0);
    expect(clearance.right).toBeGreaterThanOrEqual(0);
  });
});

test('starting a match on a phone keeps the whole court in view and locks scrolling', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'phone layout');

  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 120));
  await playButton(page).tap();
  await expect(status(page)).toContainText('You 0');

  await expect.poll(() => page.evaluate(() => {
    const box = document.querySelector('.board').getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  })).toBe(true);
  expect(await page.evaluate(() => window.getComputedStyle(document.documentElement).overflow)).toBe('hidden');
});

test('the ball waits at the center before the serve', async ({ page }) => {
  await freezeTime(page);
  await playButton(page).click();

  const delayMs = GAME_CONFIG.startDelaySeconds * 1000;
  const center = { x: GAME_CONFIG.width / 2, y: GAME_CONFIG.height / 2 };

  await page.clock.runFor(delayMs / 2);
  const waiting = await readBall(page);
  expect(Math.abs(waiting.x - center.x)).toBeLessThan(2);
  expect(Math.abs(waiting.y - center.y)).toBeLessThan(2);

  await page.clock.runFor(delayMs / 2 + 300);
  expect((await readBall(page)).y).toBeGreaterThan(center.y + 50);
});

test('the chosen difficulty and sound setting survive a reload', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Hard' }).click();
  await page.getByRole('button', { name: 'Sound' }).first().click();
  await page.reload();

  await expect(page.getByRole('button', { name: 'Hard' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Sound' }).first()).toHaveAttribute('aria-pressed', 'false');
});

test.describe('with full motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a lost match ends on the result screen, and Play again starts a new one', async ({ page, hasTouch }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const requestFrame = window.requestAnimationFrame.bind(window);
      window.frameRequests = 0;
      window.requestAnimationFrame = (callback) => {
        window.frameRequests += 1;
        return requestFrame(callback);
      };
    });

    await freezeTime(page);
    await (hasTouch ? playButton(page).tap() : playButton(page).click());

    // Park the paddle in a corner; the computer scores seven points in about 23 seconds.
    const surface = hasTouch ? page.locator('.rail') : board(page);
    const corner = await pointOn(surface, 0.01);
    await (hasTouch ? surface.tap(corner) : surface.hover(corner));
    await page.clock.runFor(26_000);

    await expect(page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
    await expect(page.locator('[data-over-score]')).toHaveText('0 : 7');
    await expect(status(page)).toHaveText('Match complete — computer won.');
    await expect(page.locator('[data-hud-pause]')).toBeDisabled();

    // The victory fireworks need frames for a few seconds, then the screen goes quiet.
    await page.clock.runFor(6000);
    const framesAfterCelebration = await page.evaluate(() => window.frameRequests);
    await page.clock.runFor(2000);
    expect(await page.evaluate(() => window.frameRequests)).toBe(framesAfterCelebration);

    await page.getByRole('button', { name: 'Play again' }).click();
    await expect(status(page)).toHaveText('You 0 — 0 Computer');
    expect(errors).toEqual([]);
  });
});

test('losing window focus pauses a running match', async ({ page }) => {
  await page.goto('/');
  await playButton(page).click();
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

  await playButton(page).click();
  await expect.poll(() => page.evaluate(() => window.frameRequests)).toBeGreaterThan(5);

  await page.keyboard.press('Space');
  await expect(status(page)).toHaveText('Game paused.');
  expect(await idleActivity()).toEqual({ frames: 0, mutations: 0 });
});

test('the canvas backing store matches device pixels, up to twice the CSS size', async ({ page }) => {
  await page.goto('/');

  const size = await board(page).evaluate((canvas) => ({
    backing: canvas.width,
    expected: canvas.clientWidth * Math.min(window.devicePixelRatio, 2),
  }));

  expect(Math.abs(size.backing - size.expected)).toBeLessThanOrEqual(1);
});

test('the page is installable as an app', async ({ page, request }) => {
  await page.goto('/');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(manifestHref)).json();

  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
});

test.describe('first visit', () => {
  test.use({ tutorialSeen: false });

  const tutorial = (page) => page.getByRole('dialog', { name: 'How to play' });
  const phase = (page) => page.locator('[data-arena]').getAttribute('data-phase');

  test('the tutorial opens once as a modal dialog, and Space closes it without starting a match', async ({ page }) => {
    await page.goto('/');

    await expect(tutorial(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Got it' })).toBeFocused();

    // Space belongs to the dialog: it presses the focused button, and no match starts behind it.
    await page.keyboard.press('Space');
    await expect(tutorial(page)).toBeHidden();
    await expect(playButton(page)).toBeVisible();
    expect(await phase(page)).toBe('ready');

    await page.reload();
    await expect(playButton(page)).toBeVisible();
    await expect(tutorial(page)).toBeHidden();

    // It can be read again from the menu.
    await page.getByRole('button', { name: 'How to play' }).click();
    await expect(tutorial(page)).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(tutorial(page)).toBeHidden();
  });

  test('Escape closes the tutorial, counts as having seen it, and pauses nothing', async ({ page }) => {
    await page.goto('/');
    await expect(tutorial(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(tutorial(page)).toBeHidden();
    expect(await phase(page)).toBe('ready');

    await page.reload();
    await expect(tutorial(page)).toBeHidden();
  });
});

test('the first serve counts down from three before the ball moves', async ({ page }) => {
  await freezeTime(page);
  await playButton(page).click();

  const center = { x: GAME_CONFIG.width / 2, y: GAME_CONFIG.height / 2 };

  await page.clock.runFor(GAME_CONFIG.startDelaySeconds * 1000 - 300);
  const waiting = await readBall(page);
  expect(Math.abs(waiting.y - center.y)).toBeLessThan(2);

  await page.clock.runFor(600);
  expect(Math.abs((await readBall(page)).y - center.y)).toBeGreaterThan(30);
});

test('Rush shows the lives as hearts and ends when they run out', async ({ page, hasTouch }) => {
  await freezeTime(page);
  await page.getByRole('button', { name: /Rush/ }).click();
  await expect(page.getByRole('group', { name: 'Difficulty' })).toBeHidden();
  await expect(status(page)).toHaveText('Rush: survive as long as you can.');

  await playButton(page).click();
  await expect(page.locator('.lives__heart')).toHaveCount(3);
  await expect(page.locator('[data-label="player"]')).toHaveText('Hits');

  // Park the paddle in a corner; the computer scores every serve.
  const surface = hasTouch ? page.locator('.rail') : board(page);
  const corner = await pointOn(surface, 0.01);
  await (hasTouch ? surface.tap(corner) : surface.hover(corner));
  await page.clock.runFor(4500);
  await expect(page.locator('.lives__heart--lost')).toHaveCount(1);

  await page.clock.runFor(8500);
  await expect(page.getByRole('heading', { name: 'Run over' })).toBeVisible();
  await expect(page.locator('[data-over-score]')).toHaveText('0 hits');
});

test('two players get their own halves of the board and no thumb rail', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'multi-touch scenario');

  await page.goto('/');
  await page.getByRole('button', { name: /2P/ }).tap();
  await expect(page.locator('.rail')).toBeHidden();
  await expect(status(page)).toHaveText('First to 7. Start when ready.');

  await playButton(page).tap();
  await expect(status(page)).toHaveText('You 0 — 0 Player 2');

  // A tap on the top half moves the top paddle, one on the bottom half the bottom paddle.
  const box = await board(page).boundingBox();
  await board(page).tap({ position: { x: box.width * 0.2, y: box.height * 0.2 } });
  await board(page).tap({ position: { x: box.width * 0.8, y: box.height * 0.8 } });
  await expect.poll(() => readPlayerX(page)).toBeCloseTo(0.8 * GAME_CONFIG.width, -1);
  await expect.poll(() => readOpponentX(page)).toBeCloseTo(0.2 * GAME_CONFIG.width, -1);
});

test('the mode and the power-up switch survive a reload', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /2P/ }).click();
  await page.getByRole('button', { name: 'Power-ups' }).click();
  await page.reload();

  await expect(page.getByRole('button', { name: /2P/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Power-ups' })).toHaveAttribute('aria-pressed', 'false');
});

test('Escape and the pause screen expose music and sound switches', async ({ page }) => {
  await page.goto('/');
  await playButton(page).click();
  await page.keyboard.press('Escape');

  const pause = page.locator('[data-overlay="pause"]');
  await expect(pause).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Music' })).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Sound' })).toBeVisible();
});
