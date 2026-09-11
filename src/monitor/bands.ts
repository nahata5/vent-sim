/**
 * Lung-stress dashboard bands (Spec §6, Brief 2 §6 threshold table). Every limit is a cited constant;
 * each metric carries its source so the UI can show it in a tooltip. Bedside mechanical-power
 * surrogates (Brief 2 §3) live here too because they use measured values only.
 */
import { CONSTANTS, k, type ConstantKey } from '../config/constants';
import type { Mode } from '../sim/types';

export type Band = 'ok' | 'warn' | 'danger' | 'none';

export type StressMetricId =
  | 'dp'
  | 'dpl'
  | 'dplDyn'
  | 'plEI'
  | 'plEE'
  | 'strain'
  | 'power'
  | 'pplat'
  | 'p01'
  | 'pmus'
  | 'dpes'
  | 'pocc'
  | 'pmi'
  | 'vtPbw'
  | 'stressIndex'
  | 'ri'
  | 'recruited';

export interface MetricDef {
  id: StressMetricId;
  label: string;
  unit: string;
  /** Threshold constants used by the band rule, for the tooltip. */
  refs: ConstantKey[];
  band: (v: number) => Band;
  /** True when the value can only come from truth channels or Pes. */
  truthOnly?: boolean;
}

const above = (v: number, warn: number, danger: number): Band => (v > danger ? 'danger' : v > warn ? 'warn' : 'ok');

export const METRICS: Record<StressMetricId, MetricDef> = {
  dp: { id: 'dp', label: 'Driving pressure ΔP', unit: 'cmH2O', refs: ['DP_LIMIT'], band: (v) => (v > k('DP_LIMIT') ? 'danger' : 'ok') },
  dpl: { id: 'dpl', label: 'Transpulmonary ΔPL', unit: 'cmH2O', refs: ['DPL_WARN', 'DPL_LIMIT'], band: (v) => above(v, k('DPL_WARN'), k('DPL_LIMIT')), truthOnly: true },
  dplDyn: { id: 'dplDyn', label: 'Dynamic ΔPL (assisted)', unit: 'cmH2O', refs: ['DPL_DYN_LIMIT'], band: (v) => (v > k('DPL_DYN_LIMIT') ? 'danger' : 'ok'), truthOnly: true },
  plEI: { id: 'plEI', label: 'End-inspiratory PL', unit: 'cmH2O', refs: ['PL_EI_WARN', 'PL_EI_LIMIT'], band: (v) => above(v, k('PL_EI_WARN'), k('PL_EI_LIMIT')), truthOnly: true },
  plEE: {
    id: 'plEE',
    label: 'End-expiratory PL',
    unit: 'cmH2O',
    refs: ['PL_EE_MIN', 'PL_EE_MAX'],
    band: (v) => (v < k('PL_EE_MIN') ? 'danger' : v > k('PL_EE_MAX') ? 'warn' : 'ok'),
    truthOnly: true,
  },
  strain: { id: 'strain', label: 'Strain Vt/EELV', unit: '', refs: ['STRAIN_LIMIT'], band: (v) => (v > k('STRAIN_LIMIT') ? 'danger' : 'ok'), truthOnly: true },
  power: { id: 'power', label: 'Mechanical power', unit: 'J/min', refs: ['MP_LIMIT'], band: (v) => (v > k('MP_LIMIT') ? 'danger' : 'ok') },
  pplat: { id: 'pplat', label: 'Plateau pressure', unit: 'cmH2O', refs: ['PPLAT_LIMIT'], band: (v) => (v > k('PPLAT_LIMIT') ? 'danger' : 'ok') },
  p01: {
    id: 'p01',
    label: 'P0.1',
    unit: 'cmH2O',
    refs: ['P01_LOW', 'P01_HIGH'],
    band: (v) => (v > k('P01_HIGH') ? 'danger' : v < k('P01_LOW') ? 'warn' : 'ok'),
  },
  pmus: {
    id: 'pmus',
    label: 'Pmus (true peak)',
    unit: 'cmH2O',
    refs: ['PMUS_LOW', 'PMUS_HIGH'],
    band: (v) => (v > k('PMUS_HIGH') ? 'danger' : v < k('PMUS_LOW') ? 'warn' : 'ok'),
    truthOnly: true,
  },
  dpes: {
    id: 'dpes',
    label: 'ΔPes',
    unit: 'cmH2O',
    refs: ['DPES_LOW', 'DPES_HIGH'],
    band: (v) => (v > k('DPES_HIGH') ? 'danger' : v < k('DPES_LOW') ? 'warn' : 'ok'),
  },
  pocc: { id: 'pocc', label: 'ΔPocc', unit: 'cmH2O', refs: ['POCC_LIMIT'], band: (v) => (v < k('POCC_LIMIT') ? 'danger' : 'ok') },
  pmi: { id: 'pmi', label: 'PMI', unit: 'cmH2O', refs: ['PMI_LIMIT'], band: (v) => (v > k('PMI_LIMIT') ? 'danger' : 'ok') },
  vtPbw: {
    id: 'vtPbw',
    label: 'Vt per kg PBW',
    unit: 'mL/kg',
    refs: ['VT_PBW_LOW', 'VT_PBW_HIGH'],
    band: (v) => (v > k('VT_PBW_HIGH') ? 'danger' : v < k('VT_PBW_LOW') ? 'warn' : 'ok'),
  },
  stressIndex: {
    id: 'stressIndex',
    label: 'Stress index',
    unit: '',
    refs: ['STRESS_INDEX_LOW', 'STRESS_INDEX_HIGH'],
    band: (v) => (v > k('STRESS_INDEX_HIGH') || v < k('STRESS_INDEX_LOW') ? 'warn' : 'ok'),
  },
  ri: { id: 'ri', label: 'R/I ratio', unit: '', refs: ['RI_THRESHOLD'], band: (v) => (v >= k('RI_THRESHOLD') ? 'warn' : 'ok') },
  recruited: { id: 'recruited', label: 'Recruited volume', unit: 'mL', refs: ['LABEL_TIDAL_RECRUIT_UNITS'], band: () => 'none', truthOnly: true },
};

export function bandFor(id: StressMetricId, value: number | null | undefined): Band {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'none';
  return METRICS[id].band(value);
}

/** Tooltip text: each threshold with its value, unit and source. */
export function metricCitation(id: StressMetricId): string {
  return METRICS[id].refs.map((key) => {
    const c = CONSTANTS[key];
    return `${String(c.value)} ${c.unit}: ${c.source} [${c.confidence}]`;
  }).join('\n');
}

export interface PowerInputs {
  mode: Mode;
  rr: number;
  vtL: number;
  ppeak: number;
  peep: number;
  dp: number | null;
  peakFlowLpm?: number;
  /** Measured respiratory-system elastance (cmH2O/L), airway resistance (cmH2O/(L/s)) and I:E ratio
   *  (Ti/Te) for the Gattinoni 2016 full formula; omitted or non-finite → simplified form. */
  ers?: number;
  raw?: number;
  ie?: number;
}

export interface FullPowerInputs {
  rr: number;
  vtL: number;
  ers: number;
  raw: number;
  /** I:E as Ti/Te. */
  ie: number;
  peep: number;
}

/**
 * Gattinoni 2016 full volume-control formula (Brief 2 §3):
 *   MP = 0.098·RR·{Vt²·[½·Ers + RR·(1 + I:E)/(60·I:E)·Raw] + Vt·PEEP}
 * The bracket is the elastic, resistive and PEEP energy of one square-flow breath of a linear lung
 * (Q = Vt/Ti with Ti = 60/RR·I:E/(1 + I:E)), so it equals ∫Paw·dV there.
 */
export function gattinoniFullPower(p: FullPowerInputs): number {
  const flowTerm = (p.rr * (1 + p.ie)) / (60 * p.ie);
  return k('J_PER_CMH2O_L') * p.rr * (p.vtL * p.vtL * (0.5 * p.ers + flowTerm * p.raw) + p.vtL * p.peep);
}

/**
 * Bedside mechanical-power surrogate (Brief 2 §3): Gattinoni 2016 full formula for VC when Ers, Raw and
 * I:E are measured, Gattinoni simplified for VC when only a plateau exists, Giosa 2019 for VC without
 * one, Becher 2019 simplified for pressure-targeted breaths. J/min.
 */
export function powerSurrogate(p: PowerInputs): number {
  const j = k('J_PER_CMH2O_L');
  if (p.mode === 'VC-AC') {
    const full = p.ers !== undefined && p.raw !== undefined && p.ie !== undefined && Number.isFinite(p.ers) && Number.isFinite(p.raw) && Number.isFinite(p.ie) && p.ie > 0;
    if (full) return gattinoniFullPower({ rr: p.rr, vtL: p.vtL, ers: p.ers as number, raw: p.raw as number, ie: p.ie as number, peep: p.peep });
    if (p.dp !== null) return j * p.rr * p.vtL * (p.ppeak - 0.5 * p.dp);
    const ve = p.rr * p.vtL;
    const f = p.peakFlowLpm ?? p.vtL * p.rr * 3;
    return (ve * (p.ppeak + p.peep + f / 6)) / 20;
  }
  return j * p.rr * p.vtL * (p.ppeak - p.peep + p.peep);
}
