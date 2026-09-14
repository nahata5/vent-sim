/**
 * Scenario library (Spec §8). Each scenario is a JSON file in this folder: phenotype, optional
 * mechanics overrides, drive (null = passive), balloon, injectors, ventilator settings, seed, objectives,
 * target patterns, a scripted fix and the emergence-matrix criteria (Spec §9.4). `resolveScenario`
 * turns one into a runnable ScenarioSpec; `scenarioSchedule` builds the injector/fix schedule.
 */
import type { PhenotypeId } from '../../sim/patient/presets';
import { presetPatient, recruitableRecoil } from '../../sim/patient/presets';
import type { MechanicsParams } from '../../sim/patient/params';
import type { RecruitableSpec } from '../../sim/patient/lung-recruitable';
import { defaultDriveParams, type DriveParams } from '../../sim/patient/neural-drive';
import { defaultBalloon, type BalloonParams } from '../../sim/patient/balloon';
import type { QuizExtraDef } from '../quiz';
import { defaultGasParams, type GasParams } from '../../sim/patient/gas-exchange';
import { defaultSettings, type VentSettings } from '../../sim/vent/settings';
import type { Mode } from '../../sim/types';
import type { ScenarioSpec } from '../../worker/protocol';
import type { SimEngine } from '../../sim/engine';
import { INJECTOR_KINDS, type InjectorKind, type InjectorParamMap } from '../../sim/injectors';

export const SCENARIO_CATEGORIES = ['preset', 'dyssynchrony', 'injector', 'capstone', 'mode'] as const;
export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];

export type ScenarioInjectors = { [K in InjectorKind]?: Partial<InjectorParamMap[K]> & { at?: number } };

export interface ScenarioFix {
  /** Simulated seconds after start (the emergence test applies it here; the UI offers a button). */
  at: number;
  note: string;
  settings?: Partial<VentSettings>;
  drive?: Partial<DriveParams>;
  /** Injector changes: params to set, or null to remove. */
  injectors?: { [K in InjectorKind]?: Partial<InjectorParamMap[K]> | null };
}

export interface ScenarioCriteria {
  /** Minimum fraction of breaths (or efforts, for ineffective effort) carrying each target pattern before the fix. */
  minFraction: number;
  /** AI limit (%) after the fix. */
  aiAfter: number;
  /** `recruitedGain`: mean end-expiratory aerated FRC after the fix minus before, L (Spec 2026-09-14 §4.7). */
  extra?: Array<{ metric: 'peepiTrue'; max: number } | { metric: 'recruitedGain'; min: number }>;
  /** Which breaths the target fractions are measured over (mixed-breath modes); default every breath. */
  over?: 'all' | 'mandatory';
}

/**
 * Mechanics overrides in JSON: any MechanicsParams field, plus `recoil` as the string `'recruitable'` (the
 * phenotype's recruitable-population lung, Spec §4.3) or `{ kind: 'recruitable', ...overrides }`.
 */
export type ScenarioMechanics = Partial<Omit<MechanicsParams, 'recoil'>> & {
  recoil?: 'recruitable' | ({ kind: 'recruitable' } & Partial<Omit<RecruitableSpec, 'kind'>>);
};

export interface ScenarioDef {
  id: string;
  order: number;
  category: ScenarioCategory;
  title: string;
  summary: string;
  phenotype: PhenotypeId;
  mechanics?: ScenarioMechanics;
  drive: Partial<DriveParams> | null;
  balloon?: Partial<BalloonParams>;
  /** CO2 → drive loop (Spec §4.4) with its time warp; omitted = fixed drive. */
  gas?: Partial<GasParams>;
  injectors?: ScenarioInjectors;
  settings: Partial<VentSettings> & { mode: Mode };
  seed: number | string;
  objectives: string[];
  targetPatterns: string[];
  fix?: ScenarioFix;
  criteria?: ScenarioCriteria;
  /** Scenario-specific quiz fix checks on truth metrics (Spec §8), e.g. PL,ee ≥ 0 for the obese patient. */
  quizExtras?: QuizExtraDef[];
  /** Base venous admixture for the schematic SpO2 readout (Spec §4.6), fraction; default SPO2_SHUNT_BASE. */
  shunt?: number;
}

// Explicit imports (not import.meta.glob) so the library also loads under plain Node (tsx scripts, tests).
import normalPassive from './normal-passive.json';
import ardsPulmonary from './ards-pulmonary.json';
import ardsExtrapulmonary from './ards-extrapulmonary.json';
import obesity from './obesity.json';
import abdominalHypertension from './abdominal-hypertension.json';
import copd from './copd.json';
import asthma from './asthma.json';
import fibrosis from './fibrosis.json';
import doubleTrigger from './double-trigger.json';
import flowStarvation from './flow-starvation.json';
import ineffectiveEffort from './ineffective-effort.json';
import reverseTrigger from './reverse-trigger.json';
import autoTrigger from './auto-trigger.json';
import leakPsv from './leak-psv.json';
import prematureCycling from './premature-cycling.json';
import copdAutoPeep from './copd-auto-peep.json';
import secretions from './secretions.json';
import bronchospasm from './bronchospasm.json';
import pneumothorax from './pneumothorax.json';
import mainstem from './mainstem.json';
import peepTrialRecruiter from './peep-trial-recruiter.json';
import peepTrialNonRecruiter from './peep-trial-non-recruiter.json';
import co2OverAssist from './co2-over-assist.json';
import co2UnderAssist from './co2-under-assist.json';
import capstone from './capstone.json';
import simvLowSupport from './simv-low-support.json';
import simvMixedBreaths from './simv-mixed-breaths.json';
import simvStacking from './simv-stacking.json';
import prvcPressureWithdrawal from './prvc-pressure-withdrawal.json';
import prvcVolumeNotAchieved from './prvc-volume-not-achieved.json';
import prvcDoubleTrigger from './prvc-double-trigger.json';
import aprvTlowTooLong from './aprv-tlow-too-long.json';
import aprvReleaseCollision from './aprv-release-collision.json';
import aprvHighEffort from './aprv-high-effort.json';

const RAW: unknown[] = [
  capstone,
  simvLowSupport,
  simvMixedBreaths,
  simvStacking,
  prvcPressureWithdrawal,
  prvcVolumeNotAchieved,
  prvcDoubleTrigger,
  aprvTlowTooLong,
  aprvReleaseCollision,
  aprvHighEffort,
  peepTrialRecruiter,
  peepTrialNonRecruiter,
  co2OverAssist,
  co2UnderAssist,
  normalPassive,
  ardsPulmonary,
  ardsExtrapulmonary,
  obesity,
  abdominalHypertension,
  copd,
  asthma,
  fibrosis,
  doubleTrigger,
  flowStarvation,
  ineffectiveEffort,
  reverseTrigger,
  autoTrigger,
  leakPsv,
  prematureCycling,
  copdAutoPeep,
  secretions,
  bronchospasm,
  pneumothorax,
  mainstem,
];

export const SCENARIOS: readonly ScenarioDef[] = (RAW as ScenarioDef[]).slice().sort((a, b) => a.order - b.order);

export function scenarioById(id: string): ScenarioDef {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}

/** Turn the JSON mechanics block into MechanicsParams overrides (resolving the recruitable recoil). */
export function resolveMechanics(phenotype: PhenotypeId, m: ScenarioMechanics | undefined): Partial<MechanicsParams> {
  if (!m) return {};
  const { recoil, ...rest } = m;
  const out: Partial<MechanicsParams> = { ...rest };
  if (recoil === 'recruitable') out.recoil = recruitableRecoil(phenotype);
  else if (recoil && typeof recoil === 'object') {
    const { kind: _kind, ...ov } = recoil;
    void _kind;
    out.recoil = recruitableRecoil(phenotype, ov);
  }
  return out;
}

export function resolveScenario(def: ScenarioDef): ScenarioSpec {
  const patient = presetPatient(def.phenotype, resolveMechanics(def.phenotype, def.mechanics));
  if (def.drive) patient.drive = { ...defaultDriveParams(), ...def.drive };
  if (def.balloon) patient.balloon = { ...defaultBalloon(), ...def.balloon };
  if (def.gas) patient.gas = { ...defaultGasParams(), ...def.gas };
  const base = defaultSettings(def.settings.mode);
  const settings: VentSettings = { ...base, ...def.settings, alarms: { ...base.alarms, ...(def.settings.alarms ?? {}) } };
  if (patient.balloon?.enabled) settings.esophagealBalloon = true;
  return { patient, settings, seed: def.seed };
}

export interface ScheduledAction {
  t: number;
  action: (engine: SimEngine) => void;
}

/** Apply a fix to a running engine (headless) — the UI sends the equivalent worker messages. */
export function applyFix(engine: SimEngine, fix: ScenarioFix): void {
  if (fix.settings) engine.vent.applySettings(fix.settings);
  if (fix.drive) engine.setDriveParams(fix.drive);
  if (fix.injectors) {
    for (const kind of INJECTOR_KINDS) {
      if (kind in fix.injectors) engine.injectors.set(kind, (fix.injectors[kind] ?? null));
    }
  }
}

/** Headless schedule: scenario injectors at their onset times, plus the scripted fix when requested. */
export function scenarioSchedule(def: ScenarioDef, opts: { withFix: boolean; fixAt?: number } = { withFix: false }): ScheduledAction[] {
  const out: ScheduledAction[] = [];
  for (const kind of INJECTOR_KINDS) {
    const spec = def.injectors?.[kind];
    if (!spec) continue;
    const { at, ...params } = spec;
    out.push({ t: at ?? 0, action: (e) => e.injectors.set(kind, params) });
  }
  const fix = def.fix;
  if (opts.withFix && fix) out.push({ t: opts.fixAt ?? fix.at, action: (e) => applyFix(e, fix) });
  return out.sort((a, b) => a.t - b.t);
}

/** Initial injector activations for the live app (onset times honoured by the controller). */
export function scenarioInjectorList(def: ScenarioDef): Array<{ kind: InjectorKind; at: number; params: Partial<InjectorParamMap[InjectorKind]> }> {
  const out: Array<{ kind: InjectorKind; at: number; params: Partial<InjectorParamMap[InjectorKind]> }> = [];
  for (const kind of INJECTOR_KINDS) {
    const spec = def.injectors?.[kind];
    if (!spec) continue;
    const { at, ...params } = spec;
    out.push({ kind, at: at ?? 0, params: params });
  }
  return out;
}
