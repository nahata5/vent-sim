import { expect, test, type Page } from '@playwright/test';
import { dismissHelp } from './helpers/layout';

test.beforeEach(async ({ page }) => {
  await dismissHelp(page);
});

async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 120_000 });
}

async function fast(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
}

test('R/I maneuver: the release runs from the monitor button and the dashboard shows the ratio with its pieces', async ({ page }) => {
  await page.goto('/#peep-trial-recruiter');
  await fast(page);
  await waitForSim(page, 12);
  await page.getByTestId('maneuver-ri').click();
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.peepManeuver === 'ri', undefined, { timeout: 10_000 });
  await expect(page.getByTestId('maneuver-ri')).toBeDisabled();
  await page.waitForFunction(() => window.__ventsim?.ctl.maneuvers.ri !== null, undefined, { timeout: 60_000 });
  const ri = await page.evaluate(() => window.__ventsim?.ctl.maneuvers.ri?.values ?? null);
  expect(ri).not.toBeNull();
  expect(ri?.ri ?? 0).toBeGreaterThan(0.2);
  await expect(page.getByTestId('stress-ri')).toContainText(/\d\.\d\d/);
  await expect(page.getByTestId('stress-ri')).toContainText(/recruiter|low/);
  await expect(page.getByTestId('dashboard')).toContainText('ΔVrelease');
  // PEEP is back at the scenario's setting and the button is available again.
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.peepManeuver === null && window.__ventsim?.ctl.status?.settings.peep === 15, undefined, { timeout: 10_000 });
  await expect(page.getByTestId('maneuver-ri')).toBeEnabled();
});

test('decremental PEEP trial: the table fills step by step and names the best-compliance PEEP', async ({ page }) => {
  test.setTimeout(180_000); // 9 steps × 6 breaths ≈ 190 s of simulation at 4×
  await page.goto('/#peep-trial-non-recruiter');
  await fast(page);
  await waitForSim(page, 8);
  await page.getByTestId('maneuver-peep-trial').click();
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.peepManeuver === 'peep-trial', undefined, { timeout: 10_000 });
  // PEEP jumps to the trial start immediately.
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.settings.peep === 20, undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__ventsim?.ctl.maneuvers.peepTrial !== null, undefined, { timeout: 120_000 });
  const rows = page.getByTestId('peep-trial-step');
  await expect(rows).toHaveCount(9);
  await expect(page.getByTestId('peep-trial-table')).toContainText('best compliance at PEEP');
  const best = await page.evaluate(() => window.__ventsim?.ctl.maneuvers.peepTrial?.values?.bestPeep ?? -1);
  expect(best).toBeGreaterThanOrEqual(4);
  expect(best).toBeLessThanOrEqual(12);
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.settings.peep === 15, undefined, { timeout: 10_000 });
});

test('CO2 panel: PaCO2 moves with the loop and the warp control changes how fast it moves', async ({ page }) => {
  await page.goto('/#co2-over-assist');
  await fast(page);
  await expect(page.getByTestId('co2-panel')).toBeVisible();
  await waitForSim(page, 6);
  const p0 = await page.evaluate(() => window.__ventsim?.ctl.status?.co2?.paCO2 ?? NaN);
  await waitForSim(page, 12);
  const p1 = await page.evaluate(() => window.__ventsim?.ctl.status?.co2?.paCO2 ?? NaN);
  expect(Math.abs(p1 - p0)).toBeGreaterThan(0.5); // warp ×10 already moves PaCO2 within seconds
  // Warp ×1: the same simulated interval moves PaCO2 about ten times less.
  await page.getByTestId('co2-warp').selectOption('1');
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.co2?.warp === 1, undefined, { timeout: 5_000 });
  const t2 = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  const p2 = await page.evaluate(() => window.__ventsim?.ctl.status?.co2?.paCO2 ?? NaN);
  await waitForSim(page, t2 + 6);
  const p3 = await page.evaluate(() => window.__ventsim?.ctl.status?.co2?.paCO2 ?? NaN);
  expect(Math.abs(p3 - p2)).toBeLessThan(Math.abs(p1 - p0));
  await expect(page.getByTestId('co2-paco2')).toContainText('mmHg');
  await expect(page.getByTestId('co2-panel')).toContainText('time warp ×1');
});

test('truth layer: the recruited-volume row and the tidal-recruitment badge code exist', async ({ page }) => {
  await page.goto('/#peep-trial-recruiter');
  await fast(page);
  await waitForSim(page, 6);
  await expect(page.getByTestId('stress-recruited')).toContainText('truth layer off');
  await page.getByTestId('truth-toggle').click();
  await expect(page.getByTestId('stress-recruited')).toContainText('mL');
  await expect(page.getByTestId('dashboard')).toContainText('% of units open');
});

test('schematic SpO2 tile: labelled schematic, a number for the normal lung, lower in pulmonary ARDS on the same FiO2', async ({ page }) => {
  await page.goto('/#normal-passive');
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
  await page.waitForFunction(() => (window.__ventsim?.ctl.latestSpo2 ?? null) !== null, undefined, { timeout: 60_000 });
  const tile = page.getByTestId('mon-SpO2');
  await expect(tile).toContainText('schematic');
  const normal = await page.evaluate(() => window.__ventsim?.ctl.latestSpo2?.spo2 ?? 0);
  expect(normal).toBeGreaterThan(95);
  await page.goto('/#ards-pulmonary');
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
  await page.waitForFunction(() => (window.__ventsim?.ctl.latestSpo2 ?? null) !== null, undefined, { timeout: 60_000 });
  const ards = await page.evaluate(() => window.__ventsim?.ctl.latestSpo2?.spo2 ?? 0);
  expect(ards).toBeLessThan(normal);
});
