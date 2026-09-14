/**
 * Scenario JSON validation (Spec 2026-09-14 §5.1). Checks a pasted definition against the code's own
 * enumerations and the shared settings bounds, and returns every problem by field name. The authoring
 * prompt (authoring.ts) is generated from the same tables, so the two cannot drift.
 */
import { PHENOTYPE_IDS } from '../sim/patient/presets';
import { IMPLEMENTED_MODES } from '../sim/types';
import { INJECTOR_KINDS, defaultInjectorParams, type InjectorKind } from '../sim/injectors';
import { PATTERN_IDS } from '../sim/truth/labeler';
import { SETTING_BOUNDS, defaultSettings, type NumericSettingKey } from '../sim/vent/settings';
import { defaultGasParams } from '../sim/patient/gas-exchange';
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
/** DriveParams fields not covered by DRIVE_BOUNDS (src/sim/patient/neural-drive.ts). */
const DRIVE_EXTRA_KEYS = new Set(['entrainment', 'expiratory', 'sighInterval', 'lowDriveClusters', 'relaxTau', 'holdFrac', 'ar1Phi', 'kFv', 'qRef']);
const GAS_KEYS = new Set(Object.keys(defaultGasParams()));
const MECHANICS_POSITIVE_KEYS = ['el', 'ecw', 'frc'] as const;
const ENUM_KEYS: Record<string, readonly string[]> = {
  triggerType: ['flow', 'pressure'],
  flowPattern: ['square', 'ramp'],
  vcTiming: ['peakFlow', 'ti'],
  simvBase: ['VC', 'PC'],
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
  if (s.mode !== undefined && !(typeof s.mode === 'string' && (IMPLEMENTED_MODES as readonly string[]).includes(s.mode))) errors.push(`${path}.mode must be one of ${list(IMPLEMENTED_MODES)}`);
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
      const opts = ENUM_KEYS[key];
      if (opts && !opts.includes(String(v))) errors.push(`${path}.${key} must be one of ${list(opts)}`);
    } else if (BOOL_KEYS.has(key)) {
      if (typeof v !== 'boolean') errors.push(`${path}.${key} must be true or false`);
    } else if (key === 'deviceRate') {
      if (![50, 100, 200].includes(Number(v))) errors.push(`${path}.deviceRate must be 50, 100 or 200`);
    } else if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${path}.${key} must be a number`);
  }
}

function checkDrive(d: unknown, path: string, errors: string[], warnings: string[]): void {
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
  for (const key of Object.keys(d)) {
    if (key in DRIVE_BOUNDS || DRIVE_EXTRA_KEYS.has(key)) continue;
    warnings.push(`unknown key ${path}.${key} (ignored)`);
  }
}

function checkInjectors(inj: unknown, path: string, allowNull: boolean, errors: string[], warnings: string[]): void {
  if (!isRec(inj)) {
    errors.push(`${path} must be an object keyed by injector kind`);
    return;
  }
  for (const [key, v] of Object.entries(inj)) {
    if (!(INJECTOR_KINDS as readonly string[]).includes(key)) errors.push(`${path}.${key} is not an injector; use ${list(INJECTOR_KINDS)}`);
    else if (v === null && !allowNull) errors.push(`${path}.${key} must be an object of parameters (null is only allowed inside "fix")`);
    else if (v !== null && !isRec(v)) errors.push(`${path}.${key} must be an object of parameters`);
    else if (isRec(v)) {
      if (v.at !== undefined && (typeof v.at !== 'number' || v.at < 0)) errors.push(`${path}.${key}.at must be seconds ≥ 0`);
      const paramKeys = new Set(Object.keys(defaultInjectorParams(key as InjectorKind)));
      for (const pk of Object.keys(v)) {
        if (pk === 'at' || paramKeys.has(pk)) continue;
        warnings.push(`unknown key ${path}.${key}.${pk} (ignored)`);
      }
    }
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
  if (r.category !== undefined && !(typeof r.category === 'string' && (SCENARIO_CATEGORIES as readonly string[]).includes(r.category))) errors.push(`"category" must be one of ${list(SCENARIO_CATEGORIES)}`);
  if (r.order !== undefined && typeof r.order !== 'number') errors.push('"order" must be a number');
  if (r.seed !== undefined && typeof r.seed !== 'number' && typeof r.seed !== 'string') errors.push('"seed" must be a number or a string');
  if (r.shunt !== undefined && (typeof r.shunt !== 'number' || r.shunt < 0 || r.shunt > 1)) errors.push('"shunt" must be a fraction 0–1');
  if (r.settings === undefined) errors.push('"settings" is required (at least { "mode": … })');
  else checkSettings(r.settings, 'settings', true, errors, warnings);
  if (r.drive === undefined) warnings.push('"drive" missing: the patient will be passive (null)');
  else checkDrive(r.drive, 'drive', errors, warnings);
  if (r.mechanics !== undefined) {
    if (!isRec(r.mechanics)) errors.push('"mechanics" must be an object');
    else {
      const rec = r.mechanics.recoil;
      if (rec !== undefined && rec !== 'recruitable' && !(isRec(rec) && rec.kind === 'recruitable')) errors.push('mechanics.recoil must be "recruitable" or { "kind": "recruitable", …overrides }');
      for (const [key, v] of Object.entries(r.mechanics)) if (key !== 'recoil' && typeof v !== 'number') errors.push(`mechanics.${key} must be a number`);
      for (const key of MECHANICS_POSITIVE_KEYS) {
        const v = r.mechanics[key];
        if (typeof v === 'number' && v <= 0) errors.push(`mechanics.${key} must be > 0`);
      }
    }
  }
  if (r.balloon !== undefined && !isRec(r.balloon)) errors.push('"balloon" must be an object, e.g. { "enabled": true }');
  if (r.gas !== undefined) {
    if (!isRec(r.gas)) errors.push('"gas" must be an object of CO2-loop parameters');
    else {
      for (const [key, v] of Object.entries(r.gas)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`gas.${key} must be a number`);
        if (!GAS_KEYS.has(key)) warnings.push(`unknown key gas.${key} (ignored)`);
      }
    }
  }
  if (r.injectors !== undefined) checkInjectors(r.injectors, 'injectors', false, errors, warnings);
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
      if (r.fix.drive !== undefined) checkDrive(r.fix.drive, 'fix.drive', errors, warnings);
      if (r.fix.injectors !== undefined) checkInjectors(r.fix.injectors, 'fix.injectors', true, errors, warnings);
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
  return { def: { ...defaults, ...r } as unknown as ScenarioDef, errors, warnings };
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
