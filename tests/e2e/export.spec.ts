import { expect, test, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';
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

test('session CSV and JSON download with the expected shape', async ({ page }) => {
  await page.goto('/#double-trigger');
  await fast(page);
  await waitForSim(page, 20);
  await page.getByTestId('tab-export').click();
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv-truth').click()]);
  expect(csvDl.suggestedFilename()).toBe('double-trigger-truth.csv');
  const csvPath = await csvDl.path();
  const csv = readFileSync(csvPath, 'utf8');
  expect(csv.split('\n')[0]).toContain('t,paw,flow,vol,pes,breath_id,phase,pmus');
  expect(csv.split('\n').length).toBeGreaterThan(1500);
  const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  expect(jsonDl.suggestedFilename()).toBe('double-trigger-session.json');
  const doc = JSON.parse(readFileSync((await jsonDl.path()), 'utf8')) as { schema: string; truthLabels: Array<{ patterns: string[] }>; detectorLabels: unknown[]; settingsLog: unknown[] };
  expect(doc.schema).toBe('ventsim-session/1');
  expect(doc.truthLabels.length).toBeGreaterThan(5);
  expect(doc.truthLabels.some((l) => l.patterns.includes('double-trigger'))).toBe(true);
  expect(doc.detectorLabels.length).toBeGreaterThan(0);
  expect(doc.settingsLog.length).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('export-msg')).toContainText('downloaded');
});

test('batch generator: a small grid runs in a worker and downloads a zip with CSV, JSON and manifest', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#normal-passive');
  await fast(page);
  await waitForSim(page, 2);
  await page.getByTestId('tab-export').click();
  await page.getByTestId('batch-seeds').fill('1,2');
  await page.getByTestId('batch-duration').fill('5');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), page.getByTestId('batch-run').click()]);
  expect(dl.suggestedFilename()).toBe('ventsim-batch-normal-passive.zip');
  const bytes = readFileSync((await dl.path()));
  const files = unzipSync(new Uint8Array(bytes));
  const names = Object.keys(files).sort();
  expect(names).toContain('manifest.json');
  expect(names.filter((n) => n.endsWith('.csv')).length).toBe(2);
  const manifest = JSON.parse(strFromU8(files['manifest.json'] as Uint8Array)) as { runs: unknown[] };
  expect(manifest.runs.length).toBe(2);
});
