/**
 * Phone layout (design 2026-09-11 §3, D-020): pinned waveforms, bottom tab bar, touch-sized controls.
 * Runs in the `mobile` Playwright project (Pixel 7, 412 × 839, touch).
 */
import { expect, test } from '@playwright/test';
import { canvasFollowsWrap, dismissHelp, noHorizontalOverflow, ready, waitForSim } from './helpers/layout';

test.beforeEach(async ({ page }) => {
  await dismissHelp(page);
});

test('phone: single column, pinned waveforms, tab bar, settings confirm reachable, badge tap', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#ineffective-effort');
  await ready(page);
  await noHorizontalOverflow(page);
  await expect(page.getByTestId('waveforms')).toBeVisible();
  await canvasFollowsWrap(page);
  // Tab bar with Vent active; the toggles live in the Vent panel, not in the header.
  await expect(page.getByTestId('mobile-tabs')).toBeVisible();
  await expect(page.getByTestId('mtab-vent')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.app-header [data-testid="truth-toggle"]')).toHaveCount(0);
  await expect(page.getByTestId('view-toggles').getByTestId('truth-toggle')).toBeVisible();
  await expect(page.getByTestId('monitor-panel')).toBeHidden();
  // Settings: fill PEEP, the Confirm button is inside the viewport, the setting applies.
  await page.getByTestId('setting-peep').fill('8');
  await expect(page.getByTestId('confirm-settings')).toBeInViewport();
  await page.getByTestId('confirm-settings').click();
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.settings.peep === 8, undefined, { timeout: 15_000 });
  // The waveforms stay on screen while the Vent panel scrolls.
  await page.getByTestId('instructor-toggle').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('waveforms')).toBeInViewport();
  // Monitor, Loops, Learn.
  await page.getByTestId('mtab-monitor').click();
  await expect(page.getByTestId('mon-Ppeak')).toBeVisible();
  await expect(page.getByTestId('settings-panel')).toBeHidden();
  await noHorizontalOverflow(page);
  await page.getByTestId('mtab-loops').click();
  await expect(page.getByTestId('loops')).toBeVisible();
  const loop = await page.locator('.loop-canvas').first().boundingBox();
  expect(loop?.width ?? 0).toBeGreaterThan(100);
  expect(loop?.height ?? 0).toBeGreaterThan(100);
  await noHorizontalOverflow(page);
  await page.getByTestId('mtab-learn').click();
  await expect(page.getByTestId('tab-quiz')).toBeVisible();
  await page.getByTestId('tab-export').click();
  await expect(page.getByTestId('validation-link')).toBeVisible();
  await noHorizontalOverflow(page);
  // A badge tap on a coarse pointer (26 px from the top, below the 18 px strip) opens the Explain card and switches to Learn.
  await page.getByTestId('mtab-vent').click();
  await page.waitForFunction(
    () => {
      const v = window.__ventsim;
      return !!v && v.hits.some((h) => v.ctl.labels.has(h.index));
    },
    undefined,
    { timeout: 90_000 },
  );
  const tap = await page.evaluate(() => {
    const v = window.__ventsim;
    const h = v?.hits.find((x) => v.ctl.labels.has(x.index));
    const wrap = document.querySelector('[data-testid="waveforms"]');
    if (!v || !h || !wrap) throw new Error('no labelled badge on screen');
    const r = wrap.getBoundingClientRect();
    return { x: r.left + (h.x0 + h.x1) / 2, y: r.top + 26 };
  });
  await page.touchscreen.tap(tap.x, tap.y);
  await expect(page.getByTestId('mtab-learn')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('explain-card')).toBeVisible();
  // A narrower viewport: the canvas follows its container.
  await page.setViewportSize({ width: 360, height: 740 });
  await canvasFollowsWrap(page);
  await noHorizontalOverflow(page);
});

test('phone: quiz start → identify → fix through the Vent tab → debrief readable in the Learn tab', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/#ineffective-effort');
  await ready(page);
  await page.getByTestId('mtab-learn').click();
  await page.getByTestId('tab-quiz').click();
  await waitForSim(page, 25);
  await page.getByTestId('quiz-start').click();
  await page.getByTestId('quiz-pick-ineffective-effort').check();
  await page.getByTestId('quiz-submit').click();
  await page.getByTestId('quiz-fix').click();
  // The fix is made in the Vent tab; the quiz keeps running in the hidden Learn pane.
  await page.getByTestId('mtab-vent').click();
  await page.getByTestId('setting-ps').fill('6');
  await page.getByTestId('setting-ets').fill('70');
  await page.getByTestId('confirm-settings').click();
  await page.waitForFunction(() => (window.__ventsim?.ctl.status?.settings.ps ?? 0) === 6, undefined, { timeout: 15_000 });
  const t0 = await page.evaluate(() => window.__ventsim?.ctl.quiz.fixWindowStart ?? 0);
  await waitForSim(page, t0 + 61);
  await page.getByTestId('mtab-learn').click();
  await page.getByTestId('quiz-evaluate').click();
  await expect(page.getByTestId('debrief-panel')).toBeVisible();
  await expect(page.getByTestId('debrief-changes')).toContainText('PS 16 → 6 cmH2O');
  await expect(page.getByTestId('debrief-key-ps')).toBeAttached();
  // The debrief scrolls inside its pane; nothing overflows horizontally, and the waveforms stay pinned.
  const fit = await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="drawer-pane"]') as HTMLElement;
    return { scroll: pane.scrollWidth, client: pane.clientWidth };
  });
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  await page.getByTestId('debrief-physiology').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('debrief-physiology')).toBeInViewport();
  await expect(page.getByTestId('waveforms')).toBeInViewport();
  await noHorizontalOverflow(page);
});
