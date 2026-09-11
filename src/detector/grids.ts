/**
 * Tuning and held-out grids for detector scoring (Spec §9.5). The tuning grid (seeds < 100) is used by
 * scripts/tune-detector.ts to set thresholds; the held-out grid (seeds ≥ 100, perturbed settings) is
 * scored by tests/detector/heldout.test.ts and the Validation page. The two share no seed.
 */
import { runHeadless } from '../sim/headless';
import { labelRun } from '../sim/truth/labeler';
import { resolveScenario, scenarioById, scenarioSchedule } from '../edu/scenarios';
import type { VentSettings } from '../sim/vent/settings';
import type { DriveParams } from '../sim/patient/neural-drive';
import { detectRun } from './detector';
import type { ScoredCase } from './scorer';

export interface GridCase {
  id: string;
  scenario: string;
  seed: number;
  settings?: Partial<VentSettings>;
  drive?: Partial<DriveParams>;
  duration?: number;
}

const SCENARIO_IDS = [
  'normal-passive',
  'ards-pulmonary',
  'copd',
  'fibrosis',
  'double-trigger',
  'flow-starvation',
  'ineffective-effort',
  'reverse-trigger',
  'auto-trigger',
  'leak-psv',
  'premature-cycling',
  'copd-auto-peep',
  'secretions',
  'bronchospasm',
  'pneumothorax',
  'mainstem',
] as const;

/** Scenarios with few breaths per run (long cycles) get extra seeds so every pattern has enough positives. */
const EXTRA_SEEDS: Record<string, number> = { 'ineffective-effort': 2, 'reverse-trigger': 1, 'auto-trigger': 1 };

function grid(seeds: number[], perturb: (scenario: string, i: number) => Pick<GridCase, 'settings' | 'drive'>): GridCase[] {
  const out: GridCase[] = [];
  for (const s of SCENARIO_IDS) {
    const extra = EXTRA_SEEDS[s] ?? 0;
    const all = [...seeds, ...Array.from({ length: extra }, (_, j) => (seeds[seeds.length - 1] ?? 0) + j + 1)];
    all.forEach((seed, i) => out.push({ id: `${s}#${seed}`, scenario: s, seed, ...perturb(s, i % 2) }));
  }
  return out;
}

export const TUNING_GRID: GridCase[] = grid([1, 2], () => ({}));

/** Held-out: new seeds and mild setting / drive perturbations the thresholds never saw. */
export const HELD_OUT_GRID: GridCase[] = grid([101, 102], (scenario, i) => {
  const alt = i === 1;
  switch (scenario) {
    case 'double-trigger':
      return { settings: alt ? { peakFlow: 55, vt: 400 } : { rr: 14 }, drive: alt ? { pmax: 12 } : { ti: 1.2 } };
    case 'flow-starvation':
      return { settings: alt ? { peakFlow: 35 } : { vt: 450 }, drive: alt ? { pmax: 10 } : { pmax: 14 } };
    case 'ineffective-effort':
      return { settings: alt ? { ps: 14 } : { ets: 0.15 }, drive: alt ? { rate: 20 } : { pmax: 4.5 } };
    case 'reverse-trigger':
      return { settings: alt ? { rr: 16 } : { peakFlow: 50 }, drive: alt ? { pmax: 7 } : { entrainment: { ratio: 1, delay: 0.5, jitter: 0.03 } } };
    case 'auto-trigger':
      return { settings: alt ? { ps: 10 } : { flowTrigger: 1.5 } };
    case 'leak-psv':
      return { settings: alt ? { ps: 12 } : { peep: 6 } };
    case 'premature-cycling':
      return { settings: alt ? { ets: 0.5 } : { ps: 10 }, drive: alt ? { ti: 1.1 } : {} };
    case 'copd-auto-peep':
      return { settings: alt ? { rr: 22 } : { vt: 550 } };
    case 'copd':
      return { settings: alt ? { ps: 12 } : { ets: 0.3 } };
    case 'fibrosis':
      return { settings: alt ? { pinsp: 14 } : { rr: 20 } };
    case 'ards-pulmonary':
      return { settings: alt ? { vt: 400, rr: 26 } : { peep: 10 } };
    default:
      return alt ? { settings: { rr: 16 } } : {};
  }
});

export function runCase(c: GridCase): ScoredCase {
  const def = scenarioById(c.scenario);
  const spec = resolveScenario(def);
  const settings = { ...spec.settings, ...(c.settings ?? {}) };
  const patient = { ...spec.patient };
  if (c.drive && patient.drive) patient.drive = { ...patient.drive, ...c.drive };
  const duration = c.duration ?? 90;
  const res = runHeadless({ patient, settings, seed: c.seed, duration, schedule: scenarioSchedule(def) });
  const injectorOnset = Math.max(0, ...Object.values(def.injectors ?? {}).map((v) => v.at ?? 0));
  return { id: c.id, truth: labelRun(res), det: detectRun(res), tFrom: Math.max(10, injectorOnset + 8), tTo: duration - 2 };
}

export function runGrid(cases: GridCase[]): ScoredCase[] {
  return cases.map(runCase);
}
