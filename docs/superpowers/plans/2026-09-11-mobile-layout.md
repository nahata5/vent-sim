# Mobile-responsive layout — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VentSim usable on a phone (single column, pinned waveforms, bottom tab bar) and a tablet (two
columns), with the desktop layout and its 31 Playwright tests unchanged.

**Architecture:** CSS breakpoints in `theme.css` (phone < 700 px, tablet 700–1099 px) turn `.col-center`
and `.drawer` into `display: contents` so the existing DOM re-flows; a `usePhoneLayout()` hook gives
`App.tsx` one boolean to render the tab bar, relocate the header toggles and the CO2 panel, and stamp
`data-mtab` on `.app-main`. Canvases already re-measure their container every frame.

**Tech Stack:** Preact + TSX, plain CSS, Vitest, Playwright (Chromium device descriptors Pixel 7 and Nexus 10).

**Spec:** `docs/superpowers/specs/2026-09-11-mobile-layout-design.md`

## Global Constraints

- No physics, detector, scenario or education-logic change; `src/sim`, `src/detector`, `src/edu` untouched.
- Desktop (≥ 1100 px) DOM and CSS unchanged; the 31 desktop Playwright tests are not edited.
- Phone threshold `PHONE_MAX_WIDTH = 699` in TS and `(max-width: 699px)` in CSS, tablet `(min-width: 700px) and (max-width: 1099px)`.
- Touch: controls ≥ 40 px tall, inputs 16 px text, `BADGE_TAP_HEIGHT = 32`.
- Commit after each task with the session trailer; push; check the live site (`assets/index-*.js` contains a string unique to the commit).

---

### Task 1: Breakpoints module, Playwright projects, failing phone smoke test

**Files:**
- Create: `src/ui/breakpoints.ts`, `tests/unit/breakpoints.test.ts`, `tests/e2e/mobile.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Produces: `PHONE_MAX_WIDTH: number`, `PHONE_QUERY: string`, `TABLET_QUERY: string`, `BADGE_TAP_HEIGHT: number`, `isCoarsePointer(): boolean`, `usePhoneLayout(): boolean`.

- [ ] **Step 1: Unit test that the CSS query matches the constant**

```ts
// tests/unit/breakpoints.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHONE_MAX_WIDTH, PHONE_QUERY, TABLET_QUERY } from '../../src/ui/breakpoints';

describe('layout breakpoints (design 2026-09-11 §2)', () => {
  const css = readFileSync(new URL('../../src/ui/theme.css', import.meta.url), 'utf8');
  it('theme.css uses the phone query that usePhoneLayout uses', () => {
    expect(PHONE_QUERY).toBe(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    expect(css).toContain(`@media ${PHONE_QUERY}`);
  });
  it('the tablet query starts where the phone query ends and stops below the desktop', () => {
    expect(TABLET_QUERY).toBe(`(min-width: ${PHONE_MAX_WIDTH + 1}px) and (max-width: 1099px)`);
    expect(css).toContain(`@media ${TABLET_QUERY}`);
    expect(css).not.toContain('@media (max-width: 1100px)');
  });
});
```

- [ ] **Step 2: Run it, expect failure** — `npx vitest run tests/unit/breakpoints.test.ts` → cannot resolve `../../src/ui/breakpoints`.

- [ ] **Step 3: Write the module**

```ts
// src/ui/breakpoints.ts
import { useEffect, useState } from 'preact/hooks';

/** Widths up to this are the phone layout (theme.css `@media (max-width: 699px)`; design 2026-09-11 §2). */
export const PHONE_MAX_WIDTH = 699;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
/** Two-column tablet layout; the desktop grid starts at 1100 px. */
export const TABLET_QUERY = `(min-width: ${PHONE_MAX_WIDTH + 1}px) and (max-width: 1099px)`;
/** Coarse pointer: a tap this close to the top of the waveform screen counts as a badge tap (design §3). */
export const BADGE_TAP_HEIGHT = 32;

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Touch devices (media query, with the touch-points count as a fallback for emulators). */
export function isCoarsePointer(): boolean {
  return matches('(pointer: coarse)') || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
}

/** True below `PHONE_MAX_WIDTH`; re-renders when the viewport crosses the threshold. */
export function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(() => matches(PHONE_QUERY));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}
```

- [ ] **Step 4: Playwright projects**

```ts
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: [/mobile\.spec\.ts/, /tablet\.spec\.ts/] },
  { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  { name: 'tablet', use: { ...devices['Nexus 10'] }, testMatch: /tablet\.spec\.ts/ },
],
```

- [ ] **Step 5: Phone smoke test** (`tests/e2e/mobile.spec.ts`)

```ts
/** Phone layout (design 2026-09-11 §3): pinned waveforms, bottom tab bar, touch-sized controls. Runs in the `mobile` project (Pixel 7). */
import { expect, test, type Page } from '@playwright/test';

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ventsim?.ctl.setSpeed(4));
}
export async function waitForSim(page: Page, seconds: number): Promise<void> {
  await page.waitForFunction((s) => (window.__ventsim?.ctl.store.tLatest ?? 0) >= s, seconds, { timeout: 120_000 });
}
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

test('phone: single column, pinned waveforms, tab bar, settings confirm reachable, badge tap', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#ineffective-effort');
  await ready(page);
  await noHorizontalOverflow(page);
  await expect(page.getByTestId('waveforms')).toBeVisible();
  await canvasFollowsWrap(page);
  await expect(page.getByTestId('mobile-tabs')).toBeVisible();
  await expect(page.getByTestId('mtab-vent')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.app-header [data-testid="truth-toggle"]')).toHaveCount(0);
  await expect(page.getByTestId('view-toggles').getByTestId('truth-toggle')).toBeVisible();
  await expect(page.getByTestId('monitor-panel')).toBeHidden();
  await page.getByTestId('setting-peep').fill('8');
  await expect(page.getByTestId('confirm-settings')).toBeInViewport();
  await page.getByTestId('confirm-settings').click();
  await page.waitForFunction(() => window.__ventsim?.ctl.status?.settings.peep === 8, undefined, { timeout: 15_000 });
  await page.getByTestId('instructor-toggle').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('waveforms')).toBeInViewport();
  await page.getByTestId('mtab-monitor').click();
  await expect(page.getByTestId('mon-Ppeak')).toBeVisible();
  await expect(page.getByTestId('co2-panel')).toHaveCount(0); // this scenario has no CO2 loop
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
  await page.waitForFunction(() => { const v = window.__ventsim; return !!v && v.hits.some((h) => v.ctl.labels.has(h.index)); }, undefined, { timeout: 90_000 });
  const tap = await page.evaluate(() => {
    const v = window.__ventsim!;
    const h = v.hits.find((x) => v.ctl.labels.has(x.index))!;
    const r = document.querySelector('[data-testid="waveforms"]')!.getBoundingClientRect();
    return { x: r.left + (h.x0 + h.x1) / 2, y: r.top + 26 };
  });
  await page.touchscreen.tap(tap.x, tap.y);
  await expect(page.getByTestId('mtab-learn')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('explain-card')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 740 });
  await canvasFollowsWrap(page);
  await noHorizontalOverflow(page);
});
```

- [ ] **Step 6: Run** `npx playwright test --project=mobile` → fails on `mobile-tabs` (not rendered). `npx vitest run tests/unit/breakpoints.test.ts` still fails (CSS query missing) — both go green in Task 2.

- [ ] **Step 7: Commit** `test(mobile): breakpoints module, Pixel 7 / Nexus 10 Playwright projects, failing phone smoke test`

### Task 2: Phone layout (CSS + App tab bar + canvas rows/badge tap)

**Files:**
- Modify: `src/ui/theme.css` (replace the `@media (max-width: 1100px)` block; add phone, touch blocks), `src/app/App.tsx`, `src/ui/WaveformCanvas.tsx`, `src/ui/ExportPanel.tsx`

**Interfaces:**
- Consumes: `usePhoneLayout`, `isCoarsePointer`, `BADGE_TAP_HEIGHT` from Task 1.
- Produces: `data-mtab` on `.app-main`; test ids `mobile-tabs`, `mtab-vent|monitor|loops|learn`, `view-toggles`; `ExportPanel` prop `validationLink?: boolean`; `--wave-rows` on `.wave-wrap`.

- [ ] **Step 1: App.tsx**

```tsx
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { usePhoneLayout } from '../ui/breakpoints';
type MobileTab = 'vent' | 'monitor' | 'loops' | 'learn';
const MOBILE_TABS: Array<[MobileTab, string]> = [['vent', 'Vent'], ['monitor', 'Monitor'], ['loops', 'Loops'], ['learn', 'Learn']];
// inside App():
const phone = usePhoneLayout();
const [mtab, setMtab] = useState<MobileTab>('vent');
// When the controller opens a drawer tab on its own (badge tap → Explain, quiz start → Quiz) the phone shows Learn.
const prevDrawerTab = useRef(ctl.view.drawerTab);
useEffect(() => {
  if (prevDrawerTab.current !== view.drawerTab) {
    prevDrawerTab.current = view.drawerTab;
    if (phone) setMtab('learn');
  }
}, [view.drawerTab, phone]);
const toggles = (
  <>
    <TruthToggle on={truthOn} onChange={(on) => ctl.setTruth(on)} disabled={locked || hideTruth} />
    <label class="inline balloon-toggle">…unchanged…</label>
  </>
);
```
Header: `{!phone && <span class="muted small">v{APP_VERSION}</span>}`, `{!phone && toggles}`, `{!phone && !hideDerived && <a … validation-link>}`.
Main: `<main class="app-main" data-testid="app-main" data-mtab={phone ? mtab : undefined}>`.
`col-left`: `{phone && <div class="panel view-toggles" data-testid="view-toggles">{toggles}</div>}` first; CO2 panel only when `!phone`.
`col-right`: after the dashboard, `{phone && status?.co2 && !hideCo2 && <Co2Panel …/>}`.
Export: `<ExportPanel ctl={ctl} hideTruth={locked} validationLink={phone && !hideDerived} />`.
After `</aside>` (col-right):
```tsx
{phone && (
  <nav class="mobile-tabs" role="tablist" aria-label="Panels" data-testid="mobile-tabs">
    {MOBILE_TABS.map(([id, label]) => (
      <button type="button" key={id} role="tab" aria-selected={mtab === id} onClick={() => setMtab(id)} data-testid={`mtab-${id}`}>{label}</button>
    ))}
  </nav>
)}
```

- [ ] **Step 2: ExportPanel** — prop `validationLink?: boolean`; after the batch row: `{validationLink && (<div class="row"><a class="small muted" href="#validation" data-testid="validation-link">Validation</a></div>)}`.

- [ ] **Step 3: WaveformCanvas** — `import { BADGE_TAP_HEIGHT, isCoarsePointer } from './breakpoints';` wrap gets `style={`--wave-rows: ${rows.length}`}`; in `onClick` replace the strip test with
```ts
const strip = badgeStripHeight({ showBadges: true, truthBadges: truth });
if (y >= (isCoarsePointer() ? Math.max(strip, BADGE_TAP_HEIGHT) : strip)) return;
```
and clamp both readout `x` values with `Math.max(0, …)`.

- [ ] **Step 4: CSS** — base: `.app-shell { height: 100vh; height: 100dvh; }`. Replace the 1100 px block with the phone block (spec §3), the tablet placeholder comes in Task 4, then the touch block:

```css
/* ── Mobile layout (design 2026-09-11, D-020) ── */
@media (max-width: 699px) {
  .app-header { gap: 8px; padding: 4px 8px; flex-wrap: nowrap; }
  .app-header h1 { font-size: 16px; }
  .scenario-picker { flex: 1; min-width: 0; }
  .scenario-picker > span { display: none; }
  .scenario-picker select { flex: 1; min-width: 0; width: 100%; max-width: none; }
  .app-main { display: flex; flex-direction: column; gap: 6px; padding: 6px; overflow: hidden; }
  .col-center, .drawer { display: contents; }
  .wave-wrap { order: 1; flex: 0 0 auto; min-height: 0; height: min(55vh, calc(var(--wave-rows, 3) * 68px + 22px)); }
  .time-controls { order: 2; gap: 6px; padding: 2px 4px; }
  .time-controls input[type='range'] { flex: 1; min-width: 80px; width: auto; }
  .col-left, .col-right, .loops, .drawer-pane { order: 3; flex: 1 1 0; min-height: 0; display: none; }
  .app-main[data-mtab='vent'] .col-left { display: flex; }
  .app-main[data-mtab='monitor'] .col-right { display: flex; }
  .app-main[data-mtab='loops'] .loops { display: grid; grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(150px, 1fr); overflow-y: auto; }
  .app-main[data-mtab='learn'] .drawer-pane { display: flex; }
  .mobile-tabs { order: 4; display: flex; flex: 0 0 auto; margin: 0 -6px -6px; border-top: 1px solid var(--border); background: var(--panel); }
  .mobile-tabs button { flex: 1; min-height: 48px; border: none; border-radius: 0; background: transparent; color: var(--muted); font-size: 13px; }
  .mobile-tabs button[aria-selected='true'] { color: var(--accent); box-shadow: inset 0 3px 0 var(--accent); }
  .settings .confirm-row { position: sticky; bottom: 0; background: var(--panel); padding: 8px 0; margin: 6px 0 0; }
  .app-footer { font-size: 10px; padding: 3px 8px; }
  .quiz .pick-grid { grid-template-columns: 1fr; }
  .explain .two-col, .debrief .two-col { grid-template-columns: 1fr; }
  .cursor-readout { min-width: 0; }
  .cursor-readout.badge-readout { max-width: calc(100vw - 24px); }
}
@media (max-width: 699px), (pointer: coarse) {
  button { min-height: 40px; }
  select, input[type='number'], input[type='text'], input:not([type]), textarea { min-height: 40px; font-size: 16px; }
  input[type='checkbox'] { width: 22px; height: 22px; }
  .settings .field input, .settings .field select { width: 120px; }
  .maneuvers button { font-size: 13px; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
}
```

- [ ] **Step 5: Run** `npx playwright test --project=mobile` and `npx vitest run tests/unit/breakpoints.test.ts` (the tablet query is asserted by the unit test: add the tablet block skeleton now if needed so both pass; its content lands in Task 4). Then the desktop suite `npx playwright test --project=chromium` → 31 passed, `npm run lint`, `npm test`.

- [ ] **Step 6: Commit, push, check the live site** `feat(layout): phone layout — pinned waveforms, bottom tab bar, toggles in the Vent tab, touch sizes (D-020 part 1)`; poll `https://vent-sim.netlify.app/assets/index-*.js` for `mtab-vent`.

### Task 3: Phone quiz → debrief, readable tables

**Files:**
- Modify: `tests/e2e/mobile.spec.ts` (add test), `src/ui/DebriefPanel.tsx` (wrap `.debrief-keys` in `<div class="table-wrap">`), `src/ui/LungStressDashboard.tsx` (wrap both tables in `.table-wrap`).

- [ ] **Step 1: Test**

```ts
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
  const fit = await page.evaluate(() => { const pane = document.querySelector('[data-testid="drawer-pane"]') as HTMLElement; return { scroll: pane.scrollWidth, client: pane.clientWidth }; });
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  await page.getByTestId('debrief-physiology').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('debrief-physiology')).toBeInViewport();
  await expect(page.getByTestId('waveforms')).toBeInViewport();
  await noHorizontalOverflow(page);
});
```

- [ ] **Step 2: Run, fix overflow with `.table-wrap` wrappers, re-run** until green; desktop `quiz-bedside.spec.ts` and `m7.spec.ts` still pass (they read the table by test id, not by parent).
- [ ] **Step 3: Commit, push, live check** `feat(layout): phone quiz → debrief readable; tables scroll inside their container (D-020 part 2)`.

### Task 4: Tablet layout

**Files:**
- Create: `tests/e2e/tablet.spec.ts`; Modify: `src/ui/theme.css`.

- [ ] **Step 1: Test**

```ts
/** Tablet layout (design 2026-09-11 §4): waveforms and drawer full width, panels in two columns. Runs in the `tablet` project (Nexus 10). */
import { expect, test } from '@playwright/test';
import { canvasFollowsWrap, noHorizontalOverflow, ready } from './mobile.spec';

test('tablet: full-width waveforms, two panel columns, no tab bar, no horizontal overflow', async ({ page }) => {
  await page.goto('/#ineffective-effort');
  await ready(page);
  await noHorizontalOverflow(page);
  await expect(page.getByTestId('mobile-tabs')).toHaveCount(0);
  await expect(page.locator('.app-header [data-testid="truth-toggle"]')).toBeVisible();
  const inner = await page.evaluate(() => window.innerWidth);
  const wave = (await page.getByTestId('waveforms').boundingBox())!;
  expect(wave.width).toBeGreaterThanOrEqual(inner - 24);
  expect(wave.height).toBeGreaterThanOrEqual(300);
  const settings = (await page.getByTestId('settings-panel').boundingBox())!;
  const monitor = (await page.getByTestId('monitor-panel').boundingBox())!;
  expect(monitor.x).toBeGreaterThanOrEqual(settings.x + settings.width);
  expect(Math.abs(monitor.y - settings.y)).toBeLessThanOrEqual(40);
  await expect(page.getByTestId('loops')).toBeVisible();
  await expect(page.getByTestId('drawer-pane')).toBeVisible();
  await page.getByTestId('monitor-panel').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('mon-Ppeak')).toBeInViewport();
  await canvasFollowsWrap(page);
});
```
Note: importing helpers from `mobile.spec.ts` is fine because the `tablet` project only matches `tablet.spec.ts` and the `mobile` project only `mobile.spec.ts` (a spec file's tests register only for the project that matched it). If Playwright complains about tests declared in an imported spec, move the helpers to `tests/e2e/helpers/layout.ts` and import from there in both files.

- [ ] **Step 2: CSS**

```css
@media (min-width: 700px) and (max-width: 1099px) {
  .app-main { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: auto; align-content: start; overflow-y: auto; }
  .col-center, .drawer { display: contents; }
  .time-controls { grid-column: 1 / -1; grid-row: 1; }
  .wave-wrap { grid-column: 1 / -1; grid-row: 2; flex: none; min-height: 0; height: max(300px, min(50vh, calc(var(--wave-rows, 3) * 80px + 22px))); }
  .loops { grid-column: 1; grid-row: 3; height: 260px; grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .drawer-pane { grid-column: 2; grid-row: 3; height: 260px; }
  .col-left { grid-column: 1; grid-row: 4; overflow: visible; }
  .col-right { grid-column: 2; grid-row: 4; overflow: visible; }
}
```

- [ ] **Step 3: Run** `npx playwright test --project=tablet`, then all three projects; `npm run lint`; `npm test`.
- [ ] **Step 4: Commit, push, live check** `feat(layout): tablet two-column layout (D-020 part 3)`.

### Task 5: Docs, decision, screenshots

**Files:**
- Modify: `docs/DECISIONS.md` (D-020), `PROGRESS.md`, `README.md`, `tests/e2e/screenshots.spec.ts`, `docs/HANDOFF.md`.

- [ ] **Step 1: Screenshot tests** — append to `screenshots.spec.ts`:
```ts
import { devices, test, type Page } from '@playwright/test';
test.describe('phone', () => {
  test.use({ ...devices['Pixel 7'] });
  test('phone: Vent tab with the waveforms pinned', async ({ page }) => { …goto '#ineffective-effort', ready, speed 4, waitForSim 30, freeze, screenshot 'docs/screenshots/mobile-phone-vent.png' });
  test('phone: Learn tab, quiz idle', async ({ page }) => { …click mtab-learn, tab-quiz, screenshot 'docs/screenshots/mobile-phone-learn.png' });
});
test.describe('tablet', () => {
  test.use({ ...devices['Nexus 10'] });
  test('tablet: two columns', async ({ page }) => { …screenshot 'docs/screenshots/mobile-tablet.png', fullPage: true });
});
```
- [ ] **Step 2:** `SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts --project=chromium` (refreshes the M6–M8 shots too).
- [ ] **Step 3:** D-020 (breakpoints, pinned waveforms + tab bar, `display: contents`, toggles relocation, touch sizes, badge tap height, accepted limitations), PROGRESS entry (tests, counts), README note under "Using the app" ("On a phone … on a tablet …"), HANDOFF refresh with the next prompt.
- [ ] **Step 4: Commit, push** `docs: D-020 mobile layout, PROGRESS, README, screenshots, handoff`.

## Self-review

- Spec §2 breakpoints → Task 1/2/4; §3 phone → Task 2/3; §4 tablet → Task 4; §5 DOM/`display: contents`, toggles, CO2, `--wave-rows`, badge tap → Task 2; §7 tests → Tasks 1, 3, 4, screenshots Task 5; D-020/PROGRESS/README → Task 5.
- Names used consistently: `usePhoneLayout`, `isCoarsePointer`, `BADGE_TAP_HEIGHT`, `PHONE_QUERY`, `TABLET_QUERY`, `data-mtab`, `mtab-*`, `view-toggles`, `mobile-tabs`, `validationLink`.
