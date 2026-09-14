import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
}

test('help: opens once on first visit, closes, stays closed on reload, reopens from the header button', async ({ page }) => {
  await page.goto('/#normal-passive');
  await ready(page);
  const dialog = page.getByTestId('help-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('How to use VentSim');
  await expect(dialog).toContainText('APRV (not in this version yet)');
  await expect(dialog).toContainText('SIMV');
  await expect(dialog).toContainText('PRVC');
  await expect(dialog).toContainText('authoring prompt');
  await page.getByTestId('help-close').click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await ready(page);
  await expect(dialog).toBeHidden();
  await page.getByTestId('help-open').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('help: available in the locked quiz view', async ({ page }) => {
  await page.goto('/#copd?quiz=bedside');
  await ready(page);
  await page.getByTestId('help-close').click();
  await page.getByTestId('help-open').click();
  await expect(page.getByTestId('help-dialog')).toBeVisible();
});
