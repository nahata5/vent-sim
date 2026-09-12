/** Shared helpers for the phone and tablet layout tests (design 2026-09-11, D-020). */
import { expect, type Page } from '@playwright/test';

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
}

export async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 120_000 });
}

/** The page must never scroll horizontally. */
export async function noHorizontalOverflow(page: Page): Promise<void> {
  const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, inner: window.innerWidth }));
  expect(o.doc, 'documentElement.scrollWidth').toBeLessThanOrEqual(o.inner);
  expect(o.body, 'body.scrollWidth').toBeLessThanOrEqual(o.inner);
}

/** The waveform canvas backing store follows its wrap (clientWidth × dpr capped at 2) and the wrap spans the viewport. */
export async function canvasFollowsWrap(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const wrap = document.querySelector('[data-testid="waveforms"]') as HTMLElement;
    const c = wrap.querySelector('canvas') as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return { width: c.width, expected: Math.round(wrap.clientWidth * dpr), wrap: wrap.clientWidth, inner: window.innerWidth };
  });
  expect(r.width).toBe(r.expected);
  expect(r.wrap).toBeGreaterThanOrEqual(r.inner - 20);
}
