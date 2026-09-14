import { expect, test, type Page } from '@playwright/test';
import { dismissHelp } from './helpers/layout';

test.beforeEach(async ({ page }) => {
  await dismissHelp(page);
});

async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 90_000 });
}

async function fast(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
}

test('pattern badges: the detector labels ineffective efforts live and shows evidence on hover', async ({ page }) => {
  await page.goto('/#ineffective-effort');
  await fast(page);
  await waitForSim(page, 45);
  await page.waitForFunction(
    () => {
      const ctl = window.__ventsim?.ctl;
      if (!ctl) return false;
      return [...ctl.labels.values()].some((l) => l.det?.patterns.includes('ineffective-effort') || l.det?.patterns.includes('delayed-cycling'));
    },
    undefined,
    { timeout: 60_000 },
  );
  // The main-thread analysis stays cheap.
  const ms = await page.evaluate(() => window.__ventsim?.ctl.analysisMs ?? 0);
  expect(ms).toBeLessThan(150);
  // Freeze the view on a labelled breath (24 s sweep) so its badge is on screen, then hover it.
  await page.evaluate(() => {
    const ctl = window.__ventsim?.ctl;
    if (!ctl) return;
    const l = [...ctl.labels.values()].find((x) => (x.det?.patterns.length ?? 0) > 0);
    ctl.setSweep(24);
    ctl.scrollTo((l?.det?.tStart ?? ctl.store.tLatest) + 3);
  });
  await page.waitForFunction(
    () => {
      const ctl = window.__ventsim?.ctl;
      return (window.__ventsim?.hits ?? []).some((h) => (ctl?.labels.get(h.index)?.det?.patterns.length ?? 0) > 0);
    },
    undefined,
    { timeout: 10_000 },
  );
  const hit = await page.evaluate(() => {
    const hits = window.__ventsim?.hits ?? [];
    const ctl = window.__ventsim?.ctl;
    const h = hits.find((x) => (ctl?.labels.get(x.index)?.det?.patterns.length ?? 0) > 0);
    return h ? { x: (h.x0 + h.x1) / 2 } : null;
  });
  expect(hit).not.toBeNull();
  const box = await page.getByTestId('waveforms').boundingBox();
  expect(box).not.toBeNull();
  if (!box || !hit) return;
  await page.mouse.move(box.x + hit.x, box.y + 8);
  const readout = page.getByTestId('cursor-readout');
  await expect(readout).toBeVisible();
  await expect(readout).toContainText(/≥|<|>/);
});

test('AI tile: the double-trigger scenario reports a severe asynchrony index', async ({ page }) => {
  await page.goto('/#double-trigger');
  await fast(page);
  await waitForSim(page, 40);
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="mon-AI"]')?.getAttribute('data-ai') ?? '0') > 10, undefined, { timeout: 60_000 });
  await expect(page.getByTestId('mon-AI')).toContainText('%');
  await expect(page.getByTestId('mon-AI')).toHaveClass(/tile-warn/);
});

test('injector panel: toggling the leak live raises the measured leak', async ({ page }) => {
  await page.goto('/#normal-passive');
  await fast(page);
  await waitForSim(page, 8);
  await page.getByTestId('inj-leak').check();
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.injectors.includes('leak') === true, undefined, { timeout: 10_000 });
  const t = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  await waitForSim(page, t + 12);
  const leak = await page.evaluate(() => window.__ventsim?.ctl.latestBreath?.leakPct ?? 0);
  expect(leak).toBeGreaterThan(5);
  await expect(page.getByTestId('inj-leak')).toBeChecked();
});

test('apply suggested fix: the scenario fix brings the asynchrony index down', async ({ page }) => {
  await page.goto('/#premature-cycling');
  await fast(page);
  await waitForSim(page, 30);
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="mon-AI"]')?.getAttribute('data-ai') ?? '0') > 10, undefined, { timeout: 60_000 });
  await page.getByTestId('apply-fix').click();
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.settings.ets === 0.05, undefined, { timeout: 10_000 });
  await expect(page.getByTestId('apply-fix')).toBeDisabled();
});

test('validation page shows the emergence matrix and the held-out confusion matrices', async ({ page }) => {
  await page.goto('/#validation');
  await expect(page.getByTestId('validation-page')).toBeVisible();
  expect(await page.getByTestId('emergence-row').count()).toBeGreaterThanOrEqual(10);
  for (const p of ['ineffective-effort', 'double-trigger', 'auto-trigger', 'premature-cycling', 'delayed-cycling', 'flow-starvation', 'reverse-trigger']) {
    await expect(page.getByTestId(`confusion-${p}`)).toBeVisible();
  }
  await expect(page.getByTestId('confusion-double-trigger')).toContainText('sensitivity');
});
