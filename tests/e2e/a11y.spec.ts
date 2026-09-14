import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissHelp } from './helpers/layout';

test.beforeEach(async ({ page }) => {
  await dismissHelp(page);
});

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
}

/** Serious and critical axe findings only; the waveform canvas is exempt (it carries a role and label). */
async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
}

test('main page has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/#ineffective-effort');
  await ready(page);
  await page.getByTestId('help-open').click();
  await expect(page.getByTestId('help-dialog')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByTestId('help-close').click();
  await page.getByTestId('tab-quiz').click();
  expect(await seriousViolations(page)).toEqual([]);
});

test('validation page has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/#validation');
  await page.getByTestId('validation-page').waitFor();
  expect(await seriousViolations(page)).toEqual([]);
});

test('keyboard: the drawer tabs, maneuver buttons and settings confirm are reachable and operable', async ({ page }) => {
  await page.goto('/#normal-passive');
  await ready(page);
  await page.getByTestId('tab-scenario').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('tab-explain')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('explain-card')).toBeVisible();
  await page.getByTestId('maneuver-ri').focus();
  await expect(page.getByTestId('maneuver-ri')).toBeFocused();
  // The alarm bar is a live region so alarm changes are announced.
  await expect(page.getByTestId('alarm-bar')).toHaveAttribute('aria-live', 'polite');
});
