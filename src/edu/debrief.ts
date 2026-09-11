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
  for (const [key, to] of Object.entries(partial) as Array<[keyof VentSettings, VentSettings[keyof VentSettings] | undefined]>) {
    if (to === undefined) continue;
    const from = current[key];
    if (key === 'alarms') {
      const a = from as VentSettings['alarms'];
      const b = to as VentSettings['alarms'];
      for (const id of Object.keys(b) as Array<keyof VentSettings['alarms']>) {
        if (a[id] !== b[id]) out.push({ t, key: `${ALARM_PREFIX}${id}`, from: a[id], to: b[id] });
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
    ...inp.truthPatterns.map((p): DebriefPattern => ({ id: p, title: CARDS[p].title, evidence: inp.evidence[p] ?? [], mark: id.hits.includes(p) ? 'found' : 'missed' })),
    ...id.falsePositives.map((p): DebriefPattern => ({ id: p, title: CARDS[p].title, evidence: [], mark: 'extra' })),
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
