import { expect, test, type Page } from '@playwright/test';

async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 120_000 });
}

async function fast(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
}

test('quiz: identify the pattern with the badges hidden, apply the fix, evaluate after 60 s and record progress', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#premature-cycling');
  await fast(page);
  await waitForSim(page, 25);
  await page.getByTestId('tab-quiz').click();
  await page.getByTestId('quiz-start').click();
  await expect(page.getByTestId('quiz-panel')).toHaveAttribute('data-phase', 'identify');
  // Badges are hidden during identification.
  expect(await page.evaluate(() => window.__ventsim?.ctl.view.badges)).toBe(false);
  const truth = await page.evaluate(() => window.__ventsim?.ctl.quizTruthPatterns() ?? []);
  expect(truth).toContain('premature-cycling');
  await page.getByTestId('quiz-pick-premature-cycling').check();
  await page.getByTestId('quiz-pick-double-trigger').check();
  await page.getByTestId('quiz-submit').click();
  await expect(page.getByTestId('quiz-identification')).toContainText(/Identification \d+ %/);
  expect(await page.evaluate(() => window.__ventsim?.ctl.view.badges)).toBe(true);
  await page.getByTestId('quiz-fix').click();
  await expect(page.getByTestId('quiz-panel')).toHaveAttribute('data-phase', 'fix');
  // Apply the scenario's suggested fix (counts as setting changes) and let 60 s of simulation pass.
  await page.getByTestId('tab-scenario').click();
  await page.getByTestId('apply-fix').click();
  await page.getByTestId('tab-quiz').click();
  const t0 = await page.evaluate(() => window.__ventsim?.ctl.quiz.fixWindowStart ?? 0);
  await waitForSim(page, t0 + 61);
  await expect(page.getByTestId('quiz-evaluate')).toBeEnabled();
  await page.getByTestId('quiz-evaluate').click();
  await expect(page.getByTestId('quiz-result')).toBeVisible();
  const pass = await page.getByTestId('quiz-result').getAttribute('data-pass');
  expect(pass).toBe('1');
  const score = Number(await page.getByTestId('quiz-result').getAttribute('data-score'));
  expect(score).toBeGreaterThan(50);
  // Progress persisted in localStorage.
  const stored = await page.evaluate(() => localStorage.getItem('ventsim.progress.v1') ?? '');
  expect(stored).toContain('premature-cycling');
  await page.getByTestId('quiz-end').click();
  await expect(page.getByTestId('quiz-panel')).toHaveAttribute('data-phase', 'idle');
  await expect(page.getByTestId('scenario-select')).toContainText('best');
});

test('explain card: opens for the latest labelled breath with case-specific evidence', async ({ page }) => {
  await page.goto('/#ineffective-effort');
  await fast(page);
  await waitForSim(page, 40);
  await page.waitForFunction(() => (window.__ventsim?.ctl.latestLabelledBreath() ?? null) !== null, undefined, { timeout: 60_000 });
  await page.getByTestId('tab-explain').click();
  await expect(page.getByTestId('explain-card')).toBeVisible();
  await expect(page.getByTestId('explain-card')).toContainText('In this breath');
  await expect(page.getByTestId('explain-card')).toContainText(/Fixes, in order|Ineffective effort/);
});

test('instructor: loading an edited scenario JSON restarts the simulation with the new title', async ({ page }) => {
  await page.goto('/#normal-passive');
  await fast(page);
  await waitForSim(page, 3);
  await page.getByTestId('instructor-toggle').click();
  await page.getByTestId('instr-current').click();
  const json = await page.getByTestId('instr-json').inputValue();
  const edited = json.replace('"id": "normal-passive"', '"id": "custom-1"').replace(/"peep": \d+/, '"peep": 9').replace(/"title": "[^"]*"/, '"title": "Custom edit"');
  await page.getByTestId('instr-json').fill(edited);
  await page.getByTestId('instr-load').click();
  await expect(page.getByTestId('instr-msg')).toContainText('loaded');
  await page.waitForFunction(() => window.__ventsim?.ctl.scenario?.id === 'custom-1' && (window.__ventsim?.ctl.status?.settings.peep ?? 0) === 9, undefined, { timeout: 15_000 });
});
