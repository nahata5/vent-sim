# Quiz Bedside View and Debrief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an instructor hide bedside-invisible information (truth, Pes, scenario text, derived numbers, explain cards, CO2) during a quiz, lock that view behind a copyable link, and show a four-section templated debrief on submit.

**Architecture:** Two new pure modules in `src/edu/` (`quiz-view.ts` for the hide set and the link, `debrief.ts` for the setting-change log and the debrief builder) are unit-tested first. The `SessionController` gains a hide set, a lock flag, a confirmed-change log and a debrief; `App.tsx` and the panels read `ctl.quizHides(key)` to drop what is hidden. Nothing in `src/sim`, `src/detector` or the labeler changes; grading is unchanged; with an empty hide set the quiz behaves exactly as before.

**Tech Stack:** TypeScript, Preact, Vitest (`npm test`), Playwright (`npm run test:e2e`), ESLint + tsc (`npm run lint`), Netlify (push to `main` redeploys).

**Spec:** `docs/superpowers/specs/2026-09-11-quiz-bedside-view-design.md`

## Global Constraints

- No magic numbers: every constant goes in `src/config/constants.ts` via `c(value, unit, note, tag)` with a source tag, then `npx tsx scripts/model-constants.ts` regenerates the MODEL.md table.
- Grading (identification Jaccard, fix limits, D-015 score) is unchanged. No LLM, no free text: debrief text is templated from `CARDS`, `fix.note` and the setting log.
- Existing quiz behaviour with an empty hide set must not change: `tests/e2e/quiz.spec.ts` keeps passing; `data-testid`s `quiz-panel`, `quiz-start`, `quiz-submit`, `quiz-fix`, `quiz-evaluate`, `quiz-result` (`data-score`, `data-pass`), `quiz-score`, `quiz-end` and the checks list text (e.g. "PL,ee") stay.
- Locking is a classroom convenience, not security (URL editable).
- Tests first for `src/edu` logic. Commit after every task with the trailer below, push, and check the live site (§"Deploy check").
- Commit trailer (every commit):
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DLxH7qsM5VLwiEQRDECPGs
  ```
- The wall-clock performance test may fail in the parallel run under load; re-run it alone (`npx vitest run tests/physics/performance.test.ts` or whichever file holds it) before treating it as a regression.

## Deploy check

After `git push origin main`, poll the served bundle for a string unique to the commit (replace `NEEDLE`):

```bash
for i in $(seq 1 30); do
  js=$(curl -s https://vent-sim.netlify.app/ | grep -o 'assets/index-[^"]*\.js' | head -1)
  if curl -s "https://vent-sim.netlify.app/$js" | grep -q 'NEEDLE'; then echo "live: $js"; break; fi
  sleep 20
done
```

## File structure

| File | Responsibility |
|---|---|
| Create `src/edu/quiz-view.ts` | `QuizHideKey`, `QUIZ_HIDE_KEYS`, labels, `bedsideHide()`, `parseQuizHash`, `quizLink` |
| Create `src/edu/debrief.ts` | `SettingChange`, `settingChangesFrom`, `injectorChange`, `formatChange`, `fixMark`, `buildDebrief` |
| Modify `src/edu/progress.ts` | `DebriefSummary`, optional `QuizAttempt.debrief` |
| Modify `src/config/constants.ts` | `QUIZ_FIX_BAND` |
| Modify `src/app/controller.ts` | `view.quizHide`, `view.quizLocked`, `quizHides`, `setQuizHide`, `lockQuiz`, `settingsChangeLog`, `quizPicks`, `lastDebrief`, debrief on evaluate |
| Create `src/ui/DebriefPanel.tsx` | renders a `Debrief` (four sections + checks) |
| Modify `src/ui/QuizPanel.tsx` | result phase renders `DebriefPanel`; idle hides the progress line when `scenario` is hidden; shows the last attempt summary |
| Modify `src/ui/TruthToggle.tsx`, `ScenarioPicker.tsx`, `MonitorPanel.tsx`, `ExportPanel.tsx`, `WaveformCanvas.tsx`, `InstructorPanel.tsx`, `src/app/App.tsx` | hide/lock plumbing; "Quiz view" section |
| Create `tests/unit/quiz-view.test.ts`, `tests/unit/debrief.test.ts`, `tests/e2e/quiz-bedside.spec.ts`; modify `tests/unit/progress.test.ts` | spec §6 tests |
| Modify `README.md`, `docs/DECISIONS.md` (D-019), `PROGRESS.md`, `docs/HANDOFF.md`, `docs/MODEL.md` (constants table) | docs |

---

### Task 1: Hide set and quiz link (`quiz-view.ts`)

**Files:**
- Create: `src/edu/quiz-view.ts`
- Test: `tests/unit/quiz-view.test.ts`

**Interfaces:**
- Produces: `QUIZ_HIDE_KEYS`, `type QuizHideKey`, `QUIZ_HIDE_LABELS`, `bedsideHide(): Set<QuizHideKey>`, `parseQuizHash(hash: string): QuizHashInfo | null`, `quizLink(scenarioId: string, hide: Iterable<QuizHideKey>, base?: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/quiz-view.test.ts
/**
 * Quiz "bedside view" link (spec 2026-09-11 §2): `#<scenario-id>?quiz=<keys|bedside>` round-trips through
 * parseQuizHash / quizLink; unknown keys are ignored; only a `?quiz=` hash locks the session.
 */
import { describe, expect, it } from 'vitest';
import { QUIZ_HIDE_KEYS, bedsideHide, parseQuizHash, quizLink } from '@/edu/quiz-view';

describe('quiz view link', () => {
  it('round-trips a hide set through quizLink and parseQuizHash', () => {
    const link = quizLink('ineffective-effort', ['pes', 'truth'], 'https://x.test/');
    expect(link).toBe('https://x.test/#ineffective-effort?quiz=truth,pes');
    const info = parseQuizHash(link.slice('https://x.test/'.length));
    expect(info).not.toBeNull();
    expect(info?.scenarioId).toBe('ineffective-effort');
    expect([...(info?.hide ?? [])].sort()).toEqual(['pes', 'truth']);
    expect(info?.locked).toBe(true);
  });

  it('accepts the bedside preset and emits it for the full set', () => {
    const info = parseQuizHash('#copd?quiz=bedside');
    expect(info?.hide.size).toBe(QUIZ_HIDE_KEYS.length);
    expect(info?.locked).toBe(true);
    expect(quizLink('copd', bedsideHide())).toBe('#copd?quiz=bedside');
  });

  it('ignores unknown keys and keeps the known ones', () => {
    const info = parseQuizHash('#copd?quiz=truth,bogus,co2');
    expect([...(info?.hide ?? [])].sort()).toEqual(['co2', 'truth']);
  });

  it('returns locked: false for a plain scenario hash and null for an empty hash', () => {
    const plain = parseQuizHash('#copd');
    expect(plain).toEqual({ scenarioId: 'copd', hide: new Set(), locked: false });
    expect(parseQuizHash('#/copd')?.scenarioId).toBe('copd');
    expect(parseQuizHash('')).toBeNull();
    expect(parseQuizHash('#')).toBeNull();
    // A quiz query with no keys still locks (instructor panel hidden, nothing else).
    expect(parseQuizHash('#copd?quiz=')?.locked).toBe(true);
    expect(parseQuizHash('#copd?quiz=')?.hide.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/quiz-view.test.ts`
Expected: FAIL — cannot resolve `@/edu/quiz-view`.

- [ ] **Step 3: Write the module**

```ts
// src/edu/quiz-view.ts
/**
 * Quiz "bedside view" (design 2026-09-11, D-019): the instructor's hide set — what the learner cannot see
 * while a quiz runs — and the locked quiz link `#<scenario-id>?quiz=<comma-separated keys | bedside>`.
 * Pure; the controller applies it.
 */

export const QUIZ_HIDE_KEYS = ['truth', 'pes', 'scenario', 'derived', 'explain', 'co2'] as const;
export type QuizHideKey = (typeof QUIZ_HIDE_KEYS)[number];

/** Checkbox labels (Instructor panel "Quiz view"). */
export const QUIZ_HIDE_LABELS: Record<QuizHideKey, string> = {
  truth: 'Truth layer, truth badges and truth-only readouts',
  pes: 'Esophageal pressure (Pes row, occlusion-test and shunt tiles)',
  scenario: 'Scenario title, summary, objectives, targets, suggested fix, best score',
  derived: 'Lung-stress dashboard, Validation link, balloon-only tiles',
  explain: 'Explain tab, badge click and badge hover evidence',
  co2: 'CO2 loop panel and time warp',
};

export const QUIZ_BEDSIDE_PRESET = 'bedside';

export function bedsideHide(): Set<QuizHideKey> {
  return new Set(QUIZ_HIDE_KEYS);
}

export interface QuizHashInfo {
  scenarioId: string;
  hide: Set<QuizHideKey>;
  /** True only when the hash carries a `quiz` query (a link the instructor handed out). */
  locked: boolean;
}

function isHideKey(x: string): x is QuizHideKey {
  return (QUIZ_HIDE_KEYS as readonly string[]).includes(x);
}

/** Parse `location.hash` (with or without the leading `#`/`#/`); null when there is no scenario id. */
export function parseQuizHash(hash: string): QuizHashInfo | null {
  const body = hash.replace(/^#\/?/, '');
  const q = body.indexOf('?');
  const scenarioId = q >= 0 ? body.slice(0, q) : body;
  if (!scenarioId) return null;
  const params = new URLSearchParams(q >= 0 ? body.slice(q + 1) : '');
  const quiz = params.get('quiz');
  const hide = new Set<QuizHideKey>();
  if (quiz === QUIZ_BEDSIDE_PRESET) for (const k of QUIZ_HIDE_KEYS) hide.add(k);
  else if (quiz) for (const k of quiz.split(',')) if (isHideKey(k.trim())) hide.add(k.trim() as QuizHideKey);
  return { scenarioId, hide, locked: quiz !== null };
}

/** Locked quiz link for a scenario and hide set; `base` is the page URL (origin + path), '' for a bare hash. */
export function quizLink(scenarioId: string, hide: Iterable<QuizHideKey>, base = ''): string {
  const set = new Set(hide);
  const keys = QUIZ_HIDE_KEYS.filter((k) => set.has(k));
  const value = keys.length === QUIZ_HIDE_KEYS.length ? QUIZ_BEDSIDE_PRESET : keys.join(',');
  return `${base}#${scenarioId}?quiz=${value}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/quiz-view.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/edu/quiz-view.ts tests/unit/quiz-view.test.ts docs/superpowers/plans/2026-09-11-quiz-bedside-view.md
git commit -m "feat(quiz): hide-set keys and locked quiz link parser (bedside view, D-019 part 1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DLxH7qsM5VLwiEQRDECPGs"
git push origin main
```

(No UI change yet, so no deploy check beyond the push succeeding.)

---

### Task 2: Setting-change log and debrief builder (`debrief.ts`, progress summary, `QUIZ_FIX_BAND`)

**Files:**
- Create: `src/edu/debrief.ts`
- Modify: `src/edu/progress.ts` (add `DebriefSummary`, `QuizAttempt.debrief?`)
- Modify: `src/config/constants.ts` (after `QUIZ_FACTOR_FLOOR`, line ≈ 319)
- Modify: `docs/MODEL.md` via `npx tsx scripts/model-constants.ts`
- Test: `tests/unit/debrief.test.ts`, `tests/unit/progress.test.ts`

**Interfaces:**
- Consumes: `VentSettings` (`src/sim/vent/settings.ts`), `ScenarioFix` (`src/edu/scenarios/index.ts`), `FixGrade`, `IdentificationGrade`, `gradeIdentification` (`src/edu/quiz.ts`), `CARDS` (`src/edu/cards/index.ts`), `PatternId` (`src/sim/truth/labeler.ts`), `k('QUIZ_FIX_BAND')`.
- Produces:
  ```ts
  interface SettingChange { t: number; key: string; from: string | number | boolean; to: string | number | boolean }
  function settingChangesFrom(t: number, current: VentSettings, partial: Partial<VentSettings>): SettingChange[]
  function injectorChange(t: number, kind: string, on: boolean): SettingChange   // key `injector:<kind>`, 'on' | 'off'
  function formatChange(c: SettingChange): string                                  // "PS 16 → 6 at 84 s"
  type FixMark = 'matched' | 'partial' | 'not-done' | 'opposite'
  function fixMark(start: number | string | boolean, recommended: number | string | boolean, learner: number | string | boolean): FixMark
  interface DebriefInput { changes; truthPatterns; picks; fixGrade; aiBefore; fix; settingsAtFixStart; finalSettings; injectorsAtFixStart; finalInjectors; evidence }
  interface Debrief { changes: string[]; happening: DebriefPattern[]; fix: DebriefFix; physiology: DebriefCard[]; summary: DebriefSummary }
  function buildDebrief(inp: DebriefInput): Debrief
  ```
  and in `progress.ts`: `interface DebriefSummary { changes: string[]; patterns: string[]; pass: boolean }`, `QuizAttempt.debrief?: DebriefSummary`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/debrief.test.ts
/**
 * Quiz debrief (design 2026-09-11 §5, D-019): the confirmed-change log, the recommended-fix marks and the
 * templated four-section debrief. Pure functions; the controller feeds them.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@sim/vent/settings';
import { CARDS } from '@/edu/cards';
import { gradeFix } from '@/edu/quiz';
import { buildDebrief, fixMark, formatChange, injectorChange, settingChangesFrom, type DebriefInput } from '@/edu/debrief';

const psv = () => ({ ...defaultSettings('PSV'), ps: 16, ets: 0.1, peep: 0, flowTrigger: 3 });

describe('setting change log', () => {
  it('records only the keys whose value changed, with from and to', () => {
    const cur = psv();
    const changes = settingChangesFrom(84, cur, { ps: 6, ets: 0.1, peep: 5 });
    expect(changes).toEqual([
      { t: 84, key: 'ps', from: 16, to: 6 },
      { t: 84, key: 'peep', from: 0, to: 5 },
    ]);
  });

  it('records alarm limits per key and an injector toggle as on/off', () => {
    const cur = psv();
    const changes = settingChangesFrom(10, cur, { alarms: { ...cur.alarms, highPpeak: cur.alarms.highPpeak + 5 } });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.key).toBe('alarms.highPpeak');
    expect(injectorChange(12, 'leak', false)).toEqual({ t: 12, key: 'injector:leak', from: 'on', to: 'off' });
  });

  it('formats a change with the bedside label, display units and the time', () => {
    expect(formatChange({ t: 84.4, key: 'ps', from: 16, to: 6 })).toBe('PS 16 → 6 cmH2O at 84 s');
    expect(formatChange({ t: 90, key: 'ets', from: 0.1, to: 0.7 })).toBe('ETS 10 → 70 % at 90 s');
    expect(formatChange({ t: 91, key: 'injector:leak', from: 'on', to: 'off' })).toBe('Leak injector on → off at 91 s');
  });
});

describe('recommended-fix marks', () => {
  it('matched, partial, not done and opposite for a numeric key', () => {
    expect(fixMark(16, 6, 6)).toBe('matched');
    expect(fixMark(16, 6, 4)).toBe('matched'); // within 25 % of the 10-step band
    expect(fixMark(16, 6, 12)).toBe('partial');
    expect(fixMark(16, 6, 16)).toBe('not-done');
    expect(fixMark(16, 6, 20)).toBe('opposite');
    expect(fixMark(0.1, 0.7, 0.7)).toBe('matched');
  });

  it('non-numeric keys: exact match, unchanged or changed elsewhere', () => {
    expect(fixMark('flow', 'pressure', 'pressure')).toBe('matched');
    expect(fixMark('flow', 'pressure', 'flow')).toBe('not-done');
    expect(fixMark('on', 'off', 'on')).toBe('not-done');
    expect(fixMark('on', 'off', 'off')).toBe('matched');
  });

  it('a recommended value equal to the start counts as matched only when left alone', () => {
    expect(fixMark(5, 5, 5)).toBe('matched');
    expect(fixMark(5, 5, 8)).toBe('opposite');
  });
});

describe('buildDebrief', () => {
  const start = psv();
  const final = { ...start, ps: 6, ets: 0.7, peep: 5 };
  const base = (): DebriefInput => ({
    changes: [
      { t: 90, key: 'ets', from: 0.1, to: 0.7 },
      { t: 84, key: 'ps', from: 16, to: 6 },
      { t: 92, key: 'peep', from: 0, to: 5 },
    ],
    truthPatterns: ['ineffective-effort', 'delayed-cycling'],
    picks: ['ineffective-effort', 'double-trigger'],
    fixGrade: gradeFix({ ai: 4, breaths: [{ dp: 10, pplat: 20, vtPerKg: 6 }], newSevereAlarms: [], extras: [] }),
    aiBefore: 45,
    fix: { at: 60, note: 'Tassaux-style: ETS 70 %, PS 6, PEEP 5, trigger 1.5 L/min.', settings: { ps: 6, ets: 0.7, peep: 5, flowTrigger: 1.5 } },
    settingsAtFixStart: start,
    finalSettings: final,
    injectorsAtFixStart: [],
    finalInjectors: [],
    evidence: { 'ineffective-effort': ['The effort at 70.2 s did not trigger a breath.'] },
  });

  it('lists the changes in time order with the bedside wording', () => {
    const d = buildDebrief(base());
    expect(d.changes).toEqual(['PS 16 → 6 cmH2O at 84 s', 'ETS 10 → 70 % at 90 s', 'PEEP 0 → 5 cmH2O at 92 s']);
    expect(buildDebrief({ ...base(), changes: [] }).changes).toEqual(['No setting changes.']);
  });

  it('names each truth pattern by its card title, carries the evidence and marks found / missed / extra', () => {
    const d = buildDebrief(base());
    expect(d.happening.map((h) => [h.id, h.mark])).toEqual([
      ['ineffective-effort', 'found'],
      ['delayed-cycling', 'missed'],
      ['double-trigger', 'extra'],
    ]);
    expect(d.happening[0]?.title).toBe(CARDS['ineffective-effort'].title);
    expect(d.happening[0]?.evidence).toEqual(['The effort at 70.2 s did not trigger a breath.']);
    expect(d.happening[1]?.evidence).toEqual([]); // missing evidence tolerated
  });

  it('marks the recommended fix key by key and reports the outcome', () => {
    const d = buildDebrief(base());
    expect(d.fix.note).toContain('Tassaux');
    expect(d.fix.keys.map((x) => [x.key, x.mark])).toEqual([
      ['ps', 'matched'],
      ['ets', 'matched'],
      ['peep', 'matched'],
      ['flowTrigger', 'not-done'],
    ]);
    expect(d.fix.keys[0]).toMatchObject({ label: 'PS', recommended: '6 cmH2O', learner: '6 cmH2O' });
    expect(d.fix.aiBefore).toBe(45);
    expect(d.fix.aiAfter).toBe(4);
    expect(d.fix.pass).toBe(true);
    expect(d.fix.failed).toEqual([]);
  });

  it('includes injector recommendations and a failing outcome', () => {
    const inp = base();
    inp.fix = { at: 60, note: 'Re-inflate the cuff.', injectors: { leak: null } };
    inp.injectorsAtFixStart = ['leak'];
    inp.finalInjectors = ['leak'];
    inp.fixGrade = gradeFix({ ai: 30, breaths: [{ dp: 10, pplat: 20, vtPerKg: 6 }], newSevereAlarms: [], extras: [] });
    const d = buildDebrief(inp);
    expect(d.fix.keys).toEqual([{ key: 'injector:leak', label: 'Leak injector', recommended: 'off', learner: 'on', mark: 'not-done' }]);
    expect(d.fix.pass).toBe(false);
    expect(d.fix.failed[0]).toMatch(/Asynchrony index/);
  });

  it('physiology section carries the card text for the truth patterns only, and the summary is compact', () => {
    const d = buildDebrief(base());
    expect(d.physiology.map((c) => c.id)).toEqual(['ineffective-effort', 'delayed-cycling']);
    expect(d.physiology[0]?.mechanism).toBe(CARDS['ineffective-effort'].mechanism);
    expect(d.physiology[0]?.fixes).toEqual(CARDS['ineffective-effort'].fixes);
    expect(d.summary).toEqual({ changes: d.changes, patterns: ['ineffective-effort', 'delayed-cycling'], pass: true });
  });

  it('tolerates a scenario without a fix and no settings snapshots', () => {
    const d = buildDebrief({ ...base(), fix: null, settingsAtFixStart: null, finalSettings: null });
    expect(d.fix.note).toBeNull();
    expect(d.fix.keys).toEqual([]);
  });
});
```

Add to `tests/unit/progress.test.ts` (inside the existing `describe`):

```ts
  it('keeps a compact debrief summary with the attempt', () => {
    const s = memStorage();
    const p = new ProgressStore(s);
    p.record('copd', { score: 70, identification: 1, fixPassed: true, seconds: 80, changes: 2, at: 5, debrief: { changes: ['PS 16 → 6 cmH2O at 84 s'], patterns: ['ineffective-effort'], pass: true } });
    const again = new ProgressStore(s);
    expect(again.get('copd')?.history[0]?.debrief?.changes).toEqual(['PS 16 → 6 cmH2O at 84 s']);
  });
```

(Use whatever in-memory storage helper the file already defines — read the top of `tests/unit/progress.test.ts`; it constructs a `Map`-backed `KeyValueStorage` for the persistence test at line ≈ 50. Reuse that helper's name instead of `memStorage` if it differs.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/debrief.test.ts tests/unit/progress.test.ts`
Expected: debrief FAIL (module missing); progress FAIL on the type of `debrief` (tsc is not run by vitest, so it may pass at runtime — that is fine; lint will catch the type until Step 3).

- [ ] **Step 3: Add the constant and regenerate the MODEL.md table**

In `src/config/constants.ts`, after `QUIZ_FACTOR_FLOOR`:

```ts
  QUIZ_FIX_BAND: c(0.25, 'fraction of the recommended step', 'Debrief: a learner value within 25 % of the recommended step of the recommended value counts as "matched"; the same direction but further away is "partial" [M]', 'M'),
```

Run: `npx tsx scripts/model-constants.ts` and confirm `docs/MODEL.md` gained the `QUIZ_FIX_BAND` row (`grep QUIZ_FIX_BAND docs/MODEL.md`).

- [ ] **Step 4: Extend `progress.ts`**

Add before `QuizAttempt`:

```ts
/** Compact debrief kept with an attempt (design 2026-09-11 §5): what changed, which patterns, pass. */
export interface DebriefSummary {
  changes: string[];
  patterns: string[];
  pass: boolean;
}
```

and inside `QuizAttempt` after `at: number;`:

```ts
  /** Present for attempts made after the debrief existed. */
  debrief?: DebriefSummary;
```

- [ ] **Step 5: Write `src/edu/debrief.ts`**

```ts
// src/edu/debrief.ts
/**
 * Quiz debrief (design 2026-09-11 §5, D-019). Pure: the controller collects the confirmed setting changes
 * (`settingChangesFrom` on every confirmed commit, `injectorChange` on injector toggles), the truth
 * patterns, the learner's picks and the fix grade, and `buildDebrief` turns them into four templated
 * sections — what you changed, what was happening, the recommended fix key by key, physiology and
 * recognition from the explain cards. No LLM, no free text (D-015).
 */
import { k } from '../config/constants';
import type { VentSettings } from '../sim/vent/settings';
import type { PatternId } from '../sim/truth/labeler';
import type { ScenarioFix } from './scenarios';
import { CARDS } from './cards';
import { gradeIdentification, type FixGrade } from './quiz';
import type { DebriefSummary } from './progress';

export type SettingValue = string | number | boolean;

export interface SettingChange {
  /** Simulated seconds. */
  t: number;
  /** A `VentSettings` key, `alarms.<limit>` or `injector:<kind>`. */
  key: string;
  from: SettingValue;
  to: SettingValue;
}

interface KeyMeta {
  label: string;
  unit?: string;
  /** Display multiplier (fractions shown as %). */
  scale?: number;
}

/** Bedside names for the setting keys (SettingsPanel labels, shortened). */
const KEY_META: Record<string, KeyMeta> = {
  mode: { label: 'Mode' },
  peep: { label: 'PEEP', unit: 'cmH2O' },
  fio2: { label: 'FiO2', unit: '%', scale: 100 },
  triggerType: { label: 'Trigger type' },
  flowTrigger: { label: 'Flow trigger', unit: 'L/min' },
  pressureTrigger: { label: 'Pressure trigger', unit: 'cmH2O' },
  biasFlow: { label: 'Bias flow', unit: 'L/min' },
  vt: { label: 'Vt', unit: 'mL' },
  rr: { label: 'Rate', unit: '/min' },
  vcTiming: { label: 'VC timing' },
  peakFlow: { label: 'Peak flow', unit: 'L/min' },
  flowPattern: { label: 'Flow pattern' },
  rampEndFraction: { label: 'Ramp end', unit: '%', scale: 100 },
  pause: { label: 'Insp. pause', unit: 's' },
  pinsp: { label: 'Pinsp', unit: 'cmH2O' },
  ti: { label: 'Ti', unit: 's' },
  riseTime: { label: 'Rise time', unit: 's' },
  ps: { label: 'PS', unit: 'cmH2O' },
  ets: { label: 'ETS', unit: '%', scale: 100 },
  tiMax: { label: 'Ti max', unit: 's' },
  apneaTime: { label: 'Apnea time', unit: 's' },
  backupRR: { label: 'Backup rate', unit: '/min' },
  backupPinsp: { label: 'Backup Pinsp', unit: 'cmH2O' },
  leakCompensation: { label: 'Leak compensation' },
  esophagealBalloon: { label: 'Esophageal balloon' },
};

const INJECTOR_PREFIX = 'injector:';
const ALARM_PREFIX = 'alarms.';

function metaFor(key: string): KeyMeta {
  if (key.startsWith(INJECTOR_PREFIX)) {
    const kind = key.slice(INJECTOR_PREFIX.length);
    return { label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} injector` };
  }
  if (key.startsWith(ALARM_PREFIX)) return { label: `Alarm ${key.slice(ALARM_PREFIX.length)}` };
  return KEY_META[key] ?? { label: key };
}

function fmtValue(v: SettingValue, meta: KeyMeta): string {
  if (typeof v === 'number') {
    const x = v * (meta.scale ?? 1);
    return Number.isInteger(x) ? String(x) : String(Number(x.toFixed(2)));
  }
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return v;
}

/** Value with its unit, e.g. "6 cmH2O", "70 %", "pressure". */
export function formatValue(key: string, v: SettingValue): string {
  const meta = metaFor(key);
  const s = fmtValue(v, meta);
  return meta.unit ? `${s} ${meta.unit}` : s;
}

/** "PS 16 → 6 cmH2O at 84 s". */
export function formatChange(c: SettingChange): string {
  const meta = metaFor(c.key);
  const unit = meta.unit ? ` ${meta.unit}` : '';
  return `${meta.label} ${fmtValue(c.from, meta)} → ${fmtValue(c.to, meta)}${unit} at ${Math.round(c.t)} s`;
}

/** The entries of a confirmed commit: one per key whose value differs from the current settings. */
export function settingChangesFrom(t: number, current: VentSettings, partial: Partial<VentSettings>): SettingChange[] {
  const out: SettingChange[] = [];
  for (const [key, to] of Object.entries(partial) as Array<[keyof VentSettings, VentSettings[keyof VentSettings]]>) {
    if (to === undefined) continue;
    const from = current[key];
    if (key === 'alarms') {
      const a = from as VentSettings['alarms'];
      const b = to as VentSettings['alarms'];
      for (const id of Object.keys(b) as Array<keyof VentSettings['alarms']>) {
        if (a[id] !== b[id]) out.push({ t, key: `${ALARM_PREFIX}${id}`, from: a[id] as SettingValue, to: b[id] as SettingValue });
      }
      continue;
    }
    if (from !== to) out.push({ t, key, from: from as SettingValue, to: to as SettingValue });
  }
  return out;
}

/** An injector toggled on or off by the learner or a scripted fix. */
export function injectorChange(t: number, kind: string, on: boolean): SettingChange {
  return { t, key: `${INJECTOR_PREFIX}${kind}`, from: on ? 'off' : 'on', to: on ? 'on' : 'off' };
}

export type FixMark = 'matched' | 'partial' | 'not-done' | 'opposite';

/**
 * Compare the learner's final value with the recommended one, relative to the value at the start of the
 * fix window. Numeric: same direction and within QUIZ_FIX_BAND of the recommended step → matched; same
 * direction → partial; unchanged → not done; other direction → opposite. Non-numeric: exact / unchanged /
 * changed elsewhere (partial).
 */
export function fixMark(start: SettingValue, recommended: SettingValue, learner: SettingValue): FixMark {
  if (typeof start === 'number' && typeof recommended === 'number' && typeof learner === 'number') {
    const step = recommended - start;
    const moved = learner - start;
    if (step === 0) return moved === 0 ? 'matched' : 'opposite';
    if (moved === 0) return 'not-done';
    if (Math.sign(moved) !== Math.sign(step)) return 'opposite';
    return Math.abs(learner - recommended) <= k('QUIZ_FIX_BAND') * Math.abs(step) + 1e-9 ? 'matched' : 'partial';
  }
  if (learner === recommended) return 'matched';
  if (learner === start) return 'not-done';
  return 'partial';
}

export type IdMark = 'found' | 'missed' | 'extra';

export interface DebriefPattern {
  id: PatternId;
  title: string;
  evidence: string[];
  mark: IdMark;
}

export interface DebriefFixKey {
  key: string;
  label: string;
  recommended: string;
  learner: string;
  mark: FixMark;
}

export interface DebriefFix {
  note: string | null;
  keys: DebriefFixKey[];
  aiBefore: number | null;
  aiAfter: number | null;
  pass: boolean;
  /** Labels of the failed checks. */
  failed: string[];
}

export interface DebriefCard {
  id: PatternId;
  title: string;
  mechanism: string;
  signature: string;
  causes: string[];
  pitfalls: string[];
  fixes: string[];
}

export interface Debrief {
  changes: string[];
  happening: DebriefPattern[];
  fix: DebriefFix;
  physiology: DebriefCard[];
  summary: DebriefSummary;
}

export interface DebriefInput {
  /** Confirmed changes since the fix window started (any order). */
  changes: SettingChange[];
  truthPatterns: PatternId[];
  picks: PatternId[];
  fixGrade: FixGrade;
  /** AI when the fix window started, %; null when no breath had closed. */
  aiBefore: number | null;
  fix: ScenarioFix | null;
  settingsAtFixStart: VentSettings | null;
  finalSettings: VentSettings | null;
  injectorsAtFixStart: string[];
  finalInjectors: string[];
  /** Latest case evidence per truth pattern (missing = no sentence). */
  evidence: Partial<Record<PatternId, string[]>>;
}

export const NO_CHANGES_TEXT = 'No setting changes.';

export function buildDebrief(inp: DebriefInput): Debrief {
  const ordered = [...inp.changes].sort((a, b) => a.t - b.t);
  const changes = ordered.length ? ordered.map(formatChange) : [NO_CHANGES_TEXT];

  const id = gradeIdentification(inp.picks, inp.truthPatterns);
  const happening: DebriefPattern[] = [
    ...inp.truthPatterns.map((p) => ({ id: p, title: CARDS[p].title, evidence: inp.evidence[p] ?? [], mark: (id.hits.includes(p) ? 'found' : 'missed') as IdMark })),
    ...id.falsePositives.map((p) => ({ id: p, title: CARDS[p].title, evidence: [] as string[], mark: 'extra' as IdMark })),
  ];

  const keys: DebriefFixKey[] = [];
  if (inp.fix?.settings && inp.settingsAtFixStart && inp.finalSettings) {
    for (const [key, rec] of Object.entries(inp.fix.settings) as Array<[keyof VentSettings, SettingValue | undefined]>) {
      if (rec === undefined || key === 'alarms') continue;
      const start = inp.settingsAtFixStart[key] as SettingValue;
      const learner = inp.finalSettings[key] as SettingValue;
      keys.push({ key, label: metaFor(key).label, recommended: formatValue(key, rec), learner: formatValue(key, learner), mark: fixMark(start, rec, learner) });
    }
  }
  if (inp.fix?.injectors) {
    for (const [kind, params] of Object.entries(inp.fix.injectors)) {
      const key = `${INJECTOR_PREFIX}${kind}`;
      const rec = params === null ? 'off' : 'on';
      const start = inp.injectorsAtFixStart.includes(kind) ? 'on' : 'off';
      const learner = inp.finalInjectors.includes(kind) ? 'on' : 'off';
      keys.push({ key, label: metaFor(key).label, recommended: rec, learner, mark: fixMark(start, rec, learner) });
    }
  }
  const aiCheck = inp.fixGrade.checks.find((c) => c.id === 'ai');
  const fix: DebriefFix = {
    note: inp.fix?.note ?? null,
    keys,
    aiBefore: inp.aiBefore,
    aiAfter: aiCheck?.value ?? null,
    pass: inp.fixGrade.pass,
    failed: inp.fixGrade.checks.filter((c) => !c.ok).map((c) => c.label),
  };

  const physiology: DebriefCard[] = inp.truthPatterns.map((p) => {
    const c = CARDS[p];
    return { id: p, title: c.title, mechanism: c.mechanism, signature: c.signature, causes: c.causes, pitfalls: c.pitfalls, fixes: c.fixes };
  });

  return { changes, happening, fix, physiology, summary: { changes, patterns: [...inp.truthPatterns], pass: fix.pass } };
}
```

Check the alarm-limit key name used in the test (`highPpeak`) against `AlarmLimits` in `src/sim/vent/settings.ts` (`grep -n "interface AlarmLimits" -A 12 src/sim/vent/settings.ts`); if the field is named differently (e.g. `ppeakHigh`), use the real name in the test, not the code.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/debrief.test.ts tests/unit/progress.test.ts tests/unit/constants.test.ts`
Expected: PASS. If `constants.test.ts` checks that every constant is cited or appears in MODEL.md, the regenerated table satisfies it.

- [ ] **Step 7: Lint, commit, push**

```bash
npm run lint
git add src/edu/debrief.ts src/edu/progress.ts src/config/constants.ts docs/MODEL.md tests/unit/debrief.test.ts tests/unit/progress.test.ts
git commit -m "feat(quiz): setting-change log, recommended-fix marks and the templated debrief builder (D-019 part 2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DLxH7qsM5VLwiEQRDECPGs"
git push origin main
```

---

### Task 3: Controller state (hide set, lock, change log, debrief) and the DebriefPanel

**Files:**
- Modify: `src/app/controller.ts` (imports ≈ lines 24–31; `ViewState` 68–79; fields 96–114; `loadScenario` 150–178; `resetSessionState` 189–212; commands 440–443; explain 472–476; quiz 499–551; `setInjector` 607–609; `applyFix` 612–624; `setTruth` 648–651)
- Create: `src/ui/DebriefPanel.tsx`
- Modify: `src/ui/QuizPanel.tsx` (idle block lines 28–43; done block lines 83–100)
- Test: `tests/e2e/quiz.spec.ts` (must still pass, unchanged)

**Interfaces:**
- Consumes: Task 1 `QuizHideKey`; Task 2 `SettingChange`, `settingChangesFrom`, `injectorChange`, `buildDebrief`, `Debrief`; `explainBreath`, `effortEvidence` (already imported).
- Produces (used by Task 4/5 UI):
  ```ts
  ViewState.quizHide: Set<QuizHideKey>; ViewState.quizLocked: boolean;
  ctl.quizHides(key: QuizHideKey): boolean          // hidden right now (quiz running or locked)
  ctl.setQuizHide(keys: Iterable<QuizHideKey>): void
  ctl.lockQuiz(hide: Iterable<QuizHideKey>): void   // from a quiz link
  ctl.settingsChangeLog: SettingChange[]; ctl.quizPicks: PatternId[]; ctl.lastDebrief: Debrief | null
  ```

- [ ] **Step 1: Controller — imports and state**

Add imports:

```ts
import type { QuizHideKey } from '../edu/quiz-view';
import { buildDebrief, injectorChange, settingChangesFrom, type Debrief, type SettingChange } from '../edu/debrief';
```

In `ViewState` add after `badges: boolean;`:

```ts
  /** Instructor's hide set for the bedside view (design 2026-09-11); acts only while a quiz runs or the session is locked. */
  quizHide: Set<QuizHideKey>;
  /** Set by a quiz link; cleared on evaluate / end. Hides the instructor panel and disables the picker and truth toggle. */
  quizLocked: boolean;
```

Initialise in the `view` field: `view: ViewState = { truth: false, badges: true, drawerTab: 'scenario', frozen: false, tView: NaN, sweep: 12, speed: 1, paused: false, quizHide: new Set(), quizLocked: false };`

Add fields after `settingChanges = 0;`:

```ts
  /** Confirmed setting and injector changes since the scenario started (debrief). */
  settingsChangeLog: SettingChange[] = [];
  /** The learner's identification picks (debrief). */
  quizPicks: PatternId[] = [];
  /** Debrief of the last evaluated quiz; null until evaluate. */
  lastDebrief: Debrief | null = null;
  private aiAtFixStart: number | null = null;
  private settingsAtFixStart: VentSettings | null = null;
  private injectorsAtFixStart: string[] = [];
```

In both `loadScenario` and `resetSessionState`, after `this.settingChanges = 0;` add:

```ts
    this.settingsChangeLog = [];
    this.quizPicks = [];
    this.lastDebrief = null;
```

(Do not touch `quizHide`/`quizLocked` there: `App` decides the lock from the hash after loading.)

- [ ] **Step 2: Controller — hide set and lock**

Add after `setDrawerTab`:

```ts
  // ─────────── bedside view (design 2026-09-11, D-019) ───────────

  /** True when `key` is hidden right now: the instructor set it and a quiz is running or the session is locked. */
  quizHides(key: QuizHideKey): boolean {
    if (!this.view.quizHide.has(key)) return false;
    const p = this.quiz.phase;
    return this.view.quizLocked || p === 'identify' || p === 'identified' || p === 'fix';
  }

  setQuizHide(keys: Iterable<QuizHideKey>): void {
    this.view.quizHide = new Set(keys);
    if (this.quizHides('explain') && this.view.drawerTab === 'explain') this.view.drawerTab = 'quiz';
    this.notify();
  }

  /** A quiz link: apply its hide set, lock the session and open the Quiz tab. */
  lockQuiz(hide: Iterable<QuizHideKey>): void {
    this.view.quizHide = new Set(hide);
    this.view.quizLocked = true;
    this.view.drawerTab = 'quiz';
    if (this.view.truth && this.quizHides('truth')) this.view.truth = false;
    this.notify();
  }
```

- [ ] **Step 3: Controller — change log**

Replace `applySettings`:

```ts
  applySettings(partial: Partial<VentSettings>): void {
    this.settingChanges += 1;
    if (this.status) this.settingsChangeLog.push(...settingChangesFrom(this.store.tLatest, this.status.settings, partial));
    this.worker.applySettings(partial);
  }
```

Replace `setInjector`:

```ts
  setInjector<K extends InjectorKind>(kind: K, params: Partial<InjectorParamMap[K]> | null): void {
    this.settingsChangeLog.push(injectorChange(this.store.tLatest, kind, params !== null));
    this.worker.inject(kind, params);
  }
```

In `applyFix`, replace the two branches:

```ts
    if (fix.settings) {
      this.settingChanges += 1;
      if (this.status) this.settingsChangeLog.push(...settingChangesFrom(this.store.tLatest, this.status.settings, fix.settings));
      this.worker.applySettings(fix.settings);
    }
    if (fix.drive) this.worker.setPatient(fix.drive);
    if (fix.injectors) {
      for (const kind of INJECTOR_KINDS) {
        if (kind in fix.injectors) {
          const params = fix.injectors[kind] ?? null;
          const wasOn = this.status?.injectors.includes(kind) ?? false;
          if ((params !== null) !== wasOn) this.settingsChangeLog.push(injectorChange(this.store.tLatest, kind, params !== null));
          this.worker.inject(kind, params);
        }
      }
    }
```

- [ ] **Step 4: Controller — quiz flow and debrief**

Replace `startQuiz`, `submitQuizPicks`, `startQuizFix`, `evaluateQuiz`, `endQuiz`:

```ts
  startQuiz(): void {
    this.quiz.start(this.store.tLatest);
    this.view.badges = false;
    this.view.drawerTab = 'quiz';
    this.lastDebrief = null;
    this.notify();
  }

  submitQuizPicks(picks: PatternId[]): void {
    this.quizPicks = [...picks];
    this.quiz.submitIdentification(picks, this.quizTruthPatterns());
    // Badges return unless the truth layer is hidden for this quiz (then they wait for the debrief).
    this.view.badges = !this.quizHides('truth');
    this.notify();
  }

  startQuizFix(): void {
    this.quiz.startFix(this.store.tLatest, this.settingChanges);
    this.alarmsAtFixStart = this.alarmLog.length;
    this.aiAtFixStart = this.ai?.ai ?? null;
    this.settingsAtFixStart = this.status?.settings ?? null;
    this.injectorsAtFixStart = this.status?.injectors.slice() ?? [];
    this.notify();
  }

  evaluateQuiz(): void {
    if (!this.quiz.fixWindowReady(this.store.tLatest)) return;
    const r = this.quiz.evaluate(this.store.tLatest, this.quizFixInput(), this.settingChanges);
    this.lastDebrief = this.buildQuizDebrief(r.fix);
    r.attempt.debrief = this.lastDebrief.summary;
    if (this.scenario) this.progress.record(this.scenario.id, r.attempt);
    this.view.badges = true;
    this.view.quizLocked = false;
    this.notify();
  }

  endQuiz(): void {
    this.quiz.reset();
    this.view.badges = true;
    this.view.quizLocked = false;
    this.notify();
  }

  /** Latest case-evidence sentences per truth pattern (explain-card templates), for the debrief. */
  private latestEvidenceByPattern(patterns: PatternId[]): Partial<Record<PatternId, string[]>> {
    const out: Partial<Record<PatternId, string[]>> = {};
    const settings = this.settings;
    if (!settings || !this.patient) return out;
    const labels = [...this.labels.values()].map((l) => l.truth).filter((l): l is BreathLabel => l !== null).sort((a, b) => b.tStart - a.tStart);
    for (const p of patterns) {
      if (p === 'ineffective-effort') {
        const e = [...this.efforts].reverse().find((x) => x.ineffective);
        if (e) out[p] = effortEvidence(e, settings);
        continue;
      }
      const l = labels.find((x) => x.patterns.includes(p));
      if (!l) continue;
      const neural = l.neuralIndex !== null ? (this.store.neural.find((n) => n.index === l.neuralIndex) ?? null) : null;
      const ex = explainBreath({ label: l, neural, settings, pbw: this.patient.pbw }).find((c) => c.card.id === p);
      if (ex) out[p] = ex.evidence;
    }
    return out;
  }

  private buildQuizDebrief(fixGrade: FixGrade): Debrief {
    const truthPatterns = this.quiz.identification?.truth ?? this.quizTruthPatterns();
    const t0 = this.quiz.fixWindowStart;
    return buildDebrief({
      changes: this.settingsChangeLog.filter((c) => c.t >= t0 - 1e-9),
      truthPatterns,
      picks: this.quizPicks,
      fixGrade,
      aiBefore: this.aiAtFixStart,
      fix: this.scenario?.fix ?? null,
      settingsAtFixStart: this.settingsAtFixStart,
      finalSettings: this.status?.settings ?? null,
      injectorsAtFixStart: this.injectorsAtFixStart,
      finalInjectors: this.status?.injectors.slice() ?? [],
      evidence: this.latestEvidenceByPattern(truthPatterns),
    });
  }
```

Import `FixGrade` from `'../edu/quiz'` (extend the existing import: `import { SEVERE_ALARMS, extrasFromTruth, truthPatternsInWindow, type FixGrade, type FixInput } from '../edu/quiz';`).

Replace `selectBreath` and `setTruth`:

```ts
  selectBreath(index: number | null): void {
    if (this.quizHides('explain')) return;
    this.selectedBreath = index;
    this.view.drawerTab = 'explain';
    this.notify();
  }

  setTruth(on: boolean): void {
    if (on && (this.view.quizLocked || this.quizHides('truth'))) return;
    this.view.truth = on;
    this.notify();
  }
```

- [ ] **Step 5: `DebriefPanel.tsx`**

```tsx
// src/ui/DebriefPanel.tsx
import type { Debrief } from '../edu/debrief';
import type { FixCheck } from '../edu/quiz';

interface Props {
  d: Debrief;
  checks: FixCheck[];
}

const ID_MARK: Record<Debrief['happening'][number]['mark'], string> = { found: 'you found it', missed: 'you missed it', extra: 'your pick, not present' };
const FIX_MARK: Record<Debrief['fix']['keys'][number]['mark'], string> = { matched: 'matched', partial: 'partial (right direction)', 'not-done': 'not done', opposite: 'opposite direction' };

/** Debrief (design 2026-09-11 §5): four templated sections shown when a quiz is evaluated. */
export function DebriefPanel({ d, checks }: Props) {
  return (
    <div class="debrief" data-testid="debrief-panel">
      <section data-testid="debrief-changes">
        <h3>What you changed</h3>
        <ol>
          {d.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
      </section>
      <section data-testid="debrief-happening">
        <h3>What was happening</h3>
        {d.happening.length === 0 && <p class="muted">No dyssynchrony pattern was present in the window.</p>}
        <ul>
          {d.happening.map((h) => (
            <li key={h.id} class={`mark-${h.mark}`} data-testid={`debrief-pattern-${h.id}`}>
              <b>{h.title}</b> <span class="muted">· {ID_MARK[h.mark]}</span>
              {h.evidence.length > 0 && <div class="small evidence-case">{h.evidence.join(' ')}</div>}
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="debrief-fix">
        <h3>The recommended fix</h3>
        {d.fix.note ? <p data-testid="debrief-fix-note">{d.fix.note}</p> : <p class="muted">This scenario has no scripted fix.</p>}
        {d.fix.keys.length > 0 && (
          <table class="debrief-keys">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Recommended</th>
                <th>You</th>
                <th>Mark</th>
              </tr>
            </thead>
            <tbody>
              {d.fix.keys.map((x) => (
                <tr key={x.key} class={`mark-${x.mark}`} data-testid={`debrief-key-${x.key}`}>
                  <td>{x.label}</td>
                  <td>{x.recommended}</td>
                  <td>{x.learner}</td>
                  <td>{FIX_MARK[x.mark]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>
          Outcome: AI {d.fix.aiBefore === null ? '—' : `${d.fix.aiBefore.toFixed(0)} %`} before → {d.fix.aiAfter === null ? '—' : `${d.fix.aiAfter.toFixed(0)} %`} after · fix {d.fix.pass ? 'passed' : 'failed'}
          {d.fix.failed.length ? ` · failed: ${d.fix.failed.join('; ')}` : ''}
        </p>
        <ul>
          {checks.map((c) => (
            <li key={c.id} class={c.ok ? '' : 'fail'}>
              {c.ok ? '✓' : '✗'} {c.label}
              {c.value !== null ? `: ${typeof c.value === 'number' ? c.value.toFixed(1) : c.value}` : ''}
              {!c.verified ? ' (not verified: take an inspiratory hold)' : ''}
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="debrief-physiology">
        <h3>Physiology and recognition</h3>
        {d.physiology.map((c) => (
          <article class="card" key={c.id}>
            <h4>{c.title}</h4>
            <p>
              <b>Why it happens.</b> {c.mechanism}
            </p>
            <p>
              <b>Signature.</b> {c.signature}
            </p>
            <div class="two-col">
              <div>
                <b>Causes</b>
                <ul>
                  {c.causes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <b>Pitfalls</b>
                <ul>
                  {c.pitfalls.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
            <b>Fixes, in order</b>
            <ol>
              {c.fixes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </article>
        ))}
      </section>
    </div>
  );
}
```

Add to `src/ui/theme.css` next to the `.quiz` rules (line ≈ 664):

```css
.debrief h3 { margin: 0.6em 0 0.2em; font-size: 0.95em; }
.debrief h4 { margin: 0.4em 0 0.2em; }
.debrief .debrief-keys { border-collapse: collapse; margin: 0.3em 0; }
.debrief .debrief-keys th, .debrief .debrief-keys td { padding: 0.1em 0.6em 0.1em 0; text-align: left; }
.debrief .mark-matched td:last-child, .debrief li.mark-found > .muted { color: #81c784; }
.debrief .mark-partial td:last-child { color: #ffd54f; }
.debrief .mark-not-done td:last-child, .debrief li.mark-missed > .muted { color: #ef9a9a; }
.debrief .mark-opposite td:last-child, .debrief li.mark-extra > .muted { color: #ef9a9a; }
.debrief .card { border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 0.3em; margin-top: 0.4em; }
```

(Check the palette in `theme.css` — the panels are dark; if `.explain .card` already defines a card border, match its values instead.)

- [ ] **Step 6: `QuizPanel.tsx`**

Import `DebriefPanel`:

```tsx
import { DebriefPanel } from './DebriefPanel';
```

Idle block: wrap the progress paragraph so it is hidden while `scenario` is hidden (only true when locked in idle), and show the last attempt's summary:

```tsx
          {progress && !ctl.quizHides('scenario') && (
            <p class="muted" data-testid="quiz-progress">
              This scenario: {progress.attempts} attempt{progress.attempts === 1 ? '' : 's'}, best {progress.best}
              {progress.passed ? ', fixed at least once' : ''}.
              {progress.history.at(-1)?.debrief ? ` Last attempt: ${progress.history.at(-1)?.debrief?.pass ? 'fixed' : 'not fixed'} — ${progress.history.at(-1)?.debrief?.changes.join('; ')}` : ''}
            </p>
          )}
```

Done block: keep the score paragraph and the `quiz-result` wrapper; replace the `<ul>` of checks with the debrief:

```tsx
      {q.phase === 'done' && q.result && (
        <div class="small" data-testid="quiz-result" data-score={q.result.score} data-pass={q.result.fix.pass ? '1' : '0'}>
          <p>
            <b data-testid="quiz-score">Score {q.result.score}</b> · fix {q.result.fix.pass ? 'passed' : 'failed'} · {q.result.seconds.toFixed(0)} s · {q.result.changes} change{q.result.changes === 1 ? '' : 's'} · identification {((q.identification?.score ?? 0) * 100).toFixed(0)} %
          </p>
          {ctl.lastDebrief ? (
            <DebriefPanel d={ctl.lastDebrief} checks={q.result.fix.checks} />
          ) : (
            <ul>
              {q.result.fix.checks.map((c) => (
                <li key={c.id} class={c.ok ? '' : 'fail'}>
                  {c.ok ? '✓' : '✗'} {c.label}
                  {c.value !== null ? `: ${typeof c.value === 'number' ? c.value.toFixed(1) : c.value}` : ''}
                  {!c.verified ? ' (not verified: take an inspiratory hold)' : ''}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => ctl.endQuiz()} data-testid="quiz-end">
            Done
          </button>
        </div>
      )}
```

- [ ] **Step 7: Lint, unit tests, and the existing quiz e2e**

```bash
npm run lint
npm test
npx playwright test tests/e2e/quiz.spec.ts
```

Expected: lint clean; Vitest all green (re-run the performance test alone if it fails under load); `quiz.spec.ts` 5/5 (the result still contains "PL,ee" through the checks list inside the debrief).

- [ ] **Step 8: Commit, push, deploy check**

```bash
git add src/app/controller.ts src/ui/DebriefPanel.tsx src/ui/QuizPanel.tsx src/ui/theme.css
git commit -m "feat(quiz): controller hide set, lock, confirmed-change log and the debrief panel on evaluate (D-019 part 3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DLxH7qsM5VLwiEQRDECPGs"
git push origin main
```

Deploy check with `NEEDLE='debrief-panel'`.

---

### Task 4: Hide plumbing in the UI, locking, the quiz link at load, and the bedside e2e test

**Files:**
- Modify: `src/app/App.tsx` (hash helpers 34–39; effect 50–76; header 107–120; left column 123–128; centre 129–185; right 186–212)
- Modify: `src/ui/TruthToggle.tsx`, `src/ui/ScenarioPicker.tsx`, `src/ui/MonitorPanel.tsx` (tiles 31–55), `src/ui/ExportPanel.tsx` (buttons 46–55, checkbox 64–66), `src/ui/WaveformCanvas.tsx` (`onMove` 183)
- Test: `tests/e2e/quiz-bedside.spec.ts`

**Interfaces:**
- Consumes: Task 3 `ctl.quizHides`, `ctl.lockQuiz`, `view.quizLocked`; Task 1 `parseQuizHash`.
- Produces: props `TruthToggle.disabled?`, `ScenarioPicker.disabled?`/`mask?`, `MonitorPanel.hideBalloonTiles?`, `ExportPanel.hideTruth?`.

- [ ] **Step 1: Write the failing e2e test**

```ts
// tests/e2e/quiz-bedside.spec.ts
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
  // The compact summary is stored with the attempt.
  const stored = await page.evaluate(() => localStorage.getItem('ventsim.progress.v1') ?? '');
  expect(stored).toContain('"debrief"');
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/quiz-bedside.spec.ts`
Expected: the first test FAILS at `quizLocked` (false — the hash with `?quiz=` is not parsed yet, so the default scenario loads).

- [ ] **Step 3: `TruthToggle.tsx`**

```tsx
interface Props {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Disabled while a bedside quiz hides the truth layer or the session is locked. */
  disabled?: boolean;
}

/** "What the bedside sees ↔ what's really happening" (Spec §6). */
export function TruthToggle({ on, onChange, disabled = false }: Props) {
  return (
    <button
      type="button"
      class={`truth-toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      disabled={disabled}
      data-testid="truth-toggle"
      title={disabled ? 'The truth layer is hidden for this quiz' : 'Toggle the truth layer: Pmus, Palv, Ppl, Pes, PL and compartment flows'}
    >
      <span class={on ? 'muted' : ''}>What the bedside sees</span>
      <span class="arrow">↔</span>
      <span class={on ? '' : 'muted'}>what's really happening</span>
    </button>
  );
}
```

- [ ] **Step 4: `ScenarioPicker.tsx`**

Add props and mask the current option:

```tsx
interface Props {
  current: ScenarioDef | null;
  onPick: (id: string) => void;
  progress?: Record<string, ScenarioProgress>;
  /** Locked quiz: the learner cannot switch cases. */
  disabled?: boolean;
  /** Scenario text hidden: the current case reads "Case" (the other titles stay, the learner may switch if not locked). */
  mask?: boolean;
}

export function ScenarioPicker({ current, onPick, progress, disabled = false, mask = false }: Props) {
  const groups = new Map<ScenarioDef['category'], ScenarioDef[]>();
  for (const s of SCENARIOS) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
  return (
    <label class="scenario-picker">
      <span class="muted small">Scenario</span>
      <select value={current?.id ?? ''} onChange={(e) => onPick((e.currentTarget).value)} data-testid="scenario-select" disabled={disabled}>
        {!current && <option value="">Choose a scenario…</option>}
        {[...groups.entries()].map(([cat, list]) => (
          <optgroup label={CATEGORY_LABEL[cat]} key={cat}>
            {list.map((s) => (
              <option value={s.id} key={s.id}>
                {mask && s.id === current?.id ? 'Case' : s.title}
                {!mask && progress?.[s.id] ? ` · best ${progress[s.id]?.best}${progress[s.id]?.passed ? ' ✓' : ''}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 5: `MonitorPanel.tsx`**

Add prop `hideBalloonTiles?: boolean` (default false) to `Props` and the destructuring; build the tiles then filter:

```tsx
  const balloonOnly = new Set(['ΔPes/ΔPaw']);
  const shown = tiles
    .filter(([label]) => !(hideBalloonTiles && balloonOnly.has(label)))
    .map(([label, val, unit]): [string, string, string] => (hideBalloonTiles && label === 'SpO2' ? [label, val, '% schematic'] : [label, val, unit]));
```

and render `shown.map(...)` instead of `tiles.map(...)`. (The occlusion-test maneuver button stays; it is already disabled without the balloon.)

- [ ] **Step 6: `ExportPanel.tsx`**

Add prop `hideTruth?: boolean` (default false). Wrap the truth CSV button in `{!hideTruth && (...)}`, and the batch checkbox likewise; when `hideTruth`, the batch grid uses `truth: false`:

```tsx
    const grid: BatchGrid = { ..., truth: hideTruth ? false : truth };
```

- [ ] **Step 7: `WaveformCanvas.tsx`**

In `onMove`, at the top of the badge-strip branch (line ≈ 183), skip the evidence popup when explain is hidden:

```tsx
    if (y < badgeStripHeight({ showBadges: ctl.view.badges, truthBadges: truth })) {
      if (ctl.quizHides('explain')) {
        cursorRef.current = null;
        setReadout(null);
        return;
      }
```

(The click path already goes through `ctl.selectBreath`, which ignores the click when explain is hidden.)

- [ ] **Step 8: `App.tsx`**

Imports:

```tsx
import { parseQuizHash } from '../edu/quiz-view';
```

Hash helpers (replace `hashPage`):

```tsx
/** Page part of the hash: `#copd?quiz=bedside` → `copd`; `#validation` → `validation`. */
function hashPage(): string {
  return location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
}
```

Effect: after `if (hashPage() !== VALIDATION_HASH) ctl.loadScenario(fromHash());` add

```tsx
    const applyQuizLink = () => {
      const info = parseQuizHash(location.hash);
      if (info?.locked && info.scenarioId === ctl.scenario?.id) ctl.lockQuiz(info.hide);
    };
    if (hashPage() !== VALIDATION_HASH) applyQuizLink();
```

and inside `onHash`, after the `if (id !== ctl.scenario?.id) {...}` block, add `applyQuizLink();`.

Derive the flags after `const scenario = ctl.scenario;`:

```tsx
  const hideTruth = ctl.quizHides('truth');
  const hidePes = ctl.quizHides('pes');
  const hideScenario = ctl.quizHides('scenario');
  const hideDerived = ctl.quizHides('derived');
  const hideExplain = ctl.quizHides('explain');
  const hideCo2 = ctl.quizHides('co2');
  const locked = view.quizLocked;
  const truthOn = view.truth && !hideTruth;
  const tabs = (['scenario', 'explain', 'quiz', 'export'] as DrawerTab[]).filter((t) => !(hideExplain && t === 'explain'));
```

Header:

```tsx
        <ScenarioPicker current={scenario} onPick={pick} progress={ctl.progress.all()} disabled={locked} mask={hideScenario} />
        <TruthToggle on={truthOn} onChange={(on) => ctl.setTruth(on)} disabled={locked || hideTruth} />
        ... balloon toggle unchanged ...
        {!hideDerived && (
          <a class="small muted" href="#validation" data-testid="validation-link">
            Validation
          </a>
        )}
```

Left column:

```tsx
          {status?.co2 && !hideCo2 && <Co2Panel co2={status.co2} onWarp={(w) => ctl.setWarp(w)} />}
          {status && !locked && <InstructorPanel ctl={ctl} />}
```

Centre: `WaveformCanvas ... truth={truthOn} balloon={balloonOn && !hidePes}`; `LoopCanvas loops={truthOn ? [...BEDSIDE_LOOPS, ...TRUTH_LOOPS] : BEDSIDE_LOOPS}`; tabs `tabs.map(...)`; the scenario-info block becomes:

```tsx
              {view.drawerTab === 'scenario' && scenario && (
                <div class="scenario-info" data-testid="scenario-info">
                  {hideScenario ? (
                    <p class="small muted">Case · scenario details are hidden for this quiz.</p>
                  ) : (
                    <>
                      <button type="button" class="link" onClick={() => setShowObjectives(!showObjectives)} aria-expanded={showObjectives}>
                        {showObjectives ? '▾' : '▸'} {scenario.title}
                      </button>
                      {showObjectives && ( ...existing body unchanged... )}
                    </>
                  )}
                </div>
              )}
```

(Import `Fragment` is not needed with the `<>` shorthand under Preact's automatic JSX runtime — check `tsconfig.json` `jsx`/`jsxImportSource`; if the project uses `h`, import `Fragment` from `preact`.)

`{view.drawerTab === 'explain' && !hideExplain && <ExplainCard ctl={ctl} />}`; `<ExportPanel ctl={ctl} hideTruth={locked} />`.

Right column: `MonitorPanel ... hideBalloonTiles={hidePes || hideDerived}`; wrap the dashboard in `{settings && !hideDerived && (<LungStressDashboard ... truthOn={truthOn} balloon={balloonOn && !hidePes} />)}`.

- [ ] **Step 9: Run the tests**

```bash
npm run lint
npx playwright test tests/e2e/quiz-bedside.spec.ts tests/e2e/quiz.spec.ts tests/e2e/a11y.spec.ts
```

Expected: all pass. If the `fill('6')` on `setting-ps` does not register (the field's `onInput` parses `e.currentTarget.value`), use `page.getByTestId('setting-ps').fill('6')` followed by `page.getByTestId('setting-ps').press('Tab')`; if the ETS field expects percent, `70` is right (`toDisplay` is ×100).

- [ ] **Step 10: Commit, push, deploy check**

```bash
git add src/app/App.tsx src/ui/TruthToggle.tsx src/ui/ScenarioPicker.tsx src/ui/MonitorPanel.tsx src/ui/ExportPanel.tsx src/ui/WaveformCanvas.tsx tests/e2e/quiz-bedside.spec.ts
git commit -m "feat(quiz): bedside view — hide set applied in the UI, locked quiz link at load, e2e (D-019 part 4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DLxH7qsM5VLwiEQRDECPGs"
git push origin main
```

Deploy check with `NEEDLE='scenario details are hidden'`. Then open `https://vent-sim.netlify.app/#ineffective-effort?quiz=bedside` with Playwright (`mcp__plugin_playwright_playwright__browser_navigate`) and confirm the truth toggle is disabled and no Instructor panel is shown.

---

### Task 5: Instructor panel "Quiz view" section (checkboxes, Bedside preset, copy link)

**Files:**
- Modify: `src/ui/InstructorPanel.tsx` (add a `row` before the scenario editor, line ≈ 139)
- Test: append to `tests/e2e/quiz-bedside.spec.ts`

**Interfaces:**
- Consumes: `QUIZ_HIDE_KEYS`, `QUIZ_HIDE_LABELS`, `bedsideHide`, `quizLink` (Task 1); `ctl.setQuizHide`, `ctl.view.quizHide` (Task 3).

- [ ] **Step 1: Write the failing e2e test** (append to `quiz-bedside.spec.ts`)

```ts
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
  // Not locked: the instructor panel is still there and the picker enabled.
  await expect(page.getByTestId('instructor-panel')).toBeVisible();
  await expect(page.getByTestId('scenario-select')).toBeEnabled();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/quiz-bedside.spec.ts -g "quiz view checkboxes"`
Expected: FAIL — `quizview-truth` not found.

- [ ] **Step 3: Add the section to `InstructorPanel.tsx`**

Imports:

```tsx
import { QUIZ_HIDE_KEYS, QUIZ_HIDE_LABELS, bedsideHide, quizLink, type QuizHideKey } from '../edu/quiz-view';
```

Inside the body, before `<div class="row editor">`:

```tsx
          <div class="row quizview" data-testid="quizview">
            <b>Quiz view</b>
            <span class="muted">Hidden from the learner while a quiz runs (or the link is locked):</span>
            {QUIZ_HIDE_KEYS.map((key) => (
              <label class="inline" key={key} title={QUIZ_HIDE_LABELS[key]}>
                <input
                  type="checkbox"
                  checked={ctl.view.quizHide.has(key)}
                  onChange={(e) => {
                    const next = new Set<QuizHideKey>(ctl.view.quizHide);
                    if (e.currentTarget.checked) next.add(key);
                    else next.delete(key);
                    ctl.setQuizHide(next);
                  }}
                  data-testid={`quizview-${key}`}
                />
                <span>{key}</span>
              </label>
            ))}
            <button type="button" onClick={() => ctl.setQuizHide(bedsideHide())} data-testid="quizview-bedside">
              Bedside
            </button>
            <button type="button" onClick={() => ctl.setQuizHide([])} data-testid="quizview-none">
              Show all
            </button>
            <input
              type="text"
              readOnly
              value={quizLink(ctl.scenario?.id ?? '', ctl.view.quizHide, `${location.origin}${location.pathname}`)}
              aria-label="Locked quiz link"
              data-testid="quizview-link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={() => {
                const link = quizLink(ctl.scenario?.id ?? '', ctl.view.quizHide, `${location.origin}${location.pathname}`);
                void navigator.clipboard
                  ?.writeText(link)
                  .then(() => setMsg('quiz link copied'))
                  .catch(() => setMsg('copy blocked: select the link field and copy it'));
              }}
              data-testid="quizview-copy"
            >
              Copy quiz link
            </button>
          </div>
```

Add to `theme.css` under the instructor rules: `.instructor-body .quizview input[type='text'] { width: 100%; font-size: 0.8em; }`.

- [ ] **Step 4: Run the tests**

```bash
npm run lint
npx playwright test tests/e2e/quiz-bedside.spec.ts tests/e2e/quiz.spec.ts tests/e2e/a11y.spec.ts
```

Expected: all pass.

- [ ] **Step 5: Commit, push, deploy check**

```bash
git add src/ui/InstructorPanel.tsx src/ui/theme.css tests/e2e/quiz-bedside.spec.ts
git commit -m "feat(quiz): instructor \"Quiz view\" checkboxes, Bedside preset and copyable locked link (D-019 part 5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DLxH7qsM5VLwiEQRDECPGs"
git push origin main
```

Deploy check with `NEEDLE='Copy quiz link'`.

---

### Task 6: Full verification and docs (README, D-019, PROGRESS, HANDOFF)

**Files:**
- Modify: `README.md` (feature bullet ≈ line 32; "Using the app" list ≈ 61–66; docs table D-range ≈ line 74), `docs/DECISIONS.md` (append D-019), `PROGRESS.md` (append entry), `docs/HANDOFF.md` (header, table, "Post-M9 as built" map, "What is left" 4 → done, "Read in this order" D-range)

- [ ] **Step 1: Full verification**

```bash
npm run lint
npm test            # re-run the performance test alone if it fails under load
npm run test:e2e    # expect 28 + 3 = 31 passed
npm run build
```

Record the exact counts for PROGRESS.

- [ ] **Step 2: README**

Feature bullet: extend the quiz phrase to "... a quiz (identify the patterns with the badges hidden, then fix them within safety limits) with an instructor-set **bedside view** (hide truth, Pes, scenario text, derived numbers, explain cards, CO2), a locked quiz link, and a templated debrief on submit, ...".

Add to "Using the app" after the Drawer tabs bullet:

```markdown
- **Quiz bedside view** (Instructor panel → Quiz view): tick what the learner must not see during a quiz —
  truth layer, Pes, scenario text, derived numbers (lung-stress dashboard), explain cards, CO2 — or press
  **Bedside** for all six. Outside a quiz the set has no effect. **Copy quiz link** gives
  `…/#<scenario-id>?quiz=bedside` (or a comma-separated key list); opening it locks the session: no
  Instructor panel, picker and truth toggle disabled, truth exports hidden, Quiz tab open. On **Evaluate**
  the lock lifts and a debrief lists what you changed, what was happening (found / missed / extra), the
  recommended fix key by key (matched / partial / not done / opposite) with the AI before and after, and
  the physiology and recognition from the explain cards. The lock is a classroom convenience, not security.
```

Docs table: `D-001…D-015` → `D-001…D-019`.

- [ ] **Step 3: D-019 in `docs/DECISIONS.md`** (append)

```markdown
## D-019 · Quiz bedside view, locked link and templated debrief (2026-09-11)

- **What is hidden and why.** Six keys (`src/edu/quiz-view.ts`): `truth` (layer, toggle, truth badges,
  truth-only readouts), `pes` (the Pes row and the tiles that need the balloon), `scenario` (title →
  "Case", summary, objectives, targets, suggested fix, best score), `derived` (lung-stress dashboard,
  Validation link, balloon-only tiles), `explain` (tab, badge click, badge hover evidence), `co2` (panel
  and warp). The preset `bedside` is all six: what a resident sees at the bedside is the ventilator screen
  and the monitor, nothing that names the case or exposes the model. The set is stored in
  `ctl.view.quizHide` and acts only while a quiz is in `identify`/`identified`/`fix` or the session is
  locked (`ctl.quizHides(key)`), so the instructor previews the case normally.
- **Badges** were already hidden during identification (M8); with `truth` hidden they stay hidden through
  the fix phase and return with the debrief, because the truth badge row would otherwise name the pattern.
- **Locking is not security.** `#<id>?quiz=<keys|bedside>` sets `ctl.view.quizLocked`: the Instructor
  panel is not rendered, the picker and the truth toggle are disabled, truth exports are hidden. The lock
  lifts on `evaluateQuiz` and `endQuiz`. The URL is editable; a learner who edits it has opted out of the
  exercise, which is acceptable in a classroom.
- **Debrief is templated** (`src/edu/debrief.ts`, no LLM, D-015): the confirmed setting changes since the
  fix window started (`settingsChangeLog`, appended in `applySettings`, `applyFix` and `setInjector`, one
  entry per changed key, alarm limits per limit, injectors as on/off), the truth patterns by card title
  with the latest case-evidence sentence and found / missed / extra marks, the scenario `fix.note` and
  its settings key by key with a mark — **matched** (same direction, within `QUIZ_FIX_BAND` = 25 % of the
  recommended step of the recommended value), **partial** (same direction), **not done**, **opposite** —
  plus the AI before and after and the failed checks, then mechanism, signature, causes, pitfalls and the
  ranked fixes from the cards. Grading is unchanged. A compact summary (changes, patterns, pass) is stored
  with the attempt (`QuizAttempt.debrief`) and shown in the Quiz tab's idle state.
- **Not done.** No per-learner identity, no server, no instructor dashboard; the picker still lists the
  other case titles when `scenario` is hidden and the session is not locked (the learner may switch cases).
```

- [ ] **Step 4: PROGRESS entry** (append)

```markdown
## Post-M9 · Quiz bedside view and debrief (2026-09-11)

D-019, design `docs/superpowers/specs/2026-09-11-quiz-bedside-view-design.md`, plan
`docs/superpowers/plans/2026-09-11-quiz-bedside-view.md`. Hide set (`src/edu/quiz-view.ts`, six keys,
`bedside` preset, `parseQuizHash`/`quizLink`), controller `quizHides`/`setQuizHide`/`lockQuiz`,
`settingsChangeLog` (confirmed commits, fixes, injector toggles), debrief builder (`src/edu/debrief.ts`:
change list, found/missed/extra, recommended fix key by key with matched/partial/not-done/opposite,
outcome, card physiology), `DebriefPanel` in the quiz result, Instructor panel "Quiz view" (checkboxes,
Bedside, Show all, copyable locked link), `QuizAttempt.debrief` summary. One constant, `QUIZ_FIX_BAND`
0.25 [M]; MODEL.md table regenerated; no snapshot change. Tests first: `quiz-view.test.ts` (round trip,
bedside, unknown keys, locked only with `?quiz=`), `debrief.test.ts` (change log, formatting, marks,
identification marks, missing evidence, card titles, injectors, no-fix scenario), `progress.test.ts`
(summary persists), `tests/e2e/quiz-bedside.spec.ts` (locked link hides everything, settings-panel fix,
debrief names the change, the pattern and the note, unlock on evaluate; plain hash unchanged; instructor
checkboxes and link). Vitest <n>/<n>, lint clean, Playwright 31/31, build clean.
```

Fill `<n>` from Step 1.

- [ ] **Step 5: HANDOFF**

- Header line: add "quiz bedside view + debrief (D-019)".
- "Read in this order" 4: `D-001…D-019`, add "D-019 the quiz bedside view".
- Table: Post-M9 row add "quiz bedside view + debrief (D-019)".
- Test counts line: update Vitest and Playwright numbers.
- Add to "Post-M9 as built":
  ```markdown
  - **Quiz bedside view + debrief (D-019)**: `src/edu/quiz-view.ts` (`QUIZ_HIDE_KEYS`, `parseQuizHash`,
    `quizLink`), `src/edu/debrief.ts` (`settingChangesFrom`, `injectorChange`, `fixMark`, `buildDebrief`),
    controller `view.quizHide`/`quizLocked`, `quizHides`, `setQuizHide`, `lockQuiz`, `settingsChangeLog`,
    `quizPicks`, `lastDebrief`; `App.tsx` reads `#<id>?quiz=` at load and on hashchange; props
    `TruthToggle.disabled`, `ScenarioPicker.disabled/mask`, `MonitorPanel.hideBalloonTiles`,
    `ExportPanel.hideTruth`; `src/ui/DebriefPanel.tsx`; Instructor panel `quizview-*` testids. Tests
    `tests/unit/{quiz-view,debrief}.test.ts`, `tests/e2e/quiz-bedside.spec.ts`.
  ```
- "What is left" 4: replace with "**Done** (D-019, this session)"; move the remaining optional ideas into 5 and add: "a light instructor review page for stored debrief summaries; hide the other case titles in the picker when `scenario` is hidden".
- Update the alias item 3 with the finding of this session (see the final report: Netlify's deploy key is missing on `github.com/nahata5/personal-website`; fix in the Netlify dashboard → Site configuration → Build & deploy → Link repository again, or add the site's deploy key under the repo's Settings → Deploy keys; `gh api repos/nahata5/personal-website/keys` returns `[]`).
- Rewrite the "Prompt for the next session" block for whatever remains.

- [ ] **Step 6: Commit and push**

```bash
git add README.md docs/DECISIONS.md PROGRESS.md docs/HANDOFF.md
git commit -m "docs: D-019 quiz bedside view + debrief, README quiz section, PROGRESS entry, handoff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DLxH7qsM5VLwiEQRDECPGs"
git push origin main
```

---

## Self-review

- **Spec coverage.** §1 hide set: Task 1 (keys, preset), Task 3 (`quizHides`, badges through the fix phase, no effect outside a quiz), Task 4 (each key's UI effect: truth → toggle/layer/badges/dashboard truth rows; pes → Pes row, ΔPes/ΔPaw tile, SpO2 shunt detail; scenario → "Case", summary, objectives, targets, apply-fix, best score in picker and quiz idle; derived → dashboard, Validation link, balloon tile; explain → tab, click, hover; co2 → panel + warp). §2 delivery: Task 5 (checkboxes, Bedside, copy link), Task 4 (`App.tsx` reads the hash, locks, opens the Quiz tab; start still gated on 20 s). §3 locking: Task 3 (`quizLocked`, unlock on evaluate/end, `setTruth` guard), Task 4 (no Instructor panel, picker disabled, truth toggle disabled, truth exports hidden). §4 grading unchanged: no change to `quiz.ts`/`quiz-session.ts`. §5 debrief: Task 2 (builder, all four sections, compact summary in progress), Task 3 (controller inputs: change log from `applySettings`/`applyFix`/`setInjector`, truth patterns from the identification, evidence from the cards, AI before/after, `DebriefPanel` in the result phase). §6 tests: Task 1, 2, 4, 5 (the "controller test" for `settingsChangeLog` is the pure `settingChangesFrom` unit test plus the e2e assertion that the log is empty after load and lists the PS change after the commit; the controller cannot be constructed under Vitest because `WorkerClient` creates a `Worker`). §7 docs: Task 6 (one constant added, so the MODEL.md table is regenerated in Task 2; no snapshot change).
- **Placeholders.** None; every step carries code. The one open lookup (the alarm-limit field name in `AlarmLimits`) is called out with the grep to resolve it.
- **Type consistency.** `quizHides(key: QuizHideKey)` (Tasks 3–5); `setQuizHide(Iterable<QuizHideKey>)` and `lockQuiz(Iterable<QuizHideKey>)` (Tasks 3–5); `settingsChangeLog: SettingChange[]` (Tasks 2–4); `buildDebrief(DebriefInput): Debrief` with `Debrief.summary: DebriefSummary` (Tasks 2–3); `DebriefPanel({ d: Debrief; checks: FixCheck[] })` (Task 3); `ScenarioPicker.disabled/mask`, `TruthToggle.disabled`, `MonitorPanel.hideBalloonTiles`, `ExportPanel.hideTruth` (Task 4).
