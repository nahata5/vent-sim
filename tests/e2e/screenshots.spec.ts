/**
 * Documentation screenshots (PROGRESS.md). Runs only with SCREENSHOTS=1 so CI stays fast:
 *   SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts
 */
import { test, type Page } from '@playwright/test';

const enabled = process.env.SCREENSHOTS === '1';

async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 120_000 });
}

test.skip(!enabled, 'set SCREENSHOTS=1 to capture documentation screenshots');

test('m6: ineffective effort with detector badges, truth row and AI tile', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#ineffective-effort');
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
  await waitForSim(page, 50);
  await page.evaluate(() => {
    const ctl = window.__ventsim?.ctl;
    if (!ctl) return;
    ctl.setTruth(true);
    ctl.setSweep(24);
    ctl.freeze(true);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/m6-ineffective-effort-badges.png' });
});

test('m6: validation page', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1200 });
  await page.goto('/#validation');
  await page.getByTestId('validation-page').waitFor();
  await page.screenshot({ path: 'docs/screenshots/m6-validation.png', fullPage: true });
});
