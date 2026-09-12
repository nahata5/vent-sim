/**
 * Quiz bedside view (design 2026-09-11, D-019): a locked quiz link hides the source material, the debrief
 * on evaluate reveals it; a plain hash keeps the M8 behaviour; the instructor's checkboxes set the hide set.
 */
import { expect, test, type Page } from '@playwright/test';

async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 120_000 });
}

async function fast(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
}

test('bedside quiz link: locked view hides the source material, the debrief reveals it', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/#ineffective-effort?quiz=bedside');
  await fast(page);
  // Locked and hidden before the quiz starts.
  expect(await page.evaluate(() => window.__ventsim?.ctl.view.quizLocked)).toBe(true);
  expect(await page.evaluate(() => window.__ventsim?.ctl.settingsChangeLog.length)).toBe(0);
  await expect(page.getByTestId('truth-toggle')).toBeDisabled();
  await expect(page.getByTestId('instructor-panel')).toHaveCount(0);
  await expect(page.getByTestId('tab-explain')).toHaveCount(0);
  await expect(page.getByTestId('dashboard')).toHaveCount(0);
  await expect(page.getByTestId('validation-link')).toHaveCount(0);
  await expect(page.getByTestId('scenario-select')).toBeDisabled();
  await expect(page.getByTestId('quiz-panel')).toBeVisible();
  await page.getByTestId('tab-scenario').click();
  await expect(page.getByTestId('scenario-info')).toContainText('Case');
  await expect(page.getByTestId('scenario-info')).not.toContainText('Ineffective');
  await expect(page.getByTestId('apply-fix')).toHaveCount(0);
  await page.getByTestId('tab-quiz').click();
  // Start, identify, fix through the settings panel.
  await waitForSim(page, 25);
  await page.getByTestId('quiz-start').click();
  await page.getByTestId('quiz-pick-ineffective-effort').check();
  await page.getByTestId('quiz-submit').click();
  // Truth hidden: badges stay off through the fix phase.
  expect(await page.evaluate(() => window.__ventsim?.ctl.view.badges)).toBe(false);
  await page.getByTestId('quiz-fix').click();
  await page.getByTestId('setting-ps').fill('6');
  await page.getByTestId('setting-ets').fill('70');
  await page.getByTestId('confirm-settings').click();
  await page.waitForFunction(() => (window.__ventsim?.ctl.status?.settings.ps ?? 0) === 6, undefined, { timeout: 15_000 });
  const t0 = await page.evaluate(() => window.__ventsim?.ctl.quiz.fixWindowStart ?? 0);
  await waitForSim(page, t0 + 61);
  await page.getByTestId('quiz-evaluate').click();
  // Debrief: the change, the pattern name, the fix note; everything revealed again.
  await expect(page.getByTestId('debrief-panel')).toBeVisible();
  await expect(page.getByTestId('debrief-changes')).toContainText('PS 16 → 6 cmH2O');
  await expect(page.getByTestId('debrief-changes')).toContainText('ETS 10 → 70 %');
  await expect(page.getByTestId('debrief-happening')).toContainText('Ineffective effort');
  await expect(page.getByTestId('debrief-fix-note')).toContainText('Tassaux');
  await expect(page.getByTestId('debrief-key-ps')).toContainText('matched');
  await expect(page.getByTestId('debrief-physiology')).toContainText('Why it happens');
  await expect(page.getByTestId('truth-toggle')).toBeEnabled();
  await expect(page.getByTestId('instructor-panel')).toBeVisible();
  await expect(page.getByTestId('tab-explain')).toBeVisible();
  expect(await page.evaluate(() => window.__ventsim?.ctl.view.badges)).toBe(true);
  // The compact summary is stored with the attempt and listed in the Instructor panel's attempts review.
  const stored = await page.evaluate(() => localStorage.getItem('ventsim.progress.v1') ?? '');
  expect(stored).toContain('"debrief"');
  await page.getByTestId('instructor-toggle').click();
  await expect(page.getByTestId('instr-attempts')).toContainText('PS 16 → 6 cmH2O');
  await expect(page.getByTestId('instr-attempt').first()).toContainText('Ineffective effort');
});

test('instructor: quiz view checkboxes set the hide set and the link is copyable', async ({ page }) => {
  await page.goto('/#ineffective-effort');
  await fast(page);
  await page.getByTestId('instructor-toggle').click();
  await page.getByTestId('quizview-truth').check();
  await page.getByTestId('quizview-pes').check();
  expect(await page.evaluate(() => [...(window.__ventsim?.ctl.view.quizHide ?? [])].sort())).toEqual(['pes', 'truth']);
  await expect(page.getByTestId('quizview-link')).toHaveValue(/#ineffective-effort\?quiz=truth,pes$/);
  // Outside a quiz the hide set has no effect.
  await expect(page.getByTestId('truth-toggle')).toBeEnabled();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await page.getByTestId('quizview-bedside').click();
  expect(await page.evaluate(() => window.__ventsim?.ctl.view.quizHide.size)).toBe(6);
  await expect(page.getByTestId('quizview-link')).toHaveValue(/\?quiz=bedside$/);
  // During a quiz the set applies: start one and check the dashboard is gone.
  await waitForSim(page, 21);
  await page.getByTestId('tab-quiz').click();
  await page.getByTestId('quiz-start').click();
  await expect(page.getByTestId('dashboard')).toHaveCount(0);
  await expect(page.getByTestId('truth-toggle')).toBeDisabled();
  // Not locked: the instructor panel is still there and the picker enabled, but every case reads "Case n".
  await expect(page.getByTestId('instructor-panel')).toBeVisible();
  await expect(page.getByTestId('scenario-select')).toBeEnabled();
  const options = await page.getByTestId('scenario-select').locator('option').allTextContents();
  expect(options.length).toBeGreaterThan(10);
  expect(options.every((o) => /^Case \d+$/.test(o.trim()))).toBe(true);
  const groups = await page.getByTestId('scenario-select').locator('optgroup').evaluateAll((els) => els.map((e) => e.getAttribute('label')));
  expect(groups.every((g) => g === 'Cases')).toBe(true);
});

test('plain scenario hash: nothing hidden, not locked (existing behaviour)', async ({ page }) => {
  await page.goto('/#ineffective-effort');
  await fast(page);
  expect(await page.evaluate(() => window.__ventsim?.ctl.view.quizLocked)).toBe(false);
  await expect(page.getByTestId('truth-toggle')).toBeEnabled();
  await expect(page.getByTestId('instructor-panel')).toBeVisible();
  await expect(page.getByTestId('tab-explain')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
});

test('drive fix (reverse trigger): the scripted drive change is logged and marked in the debrief', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/#reverse-trigger');
  await fast(page);
  await waitForSim(page, 25);
  await page.getByTestId('tab-quiz').click();
  await page.getByTestId('quiz-start').click();
  await page.getByTestId('quiz-pick-reverse-trigger').check();
  await page.getByTestId('quiz-submit').click();
  await page.getByTestId('quiz-fix').click();
  await page.getByTestId('tab-scenario').click();
  await page.getByTestId('apply-fix').click();
  const t0 = await page.evaluate(() => window.__ventsim?.ctl.quiz.fixWindowStart ?? 0);
  await waitForSim(page, t0 + 61);
  await page.getByTestId('tab-quiz').click();
  await page.getByTestId('quiz-evaluate').click();
  await expect(page.getByTestId('debrief-panel')).toBeVisible();
  await expect(page.getByTestId('debrief-changes')).toContainText('Entrainment 1:');
  await expect(page.getByTestId('debrief-changes')).toContainText('→ off');
  await expect(page.getByTestId('debrief-key-drive.entrainment')).toContainText('matched');
  await expect(page.getByTestId('debrief-key-drive.rate')).toContainText('matched');
  await expect(page.getByTestId('debrief-key-drive.pmax')).toContainText('matched');
});
