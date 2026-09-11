/**
 * Per-breath lung-stress metrics from TRUTH channels (Spec §6, Brief 2 §3–4): transpulmonary
 * pressures by compartment, strain, mechanical power by integration, muscle pressure, Pes swing and
 * pendelluft. Teaching displays and scoring only; the detector never reads these.
 */
import { k } from '../../config/constants';
import type { ChannelKey } from '../../worker/protocol';

export interface TruthReader {
  n: number;
  get(ch: ChannelKey, i: number): number;
}

export interface BreathIndices {
  iStart: number;
  iInspEnd: number;
  iEnd: number;
  frc: number; // L
  rr: number; // /min, for power
  /** Sample rate of the reader (Hz); enables the OCCLUSION_SMOOTHING moving average on Pes for ΔPes. */
  fs?: number;
}

export interface TruthBreathMetrics {
  plEI: { nd: number; d: number };
  plEE: { nd: number; d: number };
  /** Static transpulmonary driving pressure: max over compartments of PL,ei − PL,ee. */
  dPL: number;
  /** Dynamic ΔPL: peak PL − PL,ee (worst compartment) over the whole breath. */
  dPLdyn: number;
  vt: number; // L (true inspired)
  eelv: number; // L
  strain: number;
  /** ∫Paw·dV over inspiration, cmH2O·L. */
  energy: number;
  /** ∫PL·dV over inspiration (volume-weighted PL), cmH2O·L. */
  lungEnergy: number;
  powerTruth: number; // J/min
  lungPower: number; // J/min
  pmusPeak: number;
  dPes: number;
  pendelluft: boolean;
}

/** ∫ P dV from index i0 to i1 (trapezoid), cmH2O·L. */
export function breathEnergy(p: ArrayLike<number>, v: ArrayLike<number>, i0: number, i1: number): number {
  let e = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    const dv = (v[i] ?? 0) - (v[i - 1] ?? 0);
    e += 0.5 * ((p[i] ?? 0) + (p[i - 1] ?? 0)) * dv;
  }
  return e;
}

export function truthBreathMetrics(r: TruthReader, b: BreathIndices): TruthBreathMetrics {
  const iS = Math.max(0, b.iStart);
  const iI = Math.min(r.n - 1, Math.max(iS, b.iInspEnd));
  const iE = Math.min(r.n - 1, Math.max(iI, b.iEnd));
  const g = (ch: ChannelKey, i: number) => r.get(ch, i);
  const plEE = { nd: g('truth.plND', iS), d: g('truth.plD', iS) };
  const plEI = { nd: g('truth.plND', iI), d: g('truth.plD', iI) };
  let vMax = -Infinity;
  let plMaxND = -Infinity;
  let plMaxD = -Infinity;
  let pmusPeak = 0;
  let pesMax = -Infinity;
  let pesMin = Infinity;
  let pendelluft = false;
  let energy = 0;
  let lungEnergy = 0;
  const v0 = g('truth.vlung', iS);
  // ΔPes is read on Pes averaged over OCCLUSION_SMOOTHING, as the occlusion test does, so the cardiac
  // artifact does not inflate the swing (D-016).
  const win = b.fs ? Math.max(1, Math.round(k('OCCLUSION_SMOOTHING') * b.fs)) : 1;
  const pesHist: number[] = [];
  let pesSum = 0;
  for (let i = iS; i <= iE; i++) {
    const v = g('truth.vlung', i);
    vMax = Math.max(vMax, v);
    plMaxND = Math.max(plMaxND, g('truth.plND', i));
    plMaxD = Math.max(plMaxD, g('truth.plD', i));
    pmusPeak = Math.max(pmusPeak, g('truth.pmus', i));
    pesHist.push(g('pes', i));
    pesSum += g('pes', i);
    if (pesHist.length > win) pesSum -= pesHist.shift() ?? 0;
    if (pesHist.length === win) {
      const pes = pesSum / win;
      pesMax = Math.max(pesMax, pes);
      pesMin = Math.min(pesMin, pes);
    }
    const qND = g('truth.qND', i);
    const qD = g('truth.qD', i);
    if ((qND < -0.01 && qD > 0.01) || (qD < -0.01 && qND > 0.01)) pendelluft = true;
    if (i > iS && i <= iI) {
      const dv = v - g('truth.vlung', i - 1);
      energy += 0.5 * (g('truth.paw', i) + g('truth.paw', i - 1)) * dv;
      const pl = 0.5 * (g('truth.plND', i) + g('truth.plD', i));
      const plPrev = 0.5 * (g('truth.plND', i - 1) + g('truth.plD', i - 1));
      lungEnergy += 0.5 * (pl + plPrev) * dv;
    }
  }
  const vt = Math.max(0, vMax - v0);
  const eelv = b.frc + v0;
  const j = k('J_PER_CMH2O_L');
  return {
    plEI,
    plEE,
    dPL: Math.max(plEI.nd - plEE.nd, plEI.d - plEE.d),
    dPLdyn: Math.max(plMaxND - plEE.nd, plMaxD - plEE.d),
    vt,
    eelv,
    strain: eelv > 0 ? vt / eelv : NaN,
    energy,
    lungEnergy,
    powerTruth: j * b.rr * energy,
    lungPower: j * b.rr * lungEnergy,
    pmusPeak,
    dPes: pesMax - pesMin,
    pendelluft,
  };
}
