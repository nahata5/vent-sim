/**
 * Documentation screenshots (PROGRESS.md). Runs only with SCREENSHOTS=1 so CI stays fast:
 *   SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts
 */
import { devices, test, type Page } from '@playwright/test';

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

test('m7: recruiter after the R/I release with the truth layer (recruited volume, R/I row)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#peep-trial-recruiter');
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
  await waitForSim(page, 10);
  await page.evaluate(() => window.__ventsim?.ctl.setTruth(true));
  await page.getByTestId('maneuver-ri').click();
  await page.waitForFunction(() => window.__ventsim?.ctl.maneuvers.ri !== null, undefined, { timeout: 90_000 });
  await page.evaluate(() => {
    const ctl = window.__ventsim?.ctl;
    if (!ctl) return;
    ctl.setSweep(24);
    ctl.freeze(true);
    ctl.scrollTo((ctl.maneuvers.ri?.tStart ?? ctl.store.tLatest) + 10);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/m7-ri-recruiter.png' });
});

test('m7: CO2 over-assist panel during the apnea cycle', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#co2-over-assist');
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
  await waitForSim(page, 45);
  await page.evaluate(() => {
    const ctl = window.__ventsim?.ctl;
    if (!ctl) return;
    ctl.setSweep(24);
    ctl.freeze(true);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/m7-co2-over-assist.png' });
});

test('m8: explain card for a delayed-cycling breath with case-specific evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#ineffective-effort');
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
  await waitForSim(page, 40);
  await page.waitForFunction(() => (window.__ventsim?.ctl.latestLabelledBreath() ?? null) !== null, undefined, { timeout: 60_000 });
  await page.evaluate(() => {
    const ctl = window.__ventsim?.ctl;
    if (!ctl) return;
    ctl.setTruth(true);
    ctl.setSweep(24);
    ctl.freeze(true);
    ctl.setDrawerTab('explain');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/m8-explain-card.png' });
});

test('m8: quiz result after identifying and fixing premature cycling', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#premature-cycling');
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
  await waitForSim(page, 25);
  await page.getByTestId('tab-quiz').click();
  await page.getByTestId('quiz-start').click();
  await page.getByTestId('quiz-pick-premature-cycling').check();
  await page.getByTestId('quiz-pick-double-trigger').check();
  await page.getByTestId('quiz-submit').click();
  await page.getByTestId('quiz-fix').click();
  await page.getByTestId('tab-scenario').click();
  await page.getByTestId('apply-fix').click();
  await page.getByTestId('tab-quiz').click();
  const t0 = await page.evaluate(() => window.__ventsim?.ctl.quiz.fixWindowStart ?? 0);
  await waitForSim(page, t0 + 61);
  await page.getByTestId('quiz-evaluate').click();
  await page.getByTestId('quiz-result').waitFor();
  await page.evaluate(() => window.__ventsim?.ctl.freeze(true));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/m8-quiz-result.png' });
});

test('m6: validation page', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1200 });
  await page.goto('/#validation');
  await page.getByTestId('validation-page').waitFor();
  await page.screenshot({ path: 'docs/screenshots/m6-validation.png', fullPage: true });
});

// Mobile layout (D-020): phone and tablet device emulation inside the chromium project (the descriptor's
// browser type cannot be set inside a describe block, so it is dropped; both devices are Chromium anyway).
function emulate(name: string) {
  const d: Record<string, unknown> = { ...devices[name] };
  delete d.defaultBrowserType;
  return d;
}

test.describe('phone', () => {
  test.use(emulate('Pixel 7'));

  test('phone: Vent tab with the waveforms pinned', async ({ page }) => {
    await page.goto('/#ineffective-effort');
    await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
    await waitForSim(page, 30);
    await page.evaluate(() => window.__ventsim?.ctl.freeze(true));
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/screenshots/mobile-phone-vent.png' });
  });

  test('phone: Learn tab, quiz idle, and the Monitor tab', async ({ page }) => {
    await page.goto('/#ineffective-effort');
    await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
    await waitForSim(page, 30);
    await page.evaluate(() => window.__ventsim?.ctl.freeze(true));
    await page.getByTestId('mtab-learn').click();
    await page.getByTestId('tab-quiz').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/screenshots/mobile-phone-learn.png' });
    await page.getByTestId('mtab-monitor').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/screenshots/mobile-phone-monitor.png' });
  });
});

test.describe('tablet', () => {
  test.use(emulate('Nexus 10'));

  test('tablet: full-width waveforms, two panel columns', async ({ page }) => {
    await page.goto('/#ineffective-effort');
    await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
    await waitForSim(page, 30);
    await page.evaluate(() => window.__ventsim?.ctl.freeze(true));
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/screenshots/mobile-tablet.png', fullPage: true });
  });
});
