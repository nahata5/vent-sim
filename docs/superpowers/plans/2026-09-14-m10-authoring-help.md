# M10 — Scenario authoring, custom scenarios, help overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner can paste a scenario JSON their own LLM produced from VentSim's authoring prompt, see precise validation errors, save it into a persisted "My scenarios" list, run it, and read a how-to-use dialog.

**Architecture:** A schema module validates raw JSON against the code's own enumerations and a shared settings-bounds table; the authoring prompt and `docs/SCENARIO_AUTHORING.md` are generated from the same module so they cannot drift. A `CustomScenarioStore` mirrors `ProgressStore` (guarded localStorage). The controller, picker and hash router resolve ids through one lookup that checks the shipped library then the store. A native `<dialog>` holds the help text.

**Tech Stack:** TypeScript, Preact, Vite, Vitest (`npm test`), Playwright (`npm run test:e2e`), ESLint (`npm run lint`). Path aliases in tests: `@/` → `src/`, `@sim/` → `src/sim/`.

**Spec:** `docs/superpowers/specs/2026-09-14-modes-authoring-help-design.md` §5, §6, §7 (M10 parts).

## Global Constraints

- Tests first for anything in `src/edu`; run the single test file, then the full `npm test` before each commit.
- No magic numbers in physics/detector; this milestone adds none (the bounds table moves existing numbers).
- Every storage access goes through the guarded `KeyValueStorage` pattern in `src/edu/progress.ts`.
- `data-testid` names exactly as written here; Playwright specs rely on them.
- Commit per task; message prefix `feat(edu):`, `feat(ui):`, `docs:`; end every commit message with the two attribution lines given in the session (Co-Authored-By and Claude-Session).
- Keep `theme.css` responsive blocks at the end of the file; add new base rules before them.
- The shipped library stays `SCENARIOS`; custom scenarios never enter it.

---

### Task 1: Shared settings bounds table

**Files:**
- Modify: `src/sim/vent/settings.ts` (add `SETTING_BOUNDS`, make `clampSettings` use it)
- Test: `tests/unit/ventilator.test.ts` (append one test)

**Interfaces:**
- Produces: `export type NumericSettingKey`, `export const SETTING_BOUNDS: Record<NumericSettingKey, { min: number; max: number; unit: string }>`.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/ventilator.test.ts`)

```ts
import { SETTING_BOUNDS, clampSettings, defaultSettings } from '@sim/vent/settings';

describe('setting bounds table', () => {
  it('clampSettings clamps every numeric key to SETTING_BOUNDS', () => {
    const s = defaultSettings();
    for (const key of Object.keys(SETTING_BOUNDS) as Array<keyof typeof SETTING_BOUNDS>) {
      const b = SETTING_BOUNDS[key];
      expect(clampSettings({ ...s, [key]: b.max + 1000 })[key], key).toBe(b.max);
      expect(clampSettings({ ...s, [key]: b.min - 1000 })[key], key).toBe(b.min);
    }
    expect(SETTING_BOUNDS.vt).toEqual({ min: 100, max: 1200, unit: 'mL' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/ventilator.test.ts -t "setting bounds"`
Expected: FAIL, `SETTING_BOUNDS` is not exported.

- [ ] **Step 3: Implement** — in `src/sim/vent/settings.ts`, above `clampSettings`:

```ts
export type NumericSettingKey =
  | 'peep' | 'fio2' | 'flowTrigger' | 'pressureTrigger' | 'biasFlow' | 'vt' | 'rr' | 'peakFlow'
  | 'rampEndFraction' | 'pause' | 'pinsp' | 'ti' | 'riseTime' | 'ps' | 'ets' | 'tiMax' | 'apneaTime' | 'refractory';

/** Model bounds of Brief 1 §5 and sane device ranges; one table for the clamp, the settings UI and the scenario validator. */
export const SETTING_BOUNDS: Record<NumericSettingKey, { min: number; max: number; unit: string }> = {
  peep: { min: 0, max: 25, unit: 'cmH2O' },
  fio2: { min: 0.21, max: 1, unit: 'fraction' },
  flowTrigger: { min: 0.5, max: 10, unit: 'L/min' },
  pressureTrigger: { min: 0.5, max: 5, unit: 'cmH2O' },
  biasFlow: { min: 2, max: 10, unit: 'L/min' },
  vt: { min: 100, max: 1200, unit: 'mL' },
  rr: { min: 4, max: 60, unit: '/min' },
  peakFlow: { min: 10, max: 120, unit: 'L/min' },
  rampEndFraction: { min: 0, max: 0.9, unit: 'fraction of peak' },
  pause: { min: 0, max: 2, unit: 's' },
  pinsp: { min: 0, max: 40, unit: 'cmH2O above PEEP' },
  ti: { min: 0.2, max: 3, unit: 's' },
  riseTime: { min: 0, max: 0.4, unit: 's' },
  ps: { min: 0, max: 40, unit: 'cmH2O above PEEP' },
  ets: { min: 0.05, max: 0.8, unit: 'fraction of peak flow' },
  tiMax: { min: 0.5, max: 4, unit: 's' },
  apneaTime: { min: 5, max: 60, unit: 's' },
  refractory: { min: 0, max: 0.5, unit: 's' },
};

export function clampSettings(s: VentSettings): VentSettings {
  const out: VentSettings = { ...s };
  for (const key of Object.keys(SETTING_BOUNDS) as NumericSettingKey[]) {
    const b = SETTING_BOUNDS[key];
    out[key] = clamp(s[key], b.min, b.max);
  }
  out.deviceRate = [50, 100, 200].includes(s.deviceRate) ? s.deviceRate : 100;
  return out;
}
```

Delete the old body of `clampSettings` (the literal clamps).

- [ ] **Step 4: Run the file, then the full suite**

Run: `npx vitest run tests/unit/ventilator.test.ts` then `npm test`
Expected: all pass (217 + 1).

- [ ] **Step 5: Commit**

```bash
git add src/sim/vent/settings.ts tests/unit/ventilator.test.ts
git commit -m "feat(vent): SETTING_BOUNDS table shared by the clamp, UI and validator"
```

---

### Task 2: Scenario validator

**Files:**
- Create: `src/edu/scenario-schema.ts`
- Modify: `src/edu/scenarios/index.ts` (add `'mode'` to `ScenarioCategory`; export `SCENARIO_CATEGORIES`)
- Modify: `src/ui/ScenarioPicker.tsx:15-20` (`CATEGORY_LABEL.mode = 'SIMV, PRVC and APRV'`)
- Test: `tests/unit/scenario-schema.test.ts`

**Interfaces:**
- Consumes: `SETTING_BOUNDS`, `defaultSettings` (Task 1); `PHENOTYPE_IDS` (`src/sim/patient/presets.ts`); `IMPLEMENTED_MODES` (`src/sim/types.ts`); `INJECTOR_KINDS`; `PATTERN_IDS`; `QUIZ_EXTRA_METRICS`.
- Produces: `export interface ScenarioValidation { def: ScenarioDef | null; errors: string[]; warnings: string[] }`, `export function validateScenario(raw: unknown): ScenarioValidation`, `export function parseScenarioText(text: string): ScenarioValidation`, `export const SCENARIO_CATEGORIES`, `export const CRITERIA_EXTRA_METRICS = ['peepiTrue'] as const`, `export const SCENARIO_TOP_KEYS`, `export const DRIVE_BOUNDS`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/scenario-schema.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseScenarioText, validateScenario } from '@/edu/scenario-schema';
import { SCENARIOS } from '@/edu/scenarios';

const good = {
  id: 'my-case',
  title: 'My case',
  phenotype: 'copd',
  drive: { rate: 20, ti: 0.9, pmax: 6 },
  settings: { mode: 'PSV', ps: 14, ets: 0.1 },
  targetPatterns: ['ineffective-effort'],
  fix: { at: 60, note: 'ETS up', settings: { ets: 0.5 } },
  criteria: { minFraction: 0.2, aiAfter: 10 },
};

describe('validateScenario', () => {
  it('accepts a minimal scenario and fills the defaults', () => {
    const r = validateScenario(good);
    expect(r.errors).toEqual([]);
    expect(r.def?.order).toBe(999);
    expect(r.def?.category).toBe('dyssynchrony');
    expect(r.def?.objectives).toEqual([]);
    expect(r.def?.seed).toBe(1);
  });

  it('accepts every shipped scenario without errors or warnings', () => {
    for (const s of SCENARIOS) {
      const r = validateScenario(JSON.parse(JSON.stringify(s)));
      expect(r.errors, s.id).toEqual([]);
      expect(r.warnings, s.id).toEqual([]);
    }
  });

  it('reports each problem by field name', () => {
    const r = validateScenario({
      ...good,
      id: 'Bad Id!',
      phenotype: 'martian',
      settings: { mode: 'NAVA', vt: 5000 },
      targetPatterns: ['ineffective-effort', 'nonsense'],
      injectors: { leak: { k: 0.02 }, magic: {} },
      quizExtras: [{ metric: 'pao2', max: 1 }],
      criteria: { minFraction: 3, aiAfter: 10 },
    });
    expect(r.def).toBeNull();
    expect(r.errors.join('\n')).toMatch(/"id"/);
    expect(r.errors.join('\n')).toMatch(/"phenotype".*martian/);
    expect(r.errors.join('\n')).toMatch(/settings\.mode/);
    expect(r.errors.join('\n')).toMatch(/settings\.vt.*1200/);
    expect(r.errors.join('\n')).toMatch(/targetPatterns.*nonsense/);
    expect(r.errors.join('\n')).toMatch(/injectors\.magic/);
    expect(r.errors.join('\n')).toMatch(/quizExtras\[0\]\.metric/);
    expect(r.errors.join('\n')).toMatch(/criteria\.minFraction/);
  });

  it('warns about unknown keys but still returns a definition', () => {
    const r = validateScenario({ ...good, colour: 'blue', settings: { mode: 'PSV', psv: 10 } });
    expect(r.def).not.toBeNull();
    expect(r.warnings).toEqual(['unknown key "colour" (ignored)', 'unknown key settings.psv (ignored)']);
  });

  it('validates the fix block, drive ranges and the recoil spec', () => {
    const r = validateScenario({
      ...good,
      drive: { rate: 200 },
      mechanics: { recoil: 'linear' },
      fix: { at: -1, note: 3, settings: { peep: 99 }, injectors: { leak: null, foo: {} } },
    });
    const text = r.errors.join('\n');
    expect(text).toMatch(/drive\.rate/);
    expect(text).toMatch(/mechanics\.recoil/);
    expect(text).toMatch(/fix\.at/);
    expect(text).toMatch(/fix\.note/);
    expect(text).toMatch(/fix\.settings\.peep/);
    expect(text).toMatch(/fix\.injectors\.foo/);
  });

  it('parseScenarioText reports JSON syntax errors as the only error', () => {
    const r = parseScenarioText('{ not json');
    expect(r.def).toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/JSON/);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/scenario-schema.test.ts`
Expected: FAIL, cannot resolve `@/edu/scenario-schema`.

- [ ] **Step 3: Add the category** — in `src/edu/scenarios/index.ts` replace the `ScenarioCategory` line with:

```ts
export const SCENARIO_CATEGORIES = ['preset', 'dyssynchrony', 'injector', 'capstone', 'mode'] as const;
export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];
```

In `src/ui/ScenarioPicker.tsx` add `mode: 'SIMV, PRVC and APRV',` to `CATEGORY_LABEL`.

- [ ] **Step 4: Implement** — `src/edu/scenario-schema.ts`

```ts
/**
 * Scenario JSON validation (Spec 2026-09-14 §5.1). Checks a pasted definition against the code's own
 * enumerations and the shared settings bounds, and returns every problem by field name. The authoring
 * prompt (authoring.ts) is generated from the same tables, so the two cannot drift.
 */
import { PHENOTYPE_IDS } from '../sim/patient/presets';
import { IMPLEMENTED_MODES } from '../sim/types';
import { INJECTOR_KINDS } from '../sim/injectors';
import { PATTERN_IDS } from '../sim/truth/labeler';
import { SETTING_BOUNDS, defaultSettings, type NumericSettingKey } from '../sim/vent/settings';
import { QUIZ_EXTRA_METRICS } from './quiz';
import { SCENARIO_CATEGORIES, type ScenarioDef } from './scenarios';

export interface ScenarioValidation {
  def: ScenarioDef | null;
  errors: string[];
  warnings: string[];
}

export const SCENARIO_TOP_KEYS = [
  'id', 'order', 'category', 'title', 'summary', 'phenotype', 'mechanics', 'drive', 'balloon', 'gas',
  'injectors', 'settings', 'seed', 'objectives', 'targetPatterns', 'fix', 'criteria', 'quizExtras', 'shunt',
] as const;
export const CRITERIA_EXTRA_METRICS = ['peepiTrue'] as const;
export const DRIVE_BOUNDS = {
  rate: { min: 4, max: 60, unit: '/min' },
  ti: { min: 0.3, max: 3, unit: 's' },
  pmax: { min: 0, max: 40, unit: 'cmH2O' },
  cvRate: { min: 0, max: 0.5, unit: 'fraction' },
  cvTi: { min: 0, max: 0.5, unit: 'fraction' },
  cvPmax: { min: 0, max: 0.5, unit: 'fraction' },
} as const;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SETTINGS_KEYS = new Set(Object.keys(defaultSettings()));
const ALARM_KEYS = new Set(Object.keys(defaultSettings().alarms));
const ENUM_KEYS: Record<string, readonly string[]> = {
  triggerType: ['flow', 'pressure'],
  flowPattern: ['square', 'ramp'],
  vcTiming: ['peakFlow', 'ti'],
};
const BOOL_KEYS = new Set(['leakCompensation', 'ideal', 'esophagealBalloon']);

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const list = (xs: readonly string[]) => xs.map((x) => `"${x}"`).join(', ');

function checkSettings(s: unknown, path: string, requireMode: boolean, errors: string[], warnings: string[]): void {
  if (!isRec(s)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (requireMode && typeof s.mode !== 'string') errors.push(`${path}.mode is required`);
  if (s.mode !== undefined && !(IMPLEMENTED_MODES as readonly string[]).includes(String(s.mode))) errors.push(`${path}.mode must be one of ${list(IMPLEMENTED_MODES)}`);
  for (const [key, v] of Object.entries(s)) {
    if (key === 'mode') continue;
    if (key === 'alarms') {
      if (!isRec(v)) errors.push(`${path}.alarms must be an object`);
      else for (const [ak, av] of Object.entries(v)) {
        if (!ALARM_KEYS.has(ak)) warnings.push(`unknown key ${path}.alarms.${ak} (ignored)`);
        else if (typeof av !== 'number' || !Number.isFinite(av)) errors.push(`${path}.alarms.${ak} must be a number`);
      }
      continue;
    }
    if (!SETTINGS_KEYS.has(key)) {
      warnings.push(`unknown key ${path}.${key} (ignored)`);
      continue;
    }
    if (key in SETTING_BOUNDS) {
      const b = SETTING_BOUNDS[key as NumericSettingKey];
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${path}.${key} must be a number (${b.unit})`);
      else if (v < b.min || v > b.max) errors.push(`${path}.${key} = ${v} is outside ${b.min}–${b.max} ${b.unit}`);
    } else if (key in ENUM_KEYS) {
      if (!ENUM_KEYS[key]!.includes(String(v))) errors.push(`${path}.${key} must be one of ${list(ENUM_KEYS[key]!)}`);
    } else if (BOOL_KEYS.has(key)) {
      if (typeof v !== 'boolean') errors.push(`${path}.${key} must be true or false`);
    } else if (key === 'deviceRate') {
      if (![50, 100, 200].includes(Number(v))) errors.push(`${path}.deviceRate must be 50, 100 or 200`);
    } else if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${path}.${key} must be a number`);
  }
}

function checkDrive(d: unknown, path: string, errors: string[]): void {
  if (d === null) return;
  if (!isRec(d)) {
    errors.push(`${path} must be null (passive patient) or an object`);
    return;
  }
  for (const [key, b] of Object.entries(DRIVE_BOUNDS)) {
    const v = d[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${path}.${key} must be a number (${b.unit})`);
    else if (v < b.min || v > b.max) errors.push(`${path}.${key} = ${v} is outside ${b.min}–${b.max} ${b.unit}`);
  }
  if (d.entrainment !== undefined && d.entrainment !== null) {
    if (!isRec(d.entrainment) || ![1, 2, 3].includes(Number(d.entrainment.ratio))) errors.push(`${path}.entrainment must be null or { "ratio": 1 | 2 | 3, "delay": s, "jitter": s }`);
  }
}

function checkInjectors(inj: unknown, path: string, allowNull: boolean, errors: string[]): void {
  if (!isRec(inj)) {
    errors.push(`${path} must be an object keyed by injector kind`);
    return;
  }
  for (const [key, v] of Object.entries(inj)) {
    if (!(INJECTOR_KINDS as readonly string[]).includes(key)) errors.push(`${path}.${key} is not an injector; use ${list(INJECTOR_KINDS)}`);
    else if (v === null && !allowNull) errors.push(`${path}.${key} must be an object of parameters (null is only allowed inside "fix")`);
    else if (v !== null && !isRec(v)) errors.push(`${path}.${key} must be an object of parameters`);
    else if (isRec(v) && v.at !== undefined && (typeof v.at !== 'number' || v.at < 0)) errors.push(`${path}.${key}.at must be seconds ≥ 0`);
  }
}

export function validateScenario(raw: unknown): ScenarioValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRec(raw)) return { def: null, errors: ['the scenario must be a JSON object'], warnings };
  const r = raw;
  for (const key of Object.keys(r)) if (!(SCENARIO_TOP_KEYS as readonly string[]).includes(key)) warnings.push(`unknown key "${key}" (ignored)`);
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) errors.push('"id" must be a slug of 2–64 lowercase letters, digits and dashes, e.g. "copd-simv-low-ps"');
  if (typeof r.title !== 'string' || r.title.trim().length < 3) errors.push('"title" must be a string of at least 3 characters');
  if (r.summary !== undefined && typeof r.summary !== 'string') errors.push('"summary" must be a string');
  if (typeof r.phenotype !== 'string' || !(PHENOTYPE_IDS as readonly string[]).includes(r.phenotype)) errors.push(`"phenotype" must be one of ${list(PHENOTYPE_IDS)} (got ${JSON.stringify(r.phenotype)})`);
  if (r.category !== undefined && !(SCENARIO_CATEGORIES as readonly string[]).includes(String(r.category))) errors.push(`"category" must be one of ${list(SCENARIO_CATEGORIES)}`);
  if (r.order !== undefined && typeof r.order !== 'number') errors.push('"order" must be a number');
  if (r.seed !== undefined && typeof r.seed !== 'number' && typeof r.seed !== 'string') errors.push('"seed" must be a number or a string');
  if (r.shunt !== undefined && (typeof r.shunt !== 'number' || r.shunt < 0 || r.shunt > 1)) errors.push('"shunt" must be a fraction 0–1');
  if (r.settings === undefined) errors.push('"settings" is required (at least { "mode": … })');
  else checkSettings(r.settings, 'settings', true, errors, warnings);
  if (r.drive === undefined) warnings.push('"drive" missing: the patient will be passive (null)');
  else checkDrive(r.drive, 'drive', errors);
  if (r.mechanics !== undefined) {
    if (!isRec(r.mechanics)) errors.push('"mechanics" must be an object');
    else {
      const rec = r.mechanics.recoil;
      if (rec !== undefined && rec !== 'recruitable' && !(isRec(rec) && rec.kind === 'recruitable')) errors.push('mechanics.recoil must be "recruitable" or { "kind": "recruitable", …overrides }');
      for (const [key, v] of Object.entries(r.mechanics)) if (key !== 'recoil' && typeof v !== 'number') errors.push(`mechanics.${key} must be a number`);
    }
  }
  if (r.balloon !== undefined && !isRec(r.balloon)) errors.push('"balloon" must be an object, e.g. { "enabled": true }');
  if (r.gas !== undefined && !isRec(r.gas)) errors.push('"gas" must be an object of CO2-loop parameters');
  if (r.injectors !== undefined) checkInjectors(r.injectors, 'injectors', false, errors);
  if (r.objectives !== undefined && !(Array.isArray(r.objectives) && r.objectives.every((x) => typeof x === 'string'))) errors.push('"objectives" must be an array of strings');
  if (r.targetPatterns !== undefined) {
    if (!Array.isArray(r.targetPatterns)) errors.push('"targetPatterns" must be an array');
    else for (const p of r.targetPatterns) if (!(PATTERN_IDS as readonly string[]).includes(String(p))) errors.push(`targetPatterns contains "${String(p)}"; use ${list(PATTERN_IDS)}`);
  }
  if (r.fix !== undefined) {
    if (!isRec(r.fix)) errors.push('"fix" must be an object');
    else {
      if (typeof r.fix.at !== 'number' || r.fix.at < 0) errors.push('fix.at must be seconds ≥ 0');
      if (typeof r.fix.note !== 'string') errors.push('fix.note must be a string');
      if (r.fix.settings !== undefined) checkSettings(r.fix.settings, 'fix.settings', false, errors, warnings);
      if (r.fix.drive !== undefined) checkDrive(r.fix.drive, 'fix.drive', errors);
      if (r.fix.injectors !== undefined) checkInjectors(r.fix.injectors, 'fix.injectors', true, errors);
    }
  }
  if (r.criteria !== undefined) {
    if (!isRec(r.criteria)) errors.push('"criteria" must be an object');
    else {
      const c = r.criteria;
      if (typeof c.minFraction !== 'number' || c.minFraction < 0 || c.minFraction > 1) errors.push('criteria.minFraction must be a fraction 0–1');
      if (typeof c.aiAfter !== 'number' || c.aiAfter < 0 || c.aiAfter > 100) errors.push('criteria.aiAfter must be a percentage 0–100');
      if (c.extra !== undefined) {
        if (!Array.isArray(c.extra)) errors.push('criteria.extra must be an array');
        else c.extra.forEach((e, i) => {
          if (!isRec(e) || !(CRITERIA_EXTRA_METRICS as readonly string[]).includes(String(e.metric)) || typeof e.max !== 'number') errors.push(`criteria.extra[${i}] must be { "metric": ${list(CRITERIA_EXTRA_METRICS)}, "max": number }`);
        });
      }
    }
  }
  if (r.quizExtras !== undefined) {
    if (!Array.isArray(r.quizExtras)) errors.push('"quizExtras" must be an array');
    else r.quizExtras.forEach((q, i) => {
      if (!isRec(q)) errors.push(`quizExtras[${i}] must be an object`);
      else {
        if (!(QUIZ_EXTRA_METRICS as readonly string[]).includes(String(q.metric))) errors.push(`quizExtras[${i}].metric must be one of ${list(QUIZ_EXTRA_METRICS)}`);
        if (q.min === undefined && q.max === undefined) errors.push(`quizExtras[${i}] needs "min" and/or "max"`);
        if (q.min !== undefined && typeof q.min !== 'number') errors.push(`quizExtras[${i}].min must be a number`);
        if (q.max !== undefined && typeof q.max !== 'number') errors.push(`quizExtras[${i}].max must be a number`);
      }
    });
  }
  if (errors.length > 0) return { def: null, errors, warnings };
  const defaults = { order: 999, category: 'dyssynchrony', summary: '', drive: null, seed: 1, objectives: [], targetPatterns: [] };
  return { def: { ...defaults, ...r } as ScenarioDef, errors, warnings };
}

/** JSON text → validation; a syntax error is reported as the single error. */
export function parseScenarioText(text: string): ScenarioValidation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { def: null, errors: [`not valid JSON: ${(e as Error).message}`], warnings: [] };
  }
  return validateScenario(raw);
}
```

Note on the shipped-library test: `normal-passive.json` and the other presets carry `"drive": null` explicitly, so the "drive missing" warning does not fire on them. If a shipped file lacks `drive`, add `"drive": null` to that file (the field is required by `ScenarioDef`).

- [ ] **Step 5: Run the file, then the full suite and lint**

Run: `npx vitest run tests/unit/scenario-schema.test.ts && npm test && npm run lint`
Expected: pass. If the "shipped scenarios" test warns about an unknown key, that key is a real typo in a scenario file — fix the file, not the validator.

- [ ] **Step 6: Commit**

```bash
git add src/edu/scenario-schema.ts src/edu/scenarios/index.ts src/ui/ScenarioPicker.tsx tests/unit/scenario-schema.test.ts
git commit -m "feat(edu): scenario validator with field-level errors and warnings"
```

---

### Task 3: Authoring prompt, worked example, generated document

**Files:**
- Create: `src/edu/authoring.ts`, `scripts/authoring-doc.ts`, `docs/SCENARIO_AUTHORING.md` (generated)
- Modify: `package.json` scripts (add `"docs:authoring": "tsx scripts/authoring-doc.ts"`)
- Test: `tests/unit/authoring.test.ts`

**Interfaces:**
- Consumes: `validateScenario`, `SCENARIO_TOP_KEYS`, `DRIVE_BOUNDS`, `CRITERIA_EXTRA_METRICS` (Task 2); `SETTING_BOUNDS` (Task 1); the enumerations.
- Produces: `export const EXAMPLE_SCENARIO: ScenarioDef`, `export const AUTHORING_PROMPT: string`, `export function authoringDocument(): string`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/authoring.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { AUTHORING_PROMPT, EXAMPLE_SCENARIO, authoringDocument } from '@/edu/authoring';
import { validateScenario } from '@/edu/scenario-schema';
import { SCENARIOS, resolveScenario } from '@/edu/scenarios';
import { runHeadless } from '@sim/headless';
import { PHENOTYPE_IDS } from '@sim/patient/presets';
import { PATTERN_IDS } from '@sim/truth/labeler';
import { INJECTOR_KINDS } from '@sim/injectors';
import { IMPLEMENTED_MODES } from '@sim/types';

describe('authoring prompt', () => {
  it('the worked example validates cleanly, is not a shipped scenario and runs', () => {
    const r = validateScenario(JSON.parse(JSON.stringify(EXAMPLE_SCENARIO)));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(SCENARIOS.some((s) => s.id === EXAMPLE_SCENARIO.id)).toBe(false);
    const res = runHeadless({ ...resolveScenario(EXAMPLE_SCENARIO), duration: 8 });
    expect(res.breaths.length).toBeGreaterThan(2);
  });

  it('lists every enumeration and bound the validator enforces, and embeds the example verbatim', () => {
    for (const p of PHENOTYPE_IDS) expect(AUTHORING_PROMPT).toContain(`"${p}"`);
    for (const p of PATTERN_IDS) expect(AUTHORING_PROMPT).toContain(`"${p}"`);
    for (const k of INJECTOR_KINDS) expect(AUTHORING_PROMPT).toContain(`"${k}"`);
    for (const m of IMPLEMENTED_MODES) expect(AUTHORING_PROMPT).toContain(`"${m}"`);
    expect(AUTHORING_PROMPT).toContain('vt: 100–1200 mL');
    expect(AUTHORING_PROMPT).toContain(JSON.stringify(EXAMPLE_SCENARIO, null, 2));
    expect(AUTHORING_PROMPT).toMatch(/interview/i);
    expect(AUTHORING_PROMPT).toMatch(/output (only )?one JSON object/i);
  });

  it('the generated document contains the prompt inside a fenced block', () => {
    const doc = authoringDocument();
    expect(doc.startsWith('# Writing your own VentSim scenario')).toBe(true);
    expect(doc).toContain('```text\n' + AUTHORING_PROMPT + '\n```');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/authoring.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `src/edu/authoring.ts`

```ts
/**
 * Scenario authoring through the reader's own LLM (Spec 2026-09-14 §5.2). The prompt is generated from the
 * same enumerations and bounds the validator uses, so it cannot drift from what the app accepts; the
 * worked example is validated by a test and is not in the shipped library.
 */
import { PHENOTYPE_IDS, PRESETS } from '../sim/patient/presets';
import { IMPLEMENTED_MODES } from '../sim/types';
import { INJECTOR_KINDS, defaultInjectorParams } from '../sim/injectors';
import { PATTERN_IDS } from '../sim/truth/labeler';
import { SETTING_BOUNDS, defaultSettings, type NumericSettingKey } from '../sim/vent/settings';
import { QUIZ_EXTRA_METRICS } from './quiz';
import { CRITERIA_EXTRA_METRICS, DRIVE_BOUNDS, SCENARIO_TOP_KEYS } from './scenario-schema';
import { SCENARIO_CATEGORIES, type ScenarioDef } from './scenarios';

export const EXAMPLE_SCENARIO: ScenarioDef = {
  id: 'example-obesity-pc-short-ti',
  order: 999,
  category: 'dyssynchrony',
  title: 'Example: obese patient on PC-AC with a short Ti',
  summary: 'An obese post-operative patient with a strong drive is on PC-AC with Ti 0.6 s. The neural inspiration lasts twice as long, so the effort continues after cycle-off and re-triggers a second breath: double triggering with stacked volumes.',
  phenotype: 'obesity',
  drive: { rate: 20, ti: 1.2, pmax: 10, cvRate: 0.08, cvTi: 0.08, cvPmax: 0.1 },
  balloon: { enabled: true },
  settings: { mode: 'PC-AC', peep: 8, pinsp: 12, ti: 0.6, rr: 14, riseTime: 0.1, flowTrigger: 2 },
  seed: 7,
  objectives: [
    'Recognize double triggering: two machine breaths inside one effort, with the second starting from an incomplete exhalation.',
    'Fix by matching the set Ti to the neural Ti; confirm the stacking stops without raising the driving pressure.',
  ],
  targetPatterns: ['double-trigger'],
  fix: { at: 60, note: 'Ti 1.1 s: the breath now spans the effort.', settings: { ti: 1.1 } },
  criteria: { minFraction: 0.2, aiAfter: 10 },
  quizExtras: [{ metric: 'plEE', min: 0, label: 'End-expiratory PL ≥ 0 (obesity)' }],
};

const MODE_NOTES: Record<string, string> = {
  'VC-AC': 'volume control, assist-control: vt, rr, peakFlow or ti (vcTiming), flowPattern, pause',
  'PC-AC': 'pressure control, assist-control: pinsp (above PEEP), ti, rr, riseTime',
  PSV: 'pressure support: ps (above PEEP), ets (cycle-off fraction), tiMax, riseTime',
  CPAP: 'CPAP: peep only (ps 0)',
  SIMV: 'SIMV: simvBase "VC" or "PC" for the mandatory breaths (their VC/PC settings and rr) plus ps/ets for spontaneous breaths',
  PRVC: 'pressure-regulated volume control: vt (target), rr, ti, riseTime; the pressure adapts breath by breath',
  APRV: 'airway pressure release: phigh, plow, thigh, tlow, tlowMode "fixed" or "pefr", tlowPefr',
};

const quote = (xs: readonly string[]) => xs.map((x) => `"${x}"`).join(', ');

function settingsLines(): string {
  const d = defaultSettings();
  return (Object.keys(SETTING_BOUNDS) as NumericSettingKey[])
    .map((key) => `  ${key}: ${SETTING_BOUNDS[key].min}–${SETTING_BOUNDS[key].max} ${SETTING_BOUNDS[key].unit} (default ${d[key]})`)
    .join('\n');
}

function injectorLines(): string {
  return INJECTOR_KINDS.map((k) => `  "${k}": defaults ${JSON.stringify(defaultInjectorParams(k))}`).join('\n');
}

function phenotypeLines(): string {
  return PHENOTYPE_IDS.map((p) => `  "${p}": ${PRESETS[p].label}`).join('\n');
}

export const AUTHORING_PROMPT = `You are helping a clinician write a teaching scenario for VentSim, a browser ventilator simulator in which
patient–ventilator dyssynchrony emerges from a physiologic model. Your job: interview the author about the case they
want, then output ONE JSON object in the format below and nothing else (no comments, no prose, no code fence).

INTERVIEW FIRST. Ask one question at a time and only for what is still missing:
1. The patient: which phenotype (list below), and any mechanics tweak (e.g. stiffer chest wall).
2. The respiratory drive: passive (null) or active — neural rate, neural Ti, Pmax (effort strength), variability.
3. The ventilator mode and settings that create the problem.
4. What should go wrong: which patterns from the list should appear, and roughly how often.
5. What the learner should notice on the waveforms and what they should do.
6. The fix, as concrete setting/drive/injector changes applied at a given simulated second.
7. Success criteria: the minimum fraction of breaths (or efforts) carrying each target pattern before the fix, and the asynchrony-index limit (%) after it (10 is the usual "severe" threshold).
8. One or two learning objectives; optional quiz extras (truth-metric checks the fix must satisfy).
Summarize the case back in two sentences, get a yes, then output the JSON.

FORMAT (top-level keys, all others are ignored): ${quote(SCENARIO_TOP_KEYS)}
  id: slug, 2–64 lowercase letters/digits/dashes, must be unique
  title: short string; summary: one paragraph shown to the learner
  category: one of ${quote(SCENARIO_CATEGORIES)} (default "dyssynchrony"); order: number for sorting (default 999)
  phenotype (required): one of
${phenotypeLines()}
  mechanics (optional): numeric overrides of the phenotype (el, ecw, rInsp, rExp, rCentral, frc, pplOffset, pbw, …), and
    recoil: "recruitable" for a recruitable-population lung (ARDS PEEP-response teaching) or { "kind": "recruitable", …overrides }
  drive (required; null = passive patient): { rate, ti, pmax, cvRate, cvTi, cvPmax, entrainment }
${Object.entries(DRIVE_BOUNDS).map(([k, b]) => `    ${k}: ${b.min}–${b.max} ${b.unit}`).join('\n')}
    entrainment: null or { "ratio": 1|2|3, "delay": s, "jitter": s } (reverse triggering in deep sedation)
  balloon (optional): { "enabled": true } to turn on the esophageal balloon (Pes, transpulmonary pressure)
  gas (optional): CO2 → drive loop, e.g. { "warp": 10, "gainPmax": 0.06, "vco2": 200 }; omit for a fixed drive
  shunt (optional): base venous admixture 0–1 for the schematic SpO2 (default ≈ 0.05)
  injectors (optional): object keyed by injector kind; each value is a parameter object, optionally with "at": seconds of onset
${injectorLines()}
  settings (required): { "mode": one of ${quote(IMPLEMENTED_MODES)}, …numbers }. Unspecified settings take the mode defaults. Alarms merge into defaults.
${IMPLEMENTED_MODES.map((m) => `    "${m}": ${MODE_NOTES[m] ?? ''}`).join('\n')}
    numeric settings and bounds:
${settingsLines()}
    other: triggerType "flow"|"pressure", vcTiming "peakFlow"|"ti", flowPattern "square"|"ramp", leakCompensation true|false,
      alarms { highPpeak, lowVte, highVe, lowVe, highRR, lowPeep, highLeak, highPeepi }
  seed: integer or string (reproducible variability)
  objectives: array of strings
  targetPatterns: array of pattern ids the learner must find, from
    ${quote(PATTERN_IDS)}
  fix: { "at": seconds, "note": string, "settings": {…partial settings}, "drive": {…partial drive}, "injectors": { "<kind>": {…} or null to remove } }
  criteria: { "minFraction": 0–1, "aiAfter": 0–100, "extra": [ { "metric": ${quote(CRITERIA_EXTRA_METRICS)}, "max": number } ] }
  quizExtras: array of { "metric": one of ${quote(QUIZ_EXTRA_METRICS)}, "min"?: number, "max"?: number, "label"?: string }

UNITS: pressures cmH2O, volumes mL (settings) or L (mechanics), flows L/min (settings), times s, rates /min.

EXAMPLE (a complete, valid scenario):
${JSON.stringify(EXAMPLE_SCENARIO, null, 2)}

RULES: output only one JSON object; do not invent keys; keep every number inside its bounds; make the problem emerge
from the physiology and settings (do not describe waveforms in the JSON); the fix must be something a learner can do at
the bedside in this simulator.`;

/** docs/SCENARIO_AUTHORING.md, generated by scripts/authoring-doc.ts. */
export function authoringDocument(): string {
  return [
    '# Writing your own VentSim scenario',
    '',
    'Generated from `src/edu/authoring.ts` by `npm run docs:authoring`; do not edit by hand.',
    '',
    'VentSim scenarios are JSON. You do not have to write the JSON yourself: copy the prompt below into your own LLM',
    '(the **Copy authoring prompt** button in the Instructor panel does the same), answer its questions about the case',
    'you want, paste the JSON it returns into the Instructor panel\'s scenario editor, press **Validate**, then **Save**.',
    'Saved scenarios live in your browser under "My scenarios" in the scenario picker and work with quiz links.',
    '',
    '## The prompt',
    '',
    '```text',
    AUTHORING_PROMPT,
    '```',
    '',
    '## Validation',
    '',
    'The editor checks ids, enumerations (phenotype, mode, injector kinds, pattern ids, quiz metrics) and every numeric',
    'bound listed in the prompt, and reports each problem by field name. Unknown keys are ignored with a warning.',
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Generator script** — `scripts/authoring-doc.ts`

```ts
/**
 * Regenerate docs/SCENARIO_AUTHORING.md from src/edu/authoring.ts.
 *   npx tsx scripts/authoring-doc.ts
 */
import { writeFileSync } from 'node:fs';
import { authoringDocument } from '../src/edu/authoring';

writeFileSync('docs/SCENARIO_AUTHORING.md', authoringDocument());
console.log('wrote docs/SCENARIO_AUTHORING.md');
```

Add to `package.json` scripts: `"docs:authoring": "tsx scripts/authoring-doc.ts"`. Run `npm run docs:authoring`.

- [ ] **Step 5: Run tests, lint, and check the document**

Run: `npx vitest run tests/unit/authoring.test.ts && npm test && npm run lint && head -20 docs/SCENARIO_AUTHORING.md`
Expected: pass; the document starts with the heading. If the example does not produce breaths, lower `pinsp`/`ti` are wrong — check `resolveScenario` errors, not the test.

- [ ] **Step 6: Commit**

```bash
git add src/edu/authoring.ts scripts/authoring-doc.ts docs/SCENARIO_AUTHORING.md package.json tests/unit/authoring.test.ts
git commit -m "feat(edu): authoring prompt generated from the validator's tables, worked example, SCENARIO_AUTHORING.md"
```

---

### Task 4: Custom scenario store and id resolution

**Files:**
- Create: `src/edu/custom-scenarios.ts`
- Modify: `src/edu/scenarios/index.ts` (no change to `SCENARIOS`; add `isShippedScenario`)
- Modify: `src/app/controller.ts:129,168-175` (store field, `findScenario`, `loadScenario`)
- Modify: `src/app/App.tsx:45,77` (hash resolution through the controller)
- Modify: `src/ui/ScenarioPicker.tsx` (`custom` prop, "My scenarios" group)
- Test: `tests/unit/custom-scenarios.test.ts`

**Interfaces:**
- Consumes: `browserStorage`, `KeyValueStorage` from `src/edu/progress.ts`; `validateScenario`.
- Produces: `export const CUSTOM_KEY = 'ventsim.custom.v1'`; `export class CustomScenarioStore { constructor(storage?: KeyValueStorage); all(): ScenarioDef[]; get(id): ScenarioDef | null; save(def): { ok: true } | { ok: false; error: string }; remove(id): void; exportJson(id): string | null }`; controller `customScenarios: CustomScenarioStore`, `findScenario(id: string): ScenarioDef | null`, `hasScenario(id): boolean`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/custom-scenarios.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CUSTOM_KEY, CustomScenarioStore } from '@/edu/custom-scenarios';
import { EXAMPLE_SCENARIO } from '@/edu/authoring';
import type { KeyValueStorage } from '@/edu/progress';

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('custom scenario store', () => {
  it('saves, lists in insertion order, overwrites by id, exports and removes; persists as one JSON document', () => {
    const s = memoryStorage();
    const store = new CustomScenarioStore(s);
    expect(store.all()).toEqual([]);
    expect(store.save(EXAMPLE_SCENARIO)).toEqual({ ok: true });
    expect(store.save({ ...EXAMPLE_SCENARIO, id: 'second', title: 'Second' })).toEqual({ ok: true });
    expect(store.all().map((d) => d.id)).toEqual([EXAMPLE_SCENARIO.id, 'second']);
    expect(store.save({ ...EXAMPLE_SCENARIO, title: 'Renamed' })).toEqual({ ok: true });
    expect(store.get(EXAMPLE_SCENARIO.id)?.title).toBe('Renamed');
    expect(store.all()).toHaveLength(2);
    expect(JSON.parse(store.exportJson('second') ?? '{}').title).toBe('Second');
    expect(store.exportJson('nope')).toBeNull();
    const again = new CustomScenarioStore(s);
    expect(again.all()).toHaveLength(2);
    expect(JSON.parse(s.map.get(CUSTOM_KEY) ?? '{}').version).toBe(1);
    again.remove('second');
    expect(again.all().map((d) => d.id)).toEqual([EXAMPLE_SCENARIO.id]);
  });

  it('refuses an id that belongs to a shipped scenario', () => {
    const store = new CustomScenarioStore(memoryStorage());
    const r = store.save({ ...EXAMPLE_SCENARIO, id: 'copd' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/"copd" is a built-in scenario/);
    expect(store.all()).toEqual([]);
  });

  it('survives a corrupt document and a throwing storage', () => {
    const s = memoryStorage();
    s.map.set(CUSTOM_KEY, '{not json');
    expect(new CustomScenarioStore(s).all()).toEqual([]);
    const throwing: KeyValueStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    const store = new CustomScenarioStore(throwing);
    expect(store.save(EXAMPLE_SCENARIO)).toEqual({ ok: true });
    expect(store.all()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/custom-scenarios.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `src/edu/custom-scenarios.ts`

```ts
/**
 * "My scenarios" (Spec 2026-09-14 §5.3): validated scenarios pasted into the Instructor editor, kept in
 * localStorage as one versioned JSON document (guarded like the progress store) and listed in the picker.
 */
import { browserStorage, type KeyValueStorage } from './progress';
import { SCENARIOS, type ScenarioDef } from './scenarios';

export const CUSTOM_KEY = 'ventsim.custom.v1';

interface CustomDoc {
  version: 1;
  scenarios: ScenarioDef[];
}

export function isShippedScenario(id: string): boolean {
  return SCENARIOS.some((s) => s.id === id);
}

export class CustomScenarioStore {
  private doc: CustomDoc;
  private storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = browserStorage()) {
    this.storage = storage;
    this.doc = this.load();
  }

  private load(): CustomDoc {
    try {
      const raw = this.storage.getItem(CUSTOM_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CustomDoc>;
        if (parsed.version === 1 && Array.isArray(parsed.scenarios)) return { version: 1, scenarios: parsed.scenarios };
      }
    } catch {
      /* corrupt or blocked: start empty */
    }
    return { version: 1, scenarios: [] };
  }

  private persist(): void {
    try {
      this.storage.setItem(CUSTOM_KEY, JSON.stringify(this.doc));
    } catch {
      /* full or blocked: keep the in-memory copy */
    }
  }

  all(): ScenarioDef[] {
    return this.doc.scenarios.slice();
  }

  get(id: string): ScenarioDef | null {
    return this.doc.scenarios.find((s) => s.id === id) ?? null;
  }

  save(def: ScenarioDef): { ok: true } | { ok: false; error: string } {
    if (isShippedScenario(def.id)) return { ok: false, error: `"${def.id}" is a built-in scenario; choose another id` };
    const i = this.doc.scenarios.findIndex((s) => s.id === def.id);
    if (i >= 0) this.doc.scenarios[i] = def;
    else this.doc.scenarios.push(def);
    this.persist();
    return { ok: true };
  }

  remove(id: string): void {
    this.doc.scenarios = this.doc.scenarios.filter((s) => s.id !== id);
    this.persist();
  }

  exportJson(id: string): string | null {
    const d = this.get(id);
    return d ? JSON.stringify(d, null, 2) : null;
  }
}
```

- [ ] **Step 4: Controller** — in `src/app/controller.ts`: import `CustomScenarioStore` from `'../edu/custom-scenarios'`; next to `progress = new ProgressStore();` add `customScenarios = new CustomScenarioStore();`. Replace `loadScenario`:

```ts
  /** Shipped library first, then the learner's saved scenarios. */
  findScenario(id: string): ScenarioDef | null {
    return SCENARIOS.find((s) => s.id === id) ?? this.customScenarios.get(id);
  }

  hasScenario(id: string): boolean {
    return this.findScenario(id) !== null;
  }

  loadScenario(id: string): void {
    const def = this.findScenario(id);
    if (!def) throw new Error(`unknown scenario ${id}`);
    const spec = resolveScenario(def);
    this.scenario = def;
    this.resetSessionState(spec);
    this.worker.init(spec);
    this.notify();
  }
```

Change the import line to `import { SCENARIOS, resolveScenario, type ScenarioDef, type ScenarioFix } from '../edu/scenarios';` (drop `scenarioById` if now unused).

- [ ] **Step 5: App hash resolution** — in `src/app/App.tsx` change `fromHash`:

```ts
    const fromHash = () => {
      const hash = hashPage();
      return ctl.hasScenario(hash) ? hash : DEFAULT_SCENARIO;
    };
```

Pass the store to the picker: `<ScenarioPicker current={scenario} onPick={pick} progress={ctl.progress.all()} custom={ctl.customScenarios.all()} disabled={locked} mask={hideScenario} />`.

- [ ] **Step 6: Picker** — in `src/ui/ScenarioPicker.tsx` add `custom?: ScenarioDef[]` to `Props`, destructure `custom = []`, extend `caseNumber` to cover custom ids after the shipped ones, and render after the shipped groups:

```tsx
        {custom.length > 0 && (
          <optgroup label={mask ? 'Cases' : 'My scenarios'} data-testid="picker-custom-group">
            {custom.map((s) => (
              <option value={s.id} key={s.id}>
                {mask ? `Case ${caseNumber.get(s.id) ?? ''}` : s.title}
                {!mask && progress?.[s.id] ? ` · best ${progress[s.id]?.best}${progress[s.id]?.passed ? ' ✓' : ''}` : ''}
              </option>
            ))}
          </optgroup>
        )}
```

with `const caseNumber = new Map([...SCENARIOS, ...custom].map((s, i) => [s.id, i + 1]));`.

- [ ] **Step 7: Run everything**

Run: `npx vitest run tests/unit/custom-scenarios.test.ts && npm test && npm run lint`
Expected: pass. `tests/unit/session.test.ts` or others that call `scenarioById` are unaffected (it still exists in `scenarios/index.ts`).

- [ ] **Step 8: Commit**

```bash
git add src/edu/custom-scenarios.ts src/app/controller.ts src/app/App.tsx src/ui/ScenarioPicker.tsx tests/unit/custom-scenarios.test.ts
git commit -m "feat(edu): My scenarios store; controller and picker resolve custom ids"
```

---

### Task 5: Instructor panel authoring controls

**Files:**
- Modify: `src/ui/InstructorPanel.tsx:19-30` (replace `parseScenarioJson`), editor block at the end
- Modify: `src/ui/theme.css` (before the responsive blocks: `.instructor-body .author-errors`, `.instructor-body .custom-list`)
- Test: `tests/e2e/authoring.spec.ts`

**Interfaces:**
- Consumes: `parseScenarioText` (Task 2), `AUTHORING_PROMPT`, `EXAMPLE_SCENARIO` (Task 3), `ctl.customScenarios`, `ctl.loadScenario` (Task 4).
- Produces: test ids `author-copy-prompt`, `author-prompt-field`, `author-load-example`, `author-validate`, `author-save`, `author-errors`, `author-warnings`, `custom-list`, `custom-row`, `custom-load`, `custom-export`, `custom-delete`.

- [ ] **Step 1: Write the failing e2e test** — `tests/e2e/authoring.spec.ts`

```ts
import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
}

test('authoring: load the example, validate, save to My scenarios, reload and find it in the picker', async ({ page }) => {
  await page.goto('/#normal-passive');
  await ready(page);
  await page.getByTestId('instructor-toggle').click();
  await page.getByTestId('author-load-example').click();
  await expect(page.getByTestId('instr-json')).toHaveValue(/example-obesity-pc-short-ti/);
  await page.getByTestId('author-validate').click();
  await expect(page.getByTestId('instr-msg')).toContainText('valid');
  await page.getByTestId('author-save').click();
  await expect(page.getByTestId('picker-custom-group')).toBeVisible();
  await expect(page.getByTestId('custom-row')).toHaveCount(1);
  // Saved and loaded: the running scenario is the example.
  await page.waitForFunction(() => window.__ventsim?.ctl.scenario?.id === 'example-obesity-pc-short-ti');
  await page.reload();
  await ready(page);
  await expect(page.locator('[data-testid="scenario-select"] option[value="example-obesity-pc-short-ti"]')).toHaveCount(1);
  await page.getByTestId('scenario-select').selectOption('example-obesity-pc-short-ti');
  await page.waitForFunction(() => window.__ventsim?.ctl.scenario?.id === 'example-obesity-pc-short-ti');
});

test('authoring: a bad scenario lists its errors by field and is not saved', async ({ page }) => {
  await page.goto('/#normal-passive');
  await ready(page);
  await page.getByTestId('instructor-toggle').click();
  await page.getByTestId('instr-json').fill('{"id":"x","title":"Bad","phenotype":"martian","settings":{"mode":"PSV","ps":99}}');
  await page.getByTestId('author-save').click();
  const errors = page.getByTestId('author-errors');
  await expect(errors).toContainText('"phenotype"');
  await expect(errors).toContainText('settings.ps');
  await expect(page.getByTestId('picker-custom-group')).toHaveCount(0);
});

test('authoring: the prompt is exposed for copying', async ({ page }) => {
  await page.goto('/#normal-passive');
  await ready(page);
  await page.getByTestId('instructor-toggle').click();
  await page.getByTestId('author-copy-prompt').click();
  await expect(page.getByTestId('author-prompt-field')).toHaveValue(/INTERVIEW FIRST/);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test tests/e2e/authoring.spec.ts --project=chromium`
Expected: FAIL, `author-load-example` not found.

- [ ] **Step 3: Implement** — in `src/ui/InstructorPanel.tsx`:

Replace the imports and `parseScenarioJson`:

```ts
import { parseScenarioText } from '../edu/scenario-schema';
import { AUTHORING_PROMPT, EXAMPLE_SCENARIO } from '../edu/authoring';
import type { ScenarioDef } from '../edu/scenarios';
```

(delete `parseScenarioJson` and the `SCENARIOS` import if `titleOf` switches to `ctl.findScenario(id)?.title ?? id`.)

New state next to `json`/`msg`:

```ts
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const custom = ctl.customScenarios.all();
  const validate = (): ScenarioDef | null => {
    const r = parseScenarioText(json);
    setErrors(r.errors);
    setWarnings(r.warnings);
    if (r.def) setMsg(`valid: "${r.def.title}"${r.warnings.length ? ` (${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''})` : ''}`);
    else setMsg(`invalid: ${r.errors.length} problem${r.errors.length > 1 ? 's' : ''}`);
    return r.def;
  };
```

Replace the editor `<div class="row editor">` contents with:

```tsx
          <div class="row editor">
            <b>Scenario editor</b>
            <span class="muted">
              Write your own: copy the authoring prompt into your LLM, answer its questions, paste the JSON here, validate, save.
              See docs/SCENARIO_AUTHORING.md.
            </span>
            <div>
              <button
                type="button"
                onClick={() => {
                  setShowPrompt(true);
                  const clip = navigator.clipboard;
                  if (!clip) {
                    setMsg('copy blocked: select the prompt field and copy it');
                    return;
                  }
                  void clip
                    .writeText(AUTHORING_PROMPT)
                    .then(() => setMsg('authoring prompt copied'))
                    .catch(() => setMsg('copy blocked: select the prompt field and copy it'));
                }}
                data-testid="author-copy-prompt"
              >
                Copy authoring prompt
              </button>
              <button type="button" onClick={() => { setJson(JSON.stringify(EXAMPLE_SCENARIO, null, 2)); setErrors([]); setWarnings([]); setMsg('example loaded; edit it or validate as is'); }} data-testid="author-load-example">
                Load example
              </button>
              <button type="button" onClick={() => setJson(currentJson())} data-testid="instr-current">
                load current
              </button>
            </div>
            {showPrompt && (
              <textarea readOnly value={AUTHORING_PROMPT} rows={6} aria-label="Authoring prompt" data-testid="author-prompt-field" onFocus={(e) => e.currentTarget.select()} spellcheck={false} />
            )}
            <textarea value={json} onInput={(e) => setJson(e.currentTarget.value)} placeholder="Scenario JSON (load the example or the current scenario to start)" rows={8} data-testid="instr-json" spellcheck={false} />
            <div>
              <button type="button" onClick={() => void validate()} data-testid="author-validate">
                Validate
              </button>
              <button
                type="button"
                class="primary"
                onClick={() => {
                  const def = validate();
                  if (!def) return;
                  const r = ctl.customScenarios.save(def);
                  if (!r.ok) {
                    setErrors([r.error]);
                    setMsg('not saved');
                    return;
                  }
                  ctl.loadScenario(def.id);
                  location.hash = def.id;
                  setMsg(`saved and loaded "${def.title}"`);
                }}
                data-testid="author-save"
              >
                Save to My scenarios
              </button>
              <button
                type="button"
                onClick={() => {
                  const def = validate();
                  if (def) {
                    ctl.loadScenarioDef(def);
                    setMsg(`running "${def.title}" (not saved)`);
                  }
                }}
                data-testid="instr-load"
              >
                run without saving
              </button>
              <button type="button" onClick={() => void downloadBytes(`${ctl.scenario?.id ?? 'scenario'}.json`, json || currentJson(), 'application/json')} data-testid="instr-export">
                export
              </button>
              <label class="inline">
                import
                <input type="file" accept="application/json,.json" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (!f) return; void f.text().then((txt) => setJson(txt)); }} data-testid="instr-import" />
              </label>
            </div>
            {errors.length > 0 && (
              <ul class="author-errors" data-testid="author-errors">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            {warnings.length > 0 && (
              <ul class="author-warnings muted" data-testid="author-warnings">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            {msg && (
              <span class="muted" data-testid="instr-msg">
                {msg}
              </span>
            )}
          </div>
          {custom.length > 0 && (
            <div class="row custom-list" data-testid="custom-list">
              <b>My scenarios</b>
              <span class="muted">saved in this browser</span>
              <ul>
                {custom.map((s) => (
                  <li key={s.id} data-testid="custom-row">
                    <span>{s.title}</span>
                    <button type="button" onClick={() => { ctl.loadScenario(s.id); location.hash = s.id; }} data-testid="custom-load">load</button>
                    <button type="button" onClick={() => setJson(ctl.customScenarios.exportJson(s.id) ?? '')} data-testid="custom-export">edit</button>
                    <button type="button" onClick={() => { ctl.customScenarios.remove(s.id); setMsg(`removed "${s.title}"`); }} data-testid="custom-delete">delete</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
```

The picker re-renders from `ctl.customScenarios.all()` on the controller's `notify()`; `loadScenario` calls `notify()`, and `remove` must too: after `ctl.customScenarios.remove(s.id)` call `ctl.refresh()` — add to the controller:

```ts
  /** Re-render without a state change (custom-scenario list edits). */
  refresh(): void {
    this.notify();
  }
```

and call it in the delete handler (a failed save needs nothing: the panel's own state re-renders it).

CSS (before the responsive blocks in `theme.css`):

```css
.instructor-body .author-errors {
  color: var(--danger);
  margin: 4px 0 0;
  padding-left: 18px;
}
.instructor-body .author-warnings {
  margin: 4px 0 0;
  padding-left: 18px;
}
.instructor-body .custom-list ul {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}
.instructor-body .custom-list li {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
```

`--danger` (#ef5350) exists in `theme.css`; use it without a fallback: `color: var(--danger);`.

- [ ] **Step 4: Run the e2e file, then the unit suite and lint**

Run: `npx playwright test tests/e2e/authoring.spec.ts --project=chromium && npm test && npm run lint`
Expected: 3 passed; unit and lint clean. `tests/e2e/export.spec.ts` or `quiz-bedside.spec.ts` use `instr-json`/`instr-load` — run `npx playwright test tests/e2e/export.spec.ts tests/e2e/quiz-bedside.spec.ts --project=chromium` and fix any renamed label expectation (the ids are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/ui/InstructorPanel.tsx src/app/controller.ts src/ui/theme.css tests/e2e/authoring.spec.ts
git commit -m "feat(ui): Instructor authoring controls: copy prompt, load example, validate, save to My scenarios"
```

---

### Task 6: Help dialog

**Files:**
- Create: `src/ui/HelpDialog.tsx`
- Modify: `src/app/App.tsx` (header button, dialog mount, first-visit open)
- Modify: `src/ui/theme.css` (dialog rules before the responsive blocks)
- Modify: `tests/e2e/a11y.spec.ts` (open the dialog in the main-page test)
- Test: `tests/e2e/help.spec.ts`

**Interfaces:**
- Consumes: `browserStorage` from `src/edu/progress.ts`.
- Produces: `export const HELP_SEEN_KEY = 'ventsim.help.seen.v1'`; `export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void })`; test ids `help-open`, `help-dialog`, `help-close`.

- [ ] **Step 1: Write the failing e2e test** — `tests/e2e/help.spec.ts`

```ts
import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ventsim?.ctl.ready === true, undefined, { timeout: 30_000 });
}

test('help: opens once on first visit, closes, stays closed on reload, reopens from the header button', async ({ page }) => {
  await page.goto('/#normal-passive');
  await ready(page);
  const dialog = page.getByTestId('help-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('How to use VentSim');
  await expect(dialog).toContainText('APRV');
  await expect(dialog).toContainText('authoring prompt');
  await page.getByTestId('help-close').click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await ready(page);
  await expect(dialog).toBeHidden();
  await page.getByTestId('help-open').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('help: available in the locked quiz view', async ({ page }) => {
  await page.goto('/#copd?quiz=bedside');
  await ready(page);
  await page.getByTestId('help-close').click();
  await page.getByTestId('help-open').click();
  await expect(page.getByTestId('help-dialog')).toBeVisible();
});
```

Existing e2e tests will now see the modal dialog on first visit, and clicks behind a modal fail. Keep the
auto-open real and have every other spec start with the flag already set. Add to `tests/e2e/helpers/layout.ts`:

```ts
/** Every spec except help.spec.ts starts with the first-visit help already dismissed. */
export async function dismissHelp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ventsim.help.seen.v1', '1');
    } catch {
      /* blocked */
    }
  });
}
```

and call `await dismissHelp(page)` **before** `page.goto` in every existing spec's first line (a `test.beforeEach` at the top of each spec file: `test.beforeEach(async ({ page }) => { await dismissHelp(page); });`). List: `a11y, export, load, m6, m7, mobile, quiz-bedside, quiz, screenshots, settings, smoke, tablet`. `help.spec.ts` does not call it; its second test sets the flag itself by closing first.

- [ ] **Step 2: Run to see it fail**

Run: `npx playwright test tests/e2e/help.spec.ts --project=chromium`
Expected: FAIL, `help-dialog` not found.

- [ ] **Step 3: Implement** — `src/ui/HelpDialog.tsx`

```tsx
import { useEffect, useRef } from 'preact/hooks';

export const HELP_SEEN_KEY = 'ventsim.help.seen.v1';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** How-to-use overlay (Spec 2026-09-14 §6): static text, no truth data, so it is available in the locked quiz view. */
export function HelpDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} class="help-dialog" aria-labelledby="help-title" data-testid="help-dialog" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div class="help-body">
        <h2 id="help-title">How to use VentSim</h2>
        <p>
          VentSim is a teaching ventilator. Every waveform comes from a physiologic model of the patient and the ventilator; nothing is drawn by
          hand, so dyssynchrony appears when the settings and the patient disagree. The screen shows what a bedside monitor would show; the
          <b> truth layer</b> adds what only the model knows (true muscle pressure, pleural and transpulmonary pressure, neural timing).
        </p>
        <h3>The screen</h3>
        <ul>
          <li><b>Waveforms</b> (centre): Paw, flow, volume, plus Pes with the esophageal balloon and truth rows with the truth toggle. Badges above the traces are the signal-only detector's labels; hover for evidence, click for the explain card. Below: loops and the drawer.</li>
          <li><b>Settings</b> (left): change a value, then <b>Confirm</b>; rate, volume and pressure changes take effect at the next breath. Injectors (leak, secretions, bronchospasm…) and the Instructor panel sit below.</li>
          <li><b>Monitor</b> (right): measured numbers, maneuver buttons (holds, P0.1, ΔPocc, occlusion test, R/I, PEEP trial), the lung-stress dashboard and the CO2 panel when a scenario has the CO2 loop.</li>
          <li><b>Drawer tabs</b>: Scenario (objectives and the suggested fix), Explain, Quiz, Export.</li>
          <li><b>Phones</b>: the waveforms stay pinned; the bottom tab bar switches Vent, Monitor, Loops and Learn.</li>
        </ul>
        <h3>A session</h3>
        <ol>
          <li>Pick a scenario. Watch 20–30 s of breathing.</li>
          <li>Take an inspiratory and an expiratory hold; try P0.1.</li>
          <li>Click a badge to open its explain card with the case evidence.</li>
          <li>Open <b>Quiz</b>: identify the patterns with badges hidden, then fix the settings within safety limits; the debrief compares your changes with the recommended fix.</li>
          <li><b>Export</b> the session as CSV or JSON with truth labels.</li>
        </ol>
        <h3>Modes</h3>
        <ul>
          <li><b>VC-AC</b>: set volume and flow; watch for flow starvation and double triggering when the drive is strong.</li>
          <li><b>PC-AC</b>: set pressure and Ti; volume follows compliance and effort.</li>
          <li><b>PSV</b>: the patient sets the rate and Ti; cycling by flow (ETS) — premature or delayed cycling, ineffective efforts with intrinsic PEEP.</li>
          <li><b>CPAP</b>: no support; work of breathing is the patient's.</li>
          <li><b>SIMV</b>: mandatory VC or PC breaths at a set rate, pressure-supported breaths in between; two breath types in one trace.</li>
          <li><b>PRVC</b>: pressure control that adapts breath by breath to a volume target; a strong effort makes it withdraw support.</li>
          <li><b>APRV</b>: long Phigh with short releases and unrestricted spontaneous breathing; the release timing sets the trapped PEEP and can collide with efforts.</li>
        </ul>
        <h3>Write your own scenario</h3>
        <p>
          Instructor panel → <b>Copy authoring prompt</b> → paste it into your own LLM and answer its questions → paste the JSON it returns
          into the editor → <b>Validate</b> → <b>Save to My scenarios</b>. The format is documented in <code>docs/SCENARIO_AUTHORING.md</code>.
        </p>
        <h3>More</h3>
        <p>
          <a href="https://github.com/nahata5/vent-sim#readme" target="_blank" rel="noreferrer">README</a> · <a href="https://github.com/nahata5/vent-sim/blob/main/docs/MODEL.md" target="_blank" rel="noreferrer">Model</a> ·{' '}
          <a href="#validation">Validation</a>. VentSim is for education only; it is not a medical device and not a clinical decision aid.
        </p>
        <button type="button" class="primary" onClick={onClose} data-testid="help-close">
          Close
        </button>
      </div>
    </dialog>
  );
}
```

The repository is `https://github.com/nahata5/vent-sim` (matches the links above).

In `src/app/App.tsx`: import `HelpDialog, HELP_SEEN_KEY` and `browserStorage` from `'../edu/progress'`; add state

```ts
  const [help, setHelp] = useState<boolean>(() => {
    try {
      return browserStorage().getItem(HELP_SEEN_KEY) === null;
    } catch {
      return false;
    }
  });
  const closeHelp = () => {
    setHelp(false);
    try {
      browserStorage().setItem(HELP_SEEN_KEY, '1');
    } catch {
      /* blocked */
    }
  };
```

In the main header, after the `<h1>`:

```tsx
        <button type="button" class="link help-open" onClick={() => setHelp(true)} aria-label="How to use VentSim" title="How to use VentSim" data-testid="help-open">
          ?
        </button>
```

and mount `<HelpDialog open={help} onClose={closeHelp} />` just before `</div>` of the main `app-shell` (not on the validation page).

CSS (before the responsive blocks):

```css
dialog.help-dialog {
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  max-width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  padding: 0;
}
dialog.help-dialog::backdrop {
  background: rgba(0, 0, 0, 0.6);
}
.help-body {
  padding: 16px 20px;
  overflow: auto;
  max-height: calc(100vh - 34px);
}
.help-body h2 {
  margin-top: 0;
}
.help-body h3 {
  margin: 14px 0 4px;
  font-size: 14px;
}
.help-body ul,
.help-body ol {
  padding-left: 20px;
}
button.help-open {
  font-weight: 700;
  border: 1px solid var(--border);
  border-radius: 50%;
  width: 26px;
  height: 26px;
  padding: 0;
  text-align: center;
}
```

`--panel`, `--text`, `--border` all exist in `theme.css`.

- [ ] **Step 4: Seed the flag in the other specs** — add `dismissHelp` to `tests/e2e/helpers/layout.ts` (Step 1) and a `test.beforeEach` calling it at the top of each existing spec file listed in Step 1. In `a11y.spec.ts` main-page test, after `ready(page)` add:

```ts
  await page.getByTestId('help-open').click();
  await expect(page.getByTestId('help-dialog')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByTestId('help-close').click();
```

before the existing quiz-tab check.

- [ ] **Step 5: Run the help spec, then the whole e2e suite**

Run: `npx playwright test tests/e2e/help.spec.ts --project=chromium && npm run test:e2e`
Expected: help 2 passed; full suite 35 + 5 new (3 authoring + 2 help) passed across the three projects. If the mobile project fails on the dialog width, the `max-width` rule above is wrong for 412 px — keep it at `calc(100vw - 32px)`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/HelpDialog.tsx src/app/App.tsx src/ui/theme.css tests/e2e/help.spec.ts tests/e2e/helpers/layout.ts tests/e2e/*.spec.ts
git commit -m "feat(ui): help dialog with first-visit open and a header button"
```

---

### Task 7: Docs, decision record, deploy check

**Files:**
- Modify: `README.md` ("Using the app": authoring and help bullets; "Documentation": link `docs/SCENARIO_AUTHORING.md`)
- Modify: `docs/DECISIONS.md` (append D-025), `PROGRESS.md` (append M10 entry), `docs/HANDOFF.md` (state table row, code map)
- Modify: `docs/LIMITATIONS.md` (custom scenarios are per-browser; the authoring prompt is advisory, the validator is the gate)

- [ ] **Step 1: README** — add to "Using the app":

```markdown
- **Help**: the `?` button in the header opens a how-to-use overlay (it opens by itself on the first visit).
- **Write your own scenario** (Instructor panel → Scenario editor): **Copy authoring prompt**, paste it into
  your own LLM, answer its questions, paste the JSON back, **Validate**, **Save to My scenarios**. Saved
  scenarios persist in the browser, appear under "My scenarios" in the picker and work with quiz links and
  progress. Format reference: `docs/SCENARIO_AUTHORING.md` (generated by `npm run docs:authoring`).
```

- [ ] **Step 2: DECISIONS D-025** — append:

```markdown
## D-025 · Scenario authoring through the reader's LLM, a validator as the gate, "My scenarios" in localStorage, help overlay (2026-09-14)

The instructor editor accepted any JSON with four keys and reported one error at a time. Authors now get a
prompt (`src/edu/authoring.ts`) generated from the same enumerations and bounds the validator
(`src/edu/scenario-schema.ts`) enforces, so the prompt, the validator and `docs/SCENARIO_AUTHORING.md`
cannot drift; the validator reports every problem by field and ignores unknown keys with a warning. No LLM
runs inside VentSim (spec §1 out-of-scope stands): the reader's own model writes the JSON, the validator
decides. Saved scenarios live in `ventsim.custom.v1` (guarded storage as the progress store); ids that
collide with shipped scenarios are refused; the controller resolves ids through the library first and the
store second so hash links and quiz links work for both. Settings bounds moved into `SETTING_BOUNDS`
(`src/sim/vent/settings.ts`) so the clamp, the UI and the validator share one table. The help dialog is a
native `<dialog>`; it holds no truth data, so it stays available in the locked quiz view; the first-visit
auto-open is remembered in `ventsim.help.seen.v1`.
```

- [ ] **Step 3: PROGRESS and HANDOFF** — PROGRESS entry "M10 · Scenario authoring, My scenarios, help overlay (2026-09-14)" listing the files, the test counts from the runs above, and the deploy check. HANDOFF: add an M10 row to the state table, a "M10 as built" code map (the files and test ids in this plan), and update the next-session prompt to point at the M11 plan (to be written).

- [ ] **Step 4: Full verification**

Run: `npm test && npm run lint && npm run test:e2e && npm run build`
Expected: all green. Re-run `tests/physics/performance.test.ts` alone if it fails in the parallel run (wall-clock test, see HANDOFF).

- [ ] **Step 5: Commit, push, check the live site**

```bash
git add README.md docs/DECISIONS.md PROGRESS.md docs/HANDOFF.md docs/LIMITATIONS.md
git commit -m "docs: M10 authoring, My scenarios and help overlay (D-025)"
git push
```

Then poll the served bundle for a literal string of this milestone (`ventsim.custom.v1`):

```bash
for i in $(seq 1 20); do
  f=$(curl -sSL https://vent.nahass.ai/ | grep -o 'assets/index-[^"]*\.js' | head -1)
  curl -sSL "https://vent.nahass.ai/$f" | grep -q 'ventsim.custom.v1' && echo deployed && break
  sleep 30
done
```

(also check `https://vent-sim.netlify.app/` the same way.)
