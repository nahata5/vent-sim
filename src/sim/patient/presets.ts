/**
 * Phenotype presets reproducing Brief 2 Table 1 (partition) and Brief 1 §1.4 (resistance, τ).
 *
 * Each preset gives EL, Ecw, R, FRC, the mean pleural pressure at FRC (from the Table 1 Pes column
 * after removing the +3 mediastinal offset and ≈2 cmH2O balloon wall pressure), the vertical pleural
 * gradient, the regional Pmus transmission α, and the Venegas shape (anchor position s0, width d). The
 * asymptotes and inflection are solved so that the lung elastance at FRC (zero PEEP, passive) equals the
 * Table 1 EL and the recoil anchor is PL0 = −Ppl0 (docs/DECISIONS.md D-003, D-005). Shapes were chosen
 * so the static Ers at PEEP 5 stays within Table 1 tolerance and the PEEP 0 → 15 change reproduces the
 * Gattinoni 1998 direction (pulmonary 25.4 → 31.2 up; extrapulmonary 25.9 → 21.4 down).
 */
import { k } from '../../config/constants';
import type { MechanicsParams, PatientParams } from './params';
import type { RecruitableSpec } from './lung-recruitable';

export type PhenotypeId =
  | 'normal'
  | 'ards-pulmonary'
  | 'ards-extrapulmonary'
  | 'obesity'
  | 'abdominal-hypertension'
  | 'copd'
  | 'asthma'
  | 'fibrosis';

export interface Phenotype {
  id: PhenotypeId;
  label: string;
  el: number; // cmH2O/L
  ecw: number; // cmH2O/L
  /** Total inspiratory resistance including the tube at 0.5 L/s (Arnal 2018 convention), cmH2O/(L/s). */
  rTotalInsp: number;
  /** Expiratory peripheral resistance multiplier (COPD Rexp > Rinsp). */
  rExpFactor: number;
  frc: number; // L
  pplOffset: number; // cmH2O
  gradient: number; // cmH2O/cm
  height: number; // cm
  alpha: [number, number];
  /**
   * Venegas shape: s0 = position of FRC on the sigmoid (fraction of span already inflated at zero PEEP;
   * < 0.5 → compliance rises with PEEP (recruitable), > 0.5 → falls (consolidated/overdistending)) and the
   * width d (cmH2O). The asymptotes follow from EL: b = d/(EL·s0·(1−s0)), a = −s0·b.
   */
  venegasS0: number;
  venegasD: number;
  viscoelasticR2: number; // cmH2O/(L/s)
  efl: { k: number; vClose: number } | null;
  pbw: number; // kg
  source: string;
}

const ETT = { k1: k('ETT_K1'), k2: k('ETT_K2') };
const R_CENTRAL = k('R_CENTRAL_DEFAULT');
/** Tube + central drop per unit flow at the Arnal reference flow, so peripheral R = total − this. */
function tubeAndCentralAtRef(): number {
  const q = k('R_REFERENCE_FLOW');
  return ETT.k1 + ETT.k2 * q + R_CENTRAL;
}

export const PRESETS: Record<PhenotypeId, Phenotype> = {
  normal: {
    id: 'normal',
    label: 'Normal (anesthetized)',
    el: 9.4,
    ecw: 5.2,
    rTotalInsp: 13,
    rExpFactor: 1,
    frc: 1.6,
    pplOffset: -2,
    gradient: 0.25,
    height: 17,
    alpha: [1, 1],
    venegasS0: 0.4,
    venegasD: 10,
    viscoelasticR2: 2.0,
    efl: null,
    pbw: 70,
    source: 'Brief 2 Table 1 (Pelosi 1996 [V], Behazin 2010 [V]); Brief 1 §1.4 Arnal 2018 R [V]; FRC 1.6 [M, D-004]',
  },
  'ards-pulmonary': {
    id: 'ards-pulmonary',
    label: 'ARDS, pulmonary (consolidated)',
    el: 20.2,
    ecw: 5.2,
    rTotalInsp: 12,
    rExpFactor: 1,
    frc: 0.7,
    pplOffset: 8,
    gradient: 0.5,
    height: 17,
    alpha: [0.65, 1.35],
    venegasS0: 0.45,
    venegasD: 16,
    viscoelasticR2: 4.0,
    efl: null,
    pbw: 70,
    source: 'Brief 2 Table 1 Gattinoni 1998 [V]; FRC 0.7 [L]; Ppl0 [M from Pes 10–20]; gradient 0.5 [M]; α Yoshida 2013 [M]',
  },
  'ards-extrapulmonary': {
    id: 'ards-extrapulmonary',
    label: 'ARDS, extrapulmonary (recruitable)',
    el: 13.8,
    ecw: 12.1,
    rTotalInsp: 12,
    rExpFactor: 1,
    frc: 1.1,
    pplOffset: 12,
    gradient: 0.5,
    height: 17,
    alpha: [0.65, 1.35],
    venegasS0: 0.2,
    venegasD: 10,
    viscoelasticR2: 3.0,
    efl: null,
    pbw: 70,
    source: 'Brief 2 Table 1 Gattinoni 1998 [V]; FRC 1.1 [L]; Ppl0 [M from Pes 15–25]; Venegas recruitable shape [M]',
  },
  obesity: {
    id: 'obesity',
    label: 'Morbid obesity',
    el: 20,
    ecw: 8,
    rTotalInsp: 17,
    rExpFactor: 1,
    frc: 0.67,
    pplOffset: 7,
    gradient: 0.3,
    height: 20,
    alpha: [1, 1],
    venegasS0: 0.35,
    venegasD: 8,
    viscoelasticR2: 3.0,
    efl: null,
    pbw: 70,
    source: 'Brief 2 §1.1 recommendation (high Ppl0, low EELV, high EL, Ecw 7–10): Pelosi 1996 [V], Behazin 2010 [V]; R: Pelosi lung R 4.7 vs 1.0 [V]',
  },
  'abdominal-hypertension': {
    id: 'abdominal-hypertension',
    label: 'Intra-abdominal hypertension',
    el: 10,
    ecw: 15,
    rTotalInsp: 13,
    rExpFactor: 1,
    frc: 1.2,
    pplOffset: 10,
    gradient: 0.3,
    height: 17,
    alpha: [1, 1],
    venegasS0: 0.35,
    venegasD: 8,
    viscoelasticR2: 2.5,
    efl: null,
    pbw: 70,
    source: 'Brief 2 Table 1 IAH row [L/M]: Ecw 10–20+, EL/Ers 0.4–0.6, high Ppl0',
  },
  copd: {
    id: 'copd',
    label: 'COPD',
    el: 6,
    ecw: 5,
    rTotalInsp: 22,
    rExpFactor: 2.0,
    frc: 3.0,
    pplOffset: -1,
    gradient: 0.25,
    height: 17,
    alpha: [1, 1],
    venegasS0: 0.5,
    venegasD: 10,
    viscoelasticR2: 2.0,
    efl: { k: 0.6, vClose: -0.4 },
    pbw: 70,
    source: 'Brief 2 Table 1 COPD row [L/M]; Brief 1 §1.4 Arnal COPD R 22, τE 1.07 [V]; Rexp/Rinsp ≈ 2 (van Diepen 14/6.5) [V]; EFL [M]',
  },
  asthma: {
    id: 'asthma',
    label: 'Status asthmaticus',
    el: 8,
    ecw: 5,
    rTotalInsp: 40,
    rExpFactor: 1.5,
    frc: 2.5,
    pplOffset: -1,
    gradient: 0.25,
    height: 17,
    alpha: [1, 1],
    venegasS0: 0.45,
    venegasD: 10,
    viscoelasticR2: 2.0,
    efl: { k: 0.5, vClose: -0.3 },
    pbw: 70,
    source: 'Brief 1 §1.4 extra presets [uncertain]: R 30–60 plus EFL, PEEPi 10–20 at inappropriate settings',
  },
  fibrosis: {
    id: 'fibrosis',
    label: 'Pulmonary fibrosis',
    el: 29,
    ecw: 5,
    rTotalInsp: 10,
    rExpFactor: 1,
    frc: 1.2,
    pplOffset: 0,
    gradient: 0.3,
    height: 17,
    alpha: [1, 1],
    venegasS0: 0.55,
    venegasD: 10,
    viscoelasticR2: 4.0,
    efl: null,
    pbw: 70,
    source: 'Brief 1 §1.4 van Diepen fibrosis Ctot 29 mL/cmH2O, R 2.1 lung-only [V]; Ecw/FRC [M]',
  },
};

/**
 * Venegas parameters from the phenotype anchor (docs/DECISIONS.md D-005). With s = 1/(1 + e^(−(P−c)/d)),
 * compliance is C(P) = (b/d)·s·(1 − s). Fixing the anchor position s0 and width d, the elastance at FRC
 * equals EL when b = d/(EL·s0·(1 − s0)); the lower asymptote is a = −s0·b (V = 0 sits at fraction s0 of
 * the span) and c = PL0 + d·ln(1/s0 − 1) puts the curve through (V = 0, PL0).
 */
export function venegasFromAnchor(
  el: number,
  pl0: number,
  s0: number,
  d: number,
): { a: number; b: number; c: number; d: number } {
  const b = d / (el * s0 * (1 - s0));
  const a = -s0 * b;
  const c = pl0 + d * Math.log(1 / s0 - 1);
  return { a, b, c, d };
}

export function presetMechanics(id: PhenotypeId, overrides: Partial<MechanicsParams> = {}): MechanicsParams {
  const p = PRESETS[id];
  const rPeriph = Math.max(2, p.rTotalInsp - tubeAndCentralAtRef());
  const venegas = venegasFromAnchor(p.el, -p.pplOffset, p.venegasS0, p.venegasD);
  const tauVe = k('VISCOELASTIC_TAU');
  return {
    el: p.el,
    ecw: p.ecw,
    rInsp: rPeriph,
    rExp: rPeriph * p.rExpFactor,
    rCentral: R_CENTRAL,
    ett: { ...ETT },
    frc: p.frc,
    pplOffset: p.pplOffset,
    gradient: p.gradient,
    height: p.height,
    compartments: [
      { fraction: 0.5, alpha: p.alpha[0] },
      { fraction: 0.5, alpha: p.alpha[1] },
    ],
    viscoelastic: { r2: p.viscoelasticR2, e2: p.viscoelasticR2 / tauVe },
    efl: p.efl,
    recoil: { kind: 'venegas', ...venegas },
    pbw: p.pbw,
    ...overrides,
  };
}

/**
 * Recruitable-population recoil for a phenotype (Spec §4.3; the Venegas anchor is the default, this is the
 * M7 alternative selected per scenario). Opening pressures live on the recoil axis (pressure above the
 * compartment's FRC anchor), see lung-recruitable.ts.
 */
export function recruitableRecoil(id: PhenotypeId, overrides: Partial<Omit<RecruitableSpec, 'kind'>> = {}): RecruitableSpec {
  return { ...recruitableRecoilBase(id), ...overrides };
}

function recruitableRecoilBase(id: PhenotypeId): RecruitableSpec {
  const base = {
    kind: 'recruitable' as const,
    n: k('RECRUIT_UNITS'),
    topSd: k('RECRUIT_TOP_SD'),
    closeDelta: k('RECRUIT_CLOSE_DELTA'),
    kOpen: k('RECRUIT_K_OPEN'),
    kClose: k('RECRUIT_K_CLOSE'),
    strainCap: k('RECRUIT_STRAIN_CAP'),
    odGain: k('RECRUIT_OD_GAIN'),
  };
  if (id === 'ards-extrapulmonary') return { ...base, recruitableFraction: k('RECRUIT_EXTRAPULMONARY_FRACTION'), topMean: k('RECRUIT_EXTRAPULMONARY_TOP'), topSd: k('RECRUIT_EXTRAPULMONARY_TOP_SD') };
  if (id === 'ards-pulmonary') return { ...base, recruitableFraction: k('RECRUIT_PULMONARY_FRACTION'), topMean: k('RECRUIT_PULMONARY_TOP'), topSd: k('RECRUIT_PULMONARY_TOP_SD'), strainCap: k('RECRUIT_PULMONARY_STRAIN_CAP') };
  return { ...base, recruitableFraction: k('RECRUIT_DEFAULT_FRACTION'), topMean: k('RECRUIT_DEFAULT_TOP') };
}

export function presetPatient(id: PhenotypeId, overrides: Partial<MechanicsParams> = {}): PatientParams {
  return { mechanics: presetMechanics(id, overrides) };
}

export const PHENOTYPE_IDS = Object.keys(PRESETS) as PhenotypeId[];
