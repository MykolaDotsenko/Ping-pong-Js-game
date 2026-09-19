import { expect, test } from '@playwright/test';

test('game shell loads without browser errors and controls the state machine', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Ping Pong Architecture Lab' })).toBeVisible();
  await expect(page.locator('[data-game-canvas]')).toBeVisible();
  await expect(page.locator('[data-game-status]')).toHaveText('First to 7. Start when ready.');

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('[data-game-status]')).toContainText('You 0');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();

  await page.locator('[data-game-canvas]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-game-status]')).toHaveText('Game paused.');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  await page.keyboard.press('Space');
  await expect(page.locator('[data-game-status]')).toContainText('You 0');

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('[data-game-status]')).toHaveText('First to 7. Start when ready.');

  expect(errors).toEqual([]);
});

test('pointer interaction is accepted on the responsive canvas', async ({ page }) => {
  await page.goto('/');

  const canvas = page.locator('[data-game-canvas]');
  const box = await canvas.boundingBox();

  expect(box).not.toBeNull();

  if (box) {
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.8);
  }

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('[data-game-status]')).toContainText('You 0');
});
