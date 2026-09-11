/**
 * SCHEMATIC SpO2 (Spec §4.6 stretch goal). Display only: the physics never reads it, and the mapping is a
 * teaching sketch, not a validated gas-exchange model. Steps:
 *   1. Alveolar gas equation: PAO2 = FiO2·(PB − PH2O) − PaCO2/RQ.
 *   2. Effective shunt Qs/Qt = base·(1/(1 + Pmean/MPAW_HALF)) + PER_CLOSED·(1 − open fraction), clamped.
 *   3. Shunt equation with a fixed a–v content difference: CaO2 = CcO2 − s·avDiff/(1 − s).
 *   4. Invert the O2 content to PaO2 on the Severinghaus (1979) dissociation curve; SpO2 = SaO2.
 */
import { k } from '../config/constants';

export interface Spo2Inputs {
  fio2: number; // fraction
  /** Aerated fraction of lung units at end-expiration (1 for a lung without recruitable units). */
  openFraction: number;
  meanPaw: number; // cmH2O
  paCO2: number; // mmHg
  /** Base venous admixture with every modelled unit open (default SPO2_SHUNT_BASE). */
  shunt?: number;
}

export interface Spo2Readout {
  spo2: number; // %
  paO2: number; // mmHg
  shunt: number; // effective Qs/Qt
  schematic: true;
}

/** Severinghaus 1979: SaO2 = 1 / (23400 / (PO2³ + 150·PO2) + 1). */
export function severinghaus(pO2: number): number {
  const p = Math.max(0, pO2);
  return 1 / (23400 / (p * p * p + 150 * p) + 1);
}

function o2Content(pO2: number): number {
  return 1.34 * k('SPO2_HB') * severinghaus(pO2) + 0.003 * pO2;
}

export function spo2Schematic(inp: Spo2Inputs): Spo2Readout {
  const pAO2 = Math.max(0, inp.fio2 * (k('SPO2_PB') - k('SPO2_PH2O')) - inp.paCO2 / k('SPO2_RQ'));
  const base = (inp.shunt ?? k('SPO2_SHUNT_BASE')) / (1 + Math.max(0, inp.meanPaw) / k('SPO2_MPAW_HALF'));
  const closed = k('SPO2_SHUNT_PER_CLOSED') * (1 - Math.min(1, Math.max(0, inp.openFraction)));
  const shunt = Math.min(k('SPO2_SHUNT_MAX'), Math.max(0, base + closed));
  const ccO2 = o2Content(pAO2);
  const caO2 = Math.max(0, ccO2 - (shunt * k('SPO2_AV_DIFF')) / (1 - shunt));
  // Bisection on the monotone content curve.
  let lo = 0;
  let hi = pAO2;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (o2Content(mid) < caO2) lo = mid;
    else hi = mid;
  }
  const paO2 = 0.5 * (lo + hi);
  return { spo2: 100 * severinghaus(paO2), paO2, shunt, schematic: true };
}
