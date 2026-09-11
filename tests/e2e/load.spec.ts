import { expect, test, type Page } from '@playwright/test';

/** Sum of pixel values over the waveform canvas: a cheap fingerprint of what is drawn. */
async function canvasFingerprint(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.wave-canvas');
    if (!c) return -1;
    const ctx = c.getContext('2d');
    if (!ctx) return -1;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 16) s += d[i] ?? 0;
    return s;
  });
}

async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 60_000 });
}

test('loads, starts the default scenario and draws moving waveforms', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'VentSim' })).toBeVisible();
  await expect(page.getByTestId('disclaimer')).toContainText('education only');
  await waitForSim(page, 3);
  const a = await canvasFingerprint(page);
  await waitForSim(page, 5);
  const b = await canvasFingerprint(page);
  expect(a).toBeGreaterThan(0);
  expect(b).not.toBe(a);
  // Breaths are being delivered and monitored.
  await waitForSim(page, 10);
  const mon = await page.evaluate(() => window.__ventsim?.ctl.latestBreath ?? null);
  expect(mon).not.toBeNull();
  expect(mon?.ppeak ?? 0).toBeGreaterThan(10);
  await expect(page.getByTestId('mon-Vte')).not.toContainText('—');
});

test('switching scenario restarts the simulation and shows patient-triggered breaths', async ({ page }) => {
  await page.goto('/');
  await waitForSim(page, 2);
  await page.getByTestId('scenario-select').selectOption('double-trigger');
  await expect(page.getByTestId('scenario-info')).toContainText('double trigger');
  await page.waitForFunction(() => (window.__ventsim?.ctl.store.tLatest ?? 99) < 1.5, undefined, { timeout: 10_000 });
  await waitForSim(page, 15);
  const patientTriggers = await page.evaluate(() => window.__ventsim?.ctl.store.events.filter((e) => e.type === 'trigger' && e.cause === 'patient').length ?? 0);
  expect(patientTriggers).toBeGreaterThan(3);
});

test('truth layer adds channels and loops; pause, freeze and speed controls work', async ({ page }) => {
  await page.goto('/#reverse-trigger');
  await waitForSim(page, 4);
  await expect(page.getByTestId('loops').locator('canvas')).toHaveCount(2);
  await page.getByTestId('truth-toggle').click();
  await expect(page.getByTestId('loops').locator('canvas')).toHaveCount(4);
  await expect(page.getByTestId('stress-dpl')).not.toContainText('truth layer off');
  // Pause stops simulated time; resume continues it.
  await page.getByTestId('pause').click();
  const t1 = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  await page.waitForTimeout(600);
  const t2 = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  expect(t2).toBe(t1);
  await page.getByTestId('pause').click();
  await waitForSim(page, t1 + 0.5);
  // Freeze keeps the display time fixed while the simulation runs on.
  await page.getByTestId('freeze').click();
  const shown = await page.evaluate(() => window.__ventsim?.ctl.tView ?? 0);
  await waitForSim(page, shown + 1);
  expect(await page.evaluate(() => window.__ventsim?.ctl.tView ?? 0)).toBeCloseTo(shown, 3);
  await page.getByTestId('freeze').click();
  // Speed 4×: simulated time advances faster than wall time.
  await page.getByTestId('speed').selectOption('4');
  const s0 = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  await page.waitForTimeout(1000);
  const s1 = await page.evaluate(() => window.__ventsim?.ctl.store.tLatest ?? 0);
  expect(s1 - s0).toBeGreaterThan(2.5);
});

test('render budget: 7 rows + 4 loops draw in well under a 60 fps frame', async ({ page }) => {
  await page.goto('/#double-trigger');
  await waitForSim(page, 3);
  await page.getByTestId('truth-toggle').click();
  await page.evaluate(() => {
    const p = window.__ventsim?.perf;
    if (p) {
      p.frames = 0;
      p.drawMs = 0;
    }
  });
  await page.waitForTimeout(3000);
  const perf = await page.evaluate(() => {
    const p = window.__ventsim?.perf;
    return p ? { frames: p.frames, avgMs: p.drawMs / Math.max(1, p.frames), fps: p.lastFps } : null;
  });
  console.warn(`waveform draw: ${perf?.frames ?? 0} frames, ${(perf?.avgMs ?? 0).toFixed(2)} ms/frame, ${(perf?.fps ?? 0).toFixed(0)} fps (headless)`);
  expect(perf?.frames ?? 0).toBeGreaterThan(30);
  expect(perf?.avgMs ?? 99).toBeLessThan(8);
});
