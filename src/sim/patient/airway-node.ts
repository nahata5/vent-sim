/**
 * Central airway node solve (Spec §4.2 "closed-form node solves").
 *
 * Free compartments contribute conductance S = Σ 1/R_i and source term A = Σ Palv_i/R_i, so the total
 * airway flow is Q = S·P_int − A + Q_fixed, where Q_fixed is the sum of flows in compartments pinned
 * by expiratory flow limitation. The tube adds Paw = P_int + K1·Q + K2·Q|Q|. A leak at the Y-piece draws
 * Q_leak(Paw) so the ventilator-side flow is Qv = Q + Q_leak.
 */
import type { AirwayBC } from '../types';
import { rohrerDrop, rohrerSlope } from '../math/rohrer';

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

/** d(Paw)/dQ */
function pawSlope(n: NodeInputs, q: number): number {
  return (n.s > 0 ? 1 / n.s : 0) + rohrerSlope(n.k1, n.k2, q);
}

export function solveNode(bc: AirwayBC, n: NodeInputs): NodeSolution {
  const finish = (q: number): NodeSolution => {
    const pint = pintOf(n, q);
    const paw = pint + rohrerDrop(n.k1, n.k2, q);
    const qLeak = n.leak ? n.leak(paw) : 0;
    return { q, qv: q + qLeak, qLeak, pint, paw };
  };

  switch (bc.kind) {
    case 'occluded': {
      // Qv = 0 → Q = −Q_leak(Paw). Fixed-point on the (small) leak term.
      let q = 0;
      if (n.leak) {
        for (let i = 0; i < 4; i++) q = -n.leak(pawOf(n, q));
      }
      return finish(q);
    }
    case 'flow': {
      // Q = Qv − Q_leak(Paw(Q)); fixed-point on the leak term.
      let q = bc.qv;
      if (n.leak) {
        for (let i = 0; i < 4; i++) q = bc.qv - n.leak(pawOf(n, q));
      }
      return finish(q);
    }
    case 'pressure': {
      // Psrc − Rsrc·(Q + Q_leak) = P_int(Q) + Rohrer(Q). Newton on Q; quadratic form gives a good start.
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
      if (n.leak) {
        for (let iter = 0; iter < 6; iter++) {
          const paw = pawOf(n, q);
          const g = paw + bc.rsrc * (q + n.leak(paw)) - bc.psrc;
          const dg = pawSlope(n, q) * (1 + bc.rsrc * leakSlope(n.leak, paw)) + bc.rsrc;
          const step = g / dg;
          q -= step;
          if (Math.abs(step) < 1e-9) break;
        }
      }
      return finish(q);
    }
  }
}

function leakSlope(leak: (paw: number) => number, paw: number): number {
  const h = 1e-3;
  return (leak(paw + h) - leak(paw - h)) / (2 * h);
}
