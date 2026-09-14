import { expect, test, type Page } from '@playwright/test';
import { dismissHelp } from './helpers/layout';

test.beforeEach(async ({ page }) => {
  await dismissHelp(page);
});

async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 60_000 });
}

test('a setting stays pending until confirmed, then the waveform and monitor change', async ({ page }) => {
  await page.goto('/#normal-passive');
  await waitForSim(page, 8);
  const peepBefore = await page.evaluate(() => window.__ventsim?.ctl.latestBreath?.peepMeasured ?? NaN);
  expect(peepBefore).toBeGreaterThan(4);
  expect(peepBefore).toBeLessThan(6.5);

  const peep = page.getByTestId('setting-peep');
  await peep.fill('12');
  // Pending, not applied: the ventilator still reports PEEP 5 and the field is highlighted.
  await expect(page.locator('.field.pending')).toHaveCount(1);
  expect(await page.evaluate(() => window.__ventsim?.ctl.settings?.peep)).toBe(5);
  await page.getByTestId('confirm-settings').click();
  await expect(page.locator('.field.pending')).toHaveCount(0);
  await page.waitForFunction(() => window.__ventsim?.ctl.settings?.peep === 12, undefined, { timeout: 5_000 });

  // Two breaths later the measured PEEP has risen and the Paw baseline moved.
  const t = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  await waitForSim(page, t + 10);
  const after = await page.evaluate(() => {
    const ctl = window.__ventsim?.ctl;
    return { peep: ctl?.latestBreath?.peepMeasured ?? NaN, paw: ctl?.store.valueAt('paw', ctl.store.tLatest) ?? NaN };
  });
  expect(after.peep).toBeGreaterThan(10.5);
  await expect(page.getByTestId('mon-PEEP')).toContainText(/1[1-3]\./);
});

test('changing a next-breath setting (Vt) shows the "next breath" chip and then applies', async ({ page }) => {
  await page.goto('/#normal-passive');
  await waitForSim(page, 6);
  await page.getByTestId('setting-vt').fill('600');
  await page.getByTestId('confirm-settings').click();
  await expect(page.locator('.chip-pending').first()).toBeVisible();
  await page.waitForFunction(() => window.__ventsim?.ctl.settings?.vt === 600, undefined, { timeout: 10_000 });
  const t = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  await waitForSim(page, t + 10);
  const vte = await page.evaluate(() => window.__ventsim?.ctl.latestBreath?.vte ?? 0);
  expect(vte).toBeGreaterThan(560);
});

test('an inspiratory hold produces a plateau, driving pressure and a dashboard band', async ({ page }) => {
  await page.goto('/#ards-pulmonary');
  await waitForSim(page, 6);
  await page.getByRole('button', { name: 'Insp hold' }).click();
  await page.waitForFunction(() => window.__ventsim?.ctl.maneuvers.inspHold !== null, undefined, { timeout: 15_000 });
  const t = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  await waitForSim(page, t + 4);
  await expect(page.getByTestId('mon-Pplat')).not.toContainText('—');
  await expect(page.getByTestId('stress-dp')).toHaveClass(/band-(ok|danger)/);
  const dp = await page.evaluate(() => window.__ventsim?.ctl.latestBreath?.drivingPressure ?? NaN);
  expect(dp).toBeGreaterThan(5);
  expect(dp).toBeLessThan(30);
});
