import { expect, test, type Page } from '@playwright/test';
import { dismissHelp } from './helpers/layout';

test.beforeEach(async ({ page }) => {
  await dismissHelp(page);
});

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
}

test('authoring: load the example, validate, save to My scenarios, reload and find it in the picker', async ({ page }) => {
  await page.goto('/#normal-passive');
  await ready(page);
  await page.getByTestId('instructor-toggle').click();
  await page.getByTestId('author-load-example').click();
  await expect(page.getByTestId('instr-json')).toHaveValue(/example-obesity-pc-short-ti/);
  await page.getByTestId('author-validate').click();
  await expect(page.getByTestId('instr-msg')).toContainText('valid');
  await page.getByTestId('author-save').click();
  await expect(page.getByTestId('picker-custom-group')).toHaveCount(1);
  await expect(page.getByTestId('custom-row')).toHaveCount(1);
  // Saved and loaded: the running scenario is the example.
  await page.waitForFunction(() => window.__ventsim?.ctl.scenario?.id === 'example-obesity-pc-short-ti');
  await page.reload();
  await ready(page);
  await expect(page.locator('[data-testid="scenario-select"] option[value="example-obesity-pc-short-ti"]')).toHaveCount(1);
  await page.getByTestId('scenario-select').selectOption('example-obesity-pc-short-ti');
  await page.waitForFunction(() => window.__ventsim?.ctl.scenario?.id === 'example-obesity-pc-short-ti');
});

test('authoring: a bad scenario lists its errors by field and is not saved', async ({ page }) => {
  await page.goto('/#normal-passive');
  await ready(page);
  await page.getByTestId('instructor-toggle').click();
  await page.getByTestId('instr-json').fill('{"id":"x","title":"Bad","phenotype":"martian","settings":{"mode":"PSV","ps":99}}');
  await page.getByTestId('author-save').click();
  const errors = page.getByTestId('author-errors');
  await expect(errors).toContainText('"phenotype"');
  await expect(errors).toContainText('settings.ps');
  await expect(page.getByTestId('picker-custom-group')).toHaveCount(0);
});

test('authoring: the prompt is exposed for copying', async ({ page }) => {
  await page.goto('/#normal-passive');
  await ready(page);
  await page.getByTestId('instructor-toggle').click();
  await page.getByTestId('author-copy-prompt').click();
  await expect(page.getByTestId('author-prompt-field')).toHaveValue(/INTERVIEW FIRST/);
});
