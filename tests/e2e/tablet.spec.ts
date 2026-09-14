/**
 * Tablet layout (design 2026-09-11 §4, D-020): waveforms and drawer full width, panels in two columns below.
 * Runs in the `tablet` Playwright project (Nexus 10, 800 × 1280).
 */
import { expect, test } from '@playwright/test';
import { canvasFollowsWrap, dismissHelp, noHorizontalOverflow, ready } from './helpers/layout';

test.beforeEach(async ({ page }) => {
  await dismissHelp(page);
});

test('tablet: full-width waveforms, two panel columns, no tab bar, no horizontal overflow', async ({ page }) => {
  await page.goto('/#ineffective-effort');
  await ready(page);
  await noHorizontalOverflow(page);
  await expect(page.getByTestId('mobile-tabs')).toHaveCount(0);
  await expect(page.locator('.app-header [data-testid="truth-toggle"]')).toBeVisible();
  const inner = await page.evaluate(() => window.innerWidth);
  const wave = await page.getByTestId('waveforms').boundingBox();
  expect(wave?.width ?? 0).toBeGreaterThanOrEqual(inner - 24);
  expect(wave?.height ?? 0).toBeGreaterThanOrEqual(300);
  // Settings left, Monitor right, same row.
  const settings = await page.getByTestId('settings-panel').boundingBox();
  const monitor = await page.getByTestId('monitor-panel').boundingBox();
  if (!settings || !monitor) throw new Error('panels not laid out');
  expect(monitor.x).toBeGreaterThanOrEqual(settings.x + settings.width);
  expect(Math.abs(monitor.y - settings.y)).toBeLessThanOrEqual(40);
  await expect(page.getByTestId('loops')).toBeVisible();
  await expect(page.getByTestId('drawer-pane')).toBeVisible();
  // The page scrolls to the panels below the fold; the settings confirm is reachable.
  await page.getByTestId('confirm-settings').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('confirm-settings')).toBeInViewport();
  await expect(page.getByTestId('mon-Ppeak')).toBeInViewport();
  await canvasFollowsWrap(page);
});
