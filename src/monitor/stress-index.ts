/**
 * Stress index (Brief 2 §2.3; Ranieri 2000, Grasso 2004): on a passive constant-flow inflation, fit
 * Paw(t) = a·t^b + c from just after the resistive step to end-inspiration. With constant flow the resistive
 * term is a constant, so b reflects dE/dV alone: b < 0.9 tidal recruitment, b > 1.1 overdistension.
 * Measured signals only; the eligibility checks (machine-triggered, constant flow) are made by the monitor.
 */
import { k } from '../config/constants';

export interface StressIndexFit {
  a: number;
  b: number;
  c: number;
  /** Root-mean-square residual, cmH2O. */
  rms: number;
  n: number;
}

/**
 * Fit a·t^b + c by a grid search on the offset c (each candidate gives a closed-form log–log regression for
 * a and b); the candidate with the smallest residual in pressure space wins. `t` is time from the start of
 * inspiration, s; samples must lie after the resistive step.
 */
export function stressIndexFit(t: readonly number[], paw: readonly number[]): StressIndexFit | null {
  const n = Math.min(t.length, paw.length);
  if (n < 8) return null;
  let pMin = Infinity;
  for (let i = 0; i < n; i++) pMin = Math.min(pMin, paw[i] ?? Infinity);
  const cHi = pMin - 0.05;
  const cLo = pMin - 8;
  let best: StressIndexFit | null = null;
  const steps = 64;
  for (let s = 0; s <= steps; s++) {
    const c = cLo + ((cHi - cLo) * s) / steps;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
    for (let i = 0; i < n; i++) {
      const tt = t[i] ?? 0;
      const y = (paw[i] ?? 0) - c;
      if (tt <= 0 || y <= 0) continue;
      const lx = Math.log(tt);
      const ly = Math.log(y);
      sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; m += 1;
    }
    if (m < 8) continue;
    const denom = m * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) continue;
    const b = (m * sxy - sx * sy) / denom;
    const lnA = (sy - b * sx) / m;
    const a = Math.exp(lnA);
    let sse = 0;
    for (let i = 0; i < n; i++) {
      const tt = t[i] ?? 0;
      const pred = a * Math.pow(Math.max(tt, 1e-9), b) + c;
      const d = (paw[i] ?? 0) - pred;
      sse += d * d;
    }
    const rms = Math.sqrt(sse / n);
    if (best === null || rms < best.rms) best = { a, b, c, rms, n };
  }
  return best;
}

/** Eligibility on measured flow: constant-flow inflation (coefficient of variation of the flow plateau). */
export function isConstantFlow(flow: readonly number[]): boolean {
  const n = flow.length;
  if (n < 8) return false;
  let mean = 0;
  for (const q of flow) mean += q;
  mean /= n;
  if (mean <= 0.05) return false;
  let ss = 0;
  for (const q of flow) ss += (q - mean) * (q - mean);
  const cv = Math.sqrt(ss / n) / mean;
  return cv < k('STRESS_INDEX_FLOW_CV');
}
