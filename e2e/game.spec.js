import { expect, test as base } from '@playwright/test';

import { NICKNAMES } from '../src/application/nicknames.js';
import { GAME_CONFIG } from '../src/config.js';

// A first visit opens the tutorial over the menu. Most tests model a returning player, so
// they store that choice before the page loads; the tutorial has a test of its own.
const test = base.extend({
  tutorialSeen: [true, { option: true }],
  /** Other preferences to store before the page loads, such as `{ jokes: false }`. */
  stored: [{}, { option: true }],
  context: async ({ context, tutorialSeen, stored }, use) => {
    // Runs before every page load, so it must not overwrite choices a test has since made.
    await context.addInitScript((preferences) => {
      const key = 'ping-pong-lab:preferences';

      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, JSON.stringify(preferences));
      }
    }, { tutorialSeen, ...stored });
    await use(context);
  },
});

const status = (page) => page.locator('[data-game-status]');
const board = (page) => page.locator('[data-game-canvas]');
const playButton = (page) => page.getByRole('button', { name: 'Play', exact: true });
const settings = (page) => page.getByRole('dialog', { name: 'Settings' });

/** Opens the settings from the menu, where every switch but sound lives. */
async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(settings(page)).toBeVisible();
  return settings(page);
}

async function closeSettings(page) {
  await settings(page).getByRole('button', { name: 'Done' }).click();
  await expect(settings(page)).toBeHidden();
}

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

  await expect(page.getByRole('heading', { name: 'Paddle Noir' })).toBeAttached();
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

/**
 * The visible controls of the arena that measure under 44 by 44 CSS pixels, the least a
 * fingertip needs, and those that spill out of the screen or overlap another.
 */
const touchProblems = (page) => page.evaluate(() => {
  const controls = [...document.querySelectorAll('[data-arena] button, [data-arena] a[href]')]
    .filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden]'))
    .map((element) => ({ name: (element.getAttribute('aria-label') ?? element.textContent).trim(), box: element.getBoundingClientRect() }));
  const small = controls.filter(({ box }) => box.width < 43.5 || box.height < 43.5).map(({ name }) => name);
  const outside = controls.filter(({ box }) => box.left < 0 || box.top < 0
    || box.right > document.documentElement.clientWidth || box.bottom > window.innerHeight).map(({ name }) => name);
  const overlapping = controls.flatMap((a, index) => controls.slice(index + 1)
    .filter((b) => Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1
      && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1)
    .map((b) => `${a.name} / ${b.name}`));
  return { small, outside, overlapping };
});

const noTouchProblems = { small: [], outside: [], overlapping: [] };

test.describe('on the smallest phone held upright', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('every control of the menu and the pause screen is fingertip-sized and on screen', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'phone layout');

    await page.goto('/');
    expect(await touchProblems(page)).toEqual(noTouchProblems);

    await playButton(page).tap();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-overlay="pause"]')).toBeVisible();
    expect(await touchProblems(page)).toEqual(noTouchProblems);
  });
});

test.describe('on a phone held sideways', () => {
  test.use({ viewport: { width: 915, height: 412 } });

  test('the court takes the full height beside a column HUD, and the menu opens as a sheet that fits', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'phone layout');

    await page.goto('/');
    expect(await touchProblems(page)).toEqual(noTouchProblems);
    const menuFits = await page.locator('[data-overlay="menu"]').evaluate((sheet) => sheet.scrollHeight <= sheet.clientHeight);
    expect(menuFits).toBe(true);

    await playButton(page).tap();
    const layout = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      return { hud: box('.hud'), board: box('.board'), height: window.innerHeight };
    });
    expect(layout.hud.right).toBeLessThanOrEqual(layout.board.left);
    expect(layout.board.height / layout.height).toBeGreaterThan(0.8);
    expect(await touchProblems(page)).toEqual(noTouchProblems);
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
  // The plain computer, so the status lines can be checked word for word.
  test.use({ reducedMotion: 'no-preference', stored: { jokes: false } });

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
    // Without the fun extras there is no "Continue?" countdown.
    await expect(page.locator('[data-continue]')).toBeHidden();

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
    await expect(tutorial(page)).toContainText('flick as you hit to fire it');
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

  // Like an arcade cabinet, the result screen offers a few seconds to continue, then gives up.
  const countdown = page.locator('[data-continue]');
  await expect(countdown).toBeVisible();
  await expect(countdown).toHaveText(/^Continue\? \d$/);
  const left = Number((await countdown.textContent()).at(-1));
  await page.clock.runFor(1000);
  await expect(countdown).toHaveText(left > 0 ? `Continue? ${left - 1}` : 'Game over');
  await page.clock.runFor(10_000);
  await expect(countdown).toHaveText('Game over');
  await expect(page.getByRole('button', { name: 'Play again' })).toBeEnabled();
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
  await (await openSettings(page)).getByRole('button', { name: 'Power-ups' }).click();
  await closeSettings(page);
  await page.reload();

  await expect(page.getByRole('button', { name: /2P/ })).toHaveAttribute('aria-pressed', 'true');
  await expect((await openSettings(page)).getByRole('button', { name: 'Power-ups' })).toHaveAttribute('aria-pressed', 'false');
});

test('the Supers switch says where it applies and survives a reload', async ({ page }) => {
  await page.goto('/');

  const supers = (await openSettings(page)).getByRole('button', { name: 'Supers' });
  await expect(supers).toHaveAccessibleDescription('Every mode but Rush');
  await expect(supers).toHaveAttribute('aria-pressed', 'true');
  await supers.click();
  await page.reload();

  await openSettings(page);
  await expect(supers).toHaveAttribute('aria-pressed', 'false');
});

test('the settings open over the menu as a dialog, and closing them starts nothing', async ({ page }) => {
  await page.goto('/');
  const phase = () => page.locator('[data-arena]').getAttribute('data-phase');

  await openSettings(page);
  await expect(settings(page).getByRole('button', { name: 'Sound' })).toBeFocused();

  // Space belongs to the dialog: it flips the focused switch, and no match starts behind it.
  await page.keyboard.press('Space');
  await expect(settings(page).getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');
  expect(await phase()).toBe('ready');

  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();
  expect(await phase()).toBe('ready');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();

  await openSettings(page);
  await closeSettings(page);
  expect(await phase()).toBe('ready');
});

test('the title screen keeps the score, the pause button and the thumb rail for the match', async ({ page, hasTouch }) => {
  await page.goto('/');
  const courtBefore = await board(page).boundingBox();

  await expect(page.locator('[data-scoreboard]')).toBeHidden();
  await expect(page.locator('[data-hud-pause]')).toBeHidden();
  await expect(page.locator('.rail')).toBeHidden();
  await expect(page.locator('.help__keys')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sound' }).first()).toBeVisible();

  await playButton(page).click();
  await expect(page.locator('[data-scoreboard]')).toBeVisible();
  await expect(page.locator('[data-hud-pause]')).toBeVisible();
  await expect(page.locator(hasTouch ? '.rail' : '.help__keys')).toBeVisible();
  expect(await board(page).boundingBox(), 'the court stays where it was').toEqual(courtBefore);

  await page.keyboard.press('Escape');
  await page.locator('[data-overlay="pause"]').getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('[data-scoreboard]')).toBeHidden();
});

/**
 * How much of the player's color shows in the bottom-left corner of the board, below the
 * paddle and inside the court's glowing border, where the super meter sits.
 */
function readMeterCorner(page) {
  const { width, height } = GAME_CONFIG;

  return board(page).evaluate((canvas, { boardWidth, boardHeight }) => {
    const scale = canvas.width / boardWidth;
    const { data } = canvas.getContext('2d').getImageData(
      Math.round(20 * scale),
      Math.round((boardHeight - 34) * scale),
      Math.round(90 * scale),
      Math.round(22 * scale),
    );
    let lit = 0;

    for (let i = 0; i < data.length; i += 4) {
      // The player's cyan, dimmed or not: far more green and blue than red.
      if (data[i + 1] > 60 && data[i + 2] > 60 && data[i] < data[i + 2] * 0.6) {
        lit += 1;
      }
    }

    return lit;
  }, { boardWidth: width, boardHeight: height });
}

test('with supers on the player\'s meter sits in the corner of the court; with them off it is gone', async ({ page }) => {
  await page.goto('/');
  await playButton(page).click();
  await expect.poll(() => readMeterCorner(page)).toBeGreaterThan(50);

  await page.keyboard.press('Escape');
  await page.locator('[data-overlay="pause"]').getByRole('button', { name: 'Menu' }).click();
  await (await openSettings(page)).getByRole('button', { name: 'Supers' }).click();
  await closeSettings(page);
  await playButton(page).click();
  await expect.poll(() => readMeterCorner(page)).toBeLessThan(10);
});

test('the computer signs in under an arcade-club nickname, until the Fun switch is turned off', async ({ page }) => {
  await page.goto('/');

  const label = page.locator('[data-label="opponent"]');
  const nickname = await label.textContent();
  expect(NICKNAMES).toContain(nickname);

  await playButton(page).click();
  await expect(status(page)).toHaveText(`You 0 — 0 ${nickname}`);
  await page.keyboard.press('Escape');
  await page.locator('[data-overlay="pause"]').getByRole('button', { name: 'Fun' }).click();
  // The switch takes effect as play goes on.
  await page.keyboard.press('Escape');

  await expect(label).toHaveText('CPU');
  await expect(status(page)).toHaveText('You 0 — 0 Computer');
  await page.reload();
  await expect(label).toHaveText('CPU', { timeout: 5000 });
});

// Runs the paused clock in small steps until the match is over, so the test sees the moment
// it ends rather than some time after.
async function runUntilMatchOver(page) {
  for (let elapsed = 0; elapsed < 20_000; elapsed += 100) {
    if ((await status(page).textContent()).startsWith('Match complete')) {
      return;
    }

    await page.clock.runFor(100);
  }

  throw new Error(`the match is still on: ${await status(page).textContent()}`);
}

// A two-player match in which nobody moves: every serve beats the paddle it heads for, the
// points alternate, and Player 2 wins 6 : 7 after about 27 seconds. Either winner of a
// two-player match gets the finisher.
async function playIdleDuo(page, hasTouch) {
  const press = (locator) => (hasTouch ? locator.tap() : locator.click());

  await freezeTime(page);
  await press(page.getByRole('button', { name: /2P/ }));
  await press(playButton(page));
  await page.clock.runFor(26_000);
  await runUntilMatchOver(page);
  await expect(status(page)).toHaveText('Match complete — player 2 won.');
}

test('a won match ends with a Pongality before the result screen, and the next match brings the paddle back', async ({ page, hasTouch }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const result = page.locator('[data-overlay="over"]');
  const playAgain = page.getByRole('button', { name: 'Play again' });

  await playIdleDuo(page, hasTouch);
  await expect(result).toBeHidden();
  await expect(page.locator('[data-hud-pause]')).toBeDisabled();

  await page.clock.runFor(1200);
  await expect(result).toBeVisible();
  await expect(playAgain).toBeFocused();

  // Once the pieces and the fireworks are gone, the loser's paddle is gone with them.
  await page.clock.runFor(6000);
  expect(await readPlayerX(page)).toBeNull();
  expect(await readOpponentX(page)).toBeCloseTo(GAME_CONFIG.width / 2, -1);

  await (hasTouch ? playAgain.tap() : playAgain.click());
  await page.clock.runFor(1000);
  expect(await readPlayerX(page)).toBeCloseTo(GAME_CONFIG.width / 2, -1);
  expect(errors).toEqual([]);
});

test('a tap or a key skips the Pongality to the result screen, and starts nothing else', async ({ page, hasTouch }) => {
  const result = page.locator('[data-overlay="over"]');

  await playIdleDuo(page, hasTouch);
  await expect(result).toBeHidden();
  await (hasTouch ? board(page).tap() : page.keyboard.press('Space'));
  await expect(result).toBeVisible();

  // Space at the result screen means Play again, but the press that skipped the finisher
  // must not count as one: the match stays over.
  await page.clock.runFor(2000);
  await expect(status(page)).toHaveText('Match complete — player 2 won.');
  await expect(result).toBeVisible();
});

/** The width of the player's paddle, in board units, measured on its core stripe like readPlayerX. */
function readPlayerWidth(page) {
  const { width, height, paddle } = GAME_CONFIG;
  const rowY = height - paddle.inset - paddle.height / 2;

  return board(page).evaluate((canvas, { boardWidth, boardRowY }) => {
    const scale = canvas.width / boardWidth;
    const row = canvas.getContext('2d').getImageData(0, Math.round(boardRowY * scale), canvas.width, 1).data;
    let first = -1;
    let last = -1;

    for (let x = 0; x < canvas.width; x += 1) {
      if (row[x * 4] > 135 && row[x * 4] < 195 && row[x * 4 + 1] > 225 && row[x * 4 + 2] > 235) {
        first = first < 0 ? x : first;
        last = x;
      }
    }

    return first < 0 ? 0 : (last - first) / scale;
  }, { boardWidth: width, boardRowY: rowY });
}

test.describe('the career', () => {
  // The first three rivals are beaten, so the ladder is open up to the first boss.
  test.use({ stored: { mode: 'career', careerStars: [3, 2, 1] } });

  test('opens the ladder as far as the rivals beaten, and names the rival as a match starts', async ({ page, hasTouch }) => {
    const press = (locator) => (hasTouch ? locator.tap() : locator.click());
    const next = page.getByRole('button', { name: 'Next rival' });

    await page.goto('/');
    await expect(page.getByRole('group', { name: 'Difficulty' })).toBeHidden();
    await expect(page.locator('[data-rival-name]')).toHaveText('Rookie Roma');
    await expect(page.getByRole('button', { name: 'Previous rival' })).toBeDisabled();
    await expect(page.locator('[data-rival-stars]')).toContainText('3 of 3 stars');

    for (const name of ['Aunt Halyna', 'Twisty Taras', 'The Janitor']) {
      await press(next);
      await expect(page.locator('[data-rival-name]')).toHaveText(name);
    }

    await expect(next).toBeDisabled();
    await expect(page.locator('[data-rival-boss]')).toBeVisible();
    await expect(page.locator('[data-menu-meta]')).toContainText('bucket');

    await press(playButton(page));
    await expect(status(page)).toHaveText('You 0 — 0 The Janitor');
    await expect(page.locator('[data-label="opponent"]')).toHaveText('Janitor');
    await expect(page.locator('[data-rival-banner]')).toContainText('The Janitor');
  });

  test.describe('against the first boss', () => {
    test.use({ stored: { mode: 'career', careerStars: [3, 2, 1], rival: 3 } });

    test('a drip from the boss shrinks the paddle of a player who stands still', async ({ page, hasTouch }) => {
      // A fixed seed makes the match replay the same way: a point clears drips still falling,
      // so the seed decides which volley lands.
      await page.addInitScript(() => {
        Math.random = () => 0.5;
      });
      await freezeTime(page);
      await (hasTouch ? playButton(page).tap() : playButton(page).click());

      // Stand still in the middle: one drip of every attack is aimed at the player.
      const surface = hasTouch ? page.locator('.rail') : board(page);
      const middle = await pointOn(surface, 0.5);
      await (hasTouch ? surface.tap(middle) : surface.hover(middle));
      await page.clock.runFor(3000);

      const normal = await readPlayerWidth(page);
      expect(normal).toBeGreaterThan(80);

      // The first attack comes seven to ten seconds into play, after any serve pauses, and a
      // drip takes over a second to fall; with this seed the first volley lands.
      let shrunk = normal;

      for (let elapsed = 0; elapsed < 27_000 && shrunk > normal * 0.8; elapsed += 250) {
        await page.clock.runFor(250);
        shrunk = await readPlayerWidth(page);
      }

      expect(shrunk).toBeLessThan(normal * 0.8);
    });
  });

  test('a lost career match counts down to game over, and the same rival waits for a rematch', async ({ page, hasTouch }) => {
    await freezeTime(page);
    await (hasTouch ? playButton(page).tap() : playButton(page).click());

    // Park the paddle in a corner; Rookie Roma's slow ball scores seven points in about 40 seconds.
    const surface = hasTouch ? page.locator('.rail') : board(page);
    const corner = await pointOn(surface, 0.01);
    await (hasTouch ? surface.tap(corner) : surface.hover(corner));
    await page.clock.runFor(30_000);
    await runUntilMatchOver(page);

    await expect(page.getByRole('heading', { name: 'Defeat' })).toBeVisible();
    await expect(page.locator('[data-over-difficulty]')).toHaveText('Career 1/9 · vs Rookie Roma');
    await expect(page.locator('[data-continue]')).toBeVisible();
    await expect(page.locator('[data-over-stars]')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
  });
});

test('Escape and the pause screen expose music and sound switches', async ({ page }) => {
  await page.goto('/');
  await playButton(page).click();
  await page.keyboard.press('Escape');

  const pause = page.locator('[data-overlay="pause"]');
  await expect(pause).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Music', exact: true })).toBeVisible();
  await expect(pause.getByRole('button', { name: 'Sound' })).toBeVisible();
});

test('the track button cycles the music, plays a sample of each track and remembers the pick', async ({ page }) => {
  // Count the notes the page schedules, to hear the preview without speakers.
  await page.addInitScript(() => {
    window.scheduledNotes = 0;
    const create = window.AudioContext.prototype.createOscillator;
    window.AudioContext.prototype.createOscillator = function createOscillator() {
      window.scheduledNotes += 1;
      return create.call(this);
    };
  });
  await page.goto('/');

  const track = (await openSettings(page)).getByRole('button', { name: /^Music track:/ });
  await expect(track).toHaveAccessibleName('Music track: Neon');

  await track.click();
  await expect(track).toHaveAccessibleName('Music track: Arena');
  await expect(track).toContainText('Arena');
  await expect.poll(() => page.evaluate(() => window.scheduledNotes)).toBeGreaterThan(0);

  for (const name of ['Anthem', 'Contender', 'Iron', 'Neon', 'Arena']) {
    await track.click();
    await expect(track).toHaveAccessibleName(`Music track: ${name}`);
  }

  await page.reload();
  await expect((await openSettings(page)).getByRole('button', { name: /^Music track:/ })).toHaveAccessibleName('Music track: Arena');
  await closeSettings(page);

  await playButton(page).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-overlay="pause"]').getByRole('button', { name: 'Music track: Arena' })).toBeVisible();
});
