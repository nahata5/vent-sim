/**
 * Central airway node solve (Spec §4.2 "closed-form node solves").
 *
 * Free compartments contribute conductance S = Σ 1/R_i and source term A = Σ Palv_i/R_i, so the total
 * airway flow is Q = S·P_int − A + Q_fixed, where Q_fixed is the sum of flows in compartments pinned
 * by expiratory flow limitation. The tube adds Paw = P_int + K1·Q + K2·Q|Q|. A leak at the Y-piece draws
 * Q_leak(Paw) so the ventilator-side flow is Qv = Q + Q_leak. Without a leak every case is closed-form;
 * with a leak the residual is monotone in Q and is solved by a bracketed secant/bisection.
 */
import type { AirwayBC } from '../types';
import { rohrerDrop } from '../math/rohrer';

export interface NodeInputs {
  s: number; // Σ 1/R_i over free compartments
  a: number; // Σ Palv_i/R_i over free compartments
  qFixed: number; // Σ flows of pinned compartments (signed, into compartment)
  k1: number; // tube + central linear resistance
  k2: number; // tube quadratic coefficient
  /** Leak flow as a function of Paw (L/s, ≥ 0), or null. */
  leak: ((paw: number) => number) | null;
}

export interface NodeSolution {
  q: number; // airway flow into the patient (past the leak)
  qv: number; // ventilator-side flow
  qLeak: number;
  pint: number;
  paw: number;
}

function pintOf(n: NodeInputs, q: number): number {
  return n.s > 0 ? (q - n.qFixed + n.a) / n.s : 0;
}

function pawOf(n: NodeInputs, q: number): number {
  return pintOf(n, q) + rohrerDrop(n.k1, n.k2, q);
}

/** Root of a monotone increasing residual on [lo, hi] with g(lo) ≤ 0 ≤ g(hi) (Illinois regula falsi). */
function solveMonotone(g: (q: number) => number, lo: number, hi: number): number {
  let glo = g(lo);
  let ghi = g(hi);
  if (glo >= 0) return lo;
  if (ghi <= 0) return hi;
  let side = 0;
  for (let i = 0; i < 60; i++) {
    const q = hi - (ghi * (hi - lo)) / (ghi - glo);
    const gq = g(q);
    if (Math.abs(gq) < 1e-10 || Math.abs(hi - lo) < 1e-12) return q;
    if (gq > 0) {
      hi = q;
      ghi = gq;
      if (side === 1) glo *= 0.5;
      side = 1;
    } else {
      lo = q;
      glo = gq;
      if (side === -1) ghi *= 0.5;
      side = -1;
    }
  }
  return 0.5 * (lo + hi);
}

export function solveNode(bc: AirwayBC, n: NodeInputs): NodeSolution {
  const finish = (q: number): NodeSolution => {
    const pint = pintOf(n, q);
    const paw = pint + rohrerDrop(n.k1, n.k2, q);
    const qLeak = n.leak ? n.leak(paw) : 0;
    return { q, qv: q + qLeak, qLeak, pint, paw };
  };
  const leak = n.leak;

  switch (bc.kind) {
    case 'occluded': {
      // Qv = 0 → Q = −Q_leak(Paw(Q)); residual g(Q) = Q + leak(Paw(Q)) is increasing in Q.
      if (!leak) return finish(0);
      const l0 = leak(pawOf(n, 0));
      return finish(solveMonotone((q) => q + leak(pawOf(n, q)), -l0 - 1e-9, 0));
    }
    case 'flow': {
      // Q = Qv − Q_leak(Paw(Q)); g(Q) = Q + leak(Paw(Q)) − Qv increasing in Q, root in [Qv − leak(Paw(Qv)), Qv].
      if (!leak) return finish(bc.qv);
      const lHi = leak(pawOf(n, bc.qv));
      return finish(solveMonotone((q) => q + leak(pawOf(n, q)) - bc.qv, bc.qv - lHi - 1e-9, bc.qv));
    }
    case 'pressure': {
      // Psrc − Rsrc·(Q + Q_leak) = P_int(Q) + Rohrer(Q). Closed form without leak (quadratic in Q).
      const kEff = n.k1 + bc.rsrc + (n.s > 0 ? 1 / n.s : 0);
      const c0 = pintOf(n, 0) - bc.psrc;
      let q: number;
      if (n.k2 > 0) {
        // k2·Q|Q| + kEff·Q + c0 = 0 → same closed form as Rohrer flow with ΔP = −c0.
        const dp = -c0;
        const mag = (-kEff + Math.sqrt(kEff * kEff + 4 * n.k2 * Math.abs(dp))) / (2 * n.k2);
        q = Math.sign(dp) * mag;
      } else {
        q = kEff > 0 ? -c0 / kEff : 0;
      }
      if (leak) {
        // g(Q) = Paw(Q) + Rsrc·(Q + leak(Paw(Q))) − Psrc is increasing; g(q_noLeak) ≥ 0. Expand downward.
        const g = (qq: number) => {
          const paw = pawOf(n, qq);
          return paw + bc.rsrc * (qq + leak(paw)) - bc.psrc;
        };
        let lo = q - 0.5;
        for (let i = 0; i < 20 && g(lo) > 0; i++) lo = q - (q - lo) * 2;
        q = solveMonotone(g, lo, q);
      }
      const sol = finish(q);
      // Valve limits: outside [qMin, qMax] the source degenerates to a flow source at the limit.
      const qMin = bc.qMin ?? -Infinity;
      const qMax = bc.qMax ?? Infinity;
      if (sol.qv < qMin) return solveNode({ kind: 'flow', qv: qMin }, n);
      if (sol.qv > qMax) return solveNode({ kind: 'flow', qv: qMax }, n);
      return sol;
    }
  }
}
