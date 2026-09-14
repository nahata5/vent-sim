import { expect, test, type Page } from '@playwright/test';
import { dismissHelp } from './helpers/layout';

async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 120_000 });
}
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
}

test.beforeEach(async ({ page }) => {
  await dismissHelp(page);
});

test('SIMV: mode select, base select switches the fields, tiles show mandatory and spontaneous rates', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#double-trigger');
  await ready(page);
  await page.getByTestId('mode-select').selectOption('SIMV');
  await expect(page.getByTestId('simv-base-select')).toBeVisible();
  await expect(page.getByTestId('setting-vt')).toBeVisible();
  await expect(page.getByTestId('setting-ps')).toBeVisible();
  await page.getByTestId('simv-base-select').selectOption('PC');
  await expect(page.getByTestId('setting-pinsp')).toBeVisible();
  await expect(page.getByTestId('setting-vt')).toHaveCount(0);
  await page.getByTestId('setting-rr').fill('8');
  await page.getByTestId('confirm-settings').click();
  await page.waitForFunction(() => window.__ventsim?.ctl.settings?.mode === 'SIMV', undefined, { timeout: 10_000 });
  const t = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  await waitForSim(page, t + 40);
  await expect(page.getByTestId('mon-RRmand')).toBeVisible();
  await expect(page.getByTestId('mon-RRspont')).toBeVisible();
  const rates = await page.evaluate(() => window.__ventsim?.ctl.simvRates());
  expect(rates?.mandatory ?? 0).toBeGreaterThan(5);
  expect(rates?.spontaneous ?? 0).toBeGreaterThan(3);
});
