/**
 * Lung recoil PL_i(V_i) per compartment, three implementations behind one interface (Spec §4.2).
 * V is volume above the compartment's FRC share; recoil(0) = 0 and the phenotype anchor PL0 is added
 * by the compartment model (docs/DECISIONS.md D-003).
 */
import type { RecoilSpec } from './params';
import { RecruitableRecoil } from './lung-recruitable';

export interface LungRecoil {
  /** Recoil pressure change from V = 0, cmH2O. */
  pressure(v: number): number;
  /** Local elastance dP/dV, cmH2O/L. */
  elastance(v: number): number;
  /** Inverse: volume at which pressure(v) = p (exact for both implementations). */
  volumeAt(p: number): number;
  /** Recruitable lung only: equilibrate the open set at a recoil pressure (initialization). */
  settle?(p: number): void;
  /** Recruitable lung only: advance unit opening/closing trajectories at a recoil pressure. */
  advance?(dt: number, p: number): void;
  beginBreath?(): void;
  openFraction?(): number;
  aeratedFrc?(): number;
  tidalRecruitCount?(): number;
}

export interface RecoilExtras {
  /** Compartment FRC share, L. */
  frcComp: number;
  /** Within-compartment pleural offsets per unit (recoil-axis pressure added for a unit's height), cmH2O. */
  zOffsets: number[];
}

export class LinearRecoil implements LungRecoil {
  constructor(private readonly el: number) {}
  pressure(v: number): number {
    return this.el * v;
  }
  elastance(): number {
    return this.el;
  }
  volumeAt(p: number): number {
    return p / this.el;
  }
}

/**
 * Venegas sigmoid inverse (Brief 2 §2.1): V = a + b/(1 + exp(−(P − c)/d)), so
 * P(V) = c − d·ln(b/(V − a) − 1). Parameters are given on the compartment's own volume axis
 * (volume above its FRC share), and the curve is shifted so pressure(0) = 0.
 */
export class VenegasRecoil implements LungRecoil {
  private readonly p0: number;
  constructor(
    private readonly a: number,
    private readonly b: number,
    private readonly c: number,
    private readonly d: number,
  ) {
    this.p0 = this.raw(0);
  }
  private raw(v: number): number {
    // Keep V strictly inside (a, a + b) so the log stays finite; clamp with a tiny margin.
    const eps = 1e-4 * this.b;
    const vv = Math.min(Math.max(v, this.a + eps), this.a + this.b - eps);
    return this.c - this.d * Math.log(this.b / (vv - this.a) - 1);
  }
  pressure(v: number): number {
    return this.raw(v) - this.p0;
  }
  elastance(v: number): number {
    // dP/dV = d·b / ((V − a)·(a + b − V))
    const eps = 1e-4 * this.b;
    const vv = Math.min(Math.max(v, this.a + eps), this.a + this.b - eps);
    return (this.d * this.b) / ((vv - this.a) * (this.a + this.b - vv));
  }
  volumeAt(p: number): number {
    // raw(v) = p + p0  →  v = a + b / (1 + exp(−(p + p0 − c)/d))
    return this.a + this.b / (1 + Math.exp(-(p + this.p0 - this.c) / this.d));
  }
}

export function makeRecoil(spec: RecoilSpec, elCompartment: number, fraction: number, extras?: RecoilExtras): LungRecoil {
  switch (spec.kind) {
    case 'linear':
      return new LinearRecoil(elCompartment);
    case 'venegas':
      // Venegas parameters are defined for the whole lung; scale the volume axis by the fraction.
      return new VenegasRecoil(spec.a * fraction, spec.b * fraction, spec.c, spec.d);
    case 'recruitable':
      return new RecruitableRecoil(spec, elCompartment, extras?.frcComp ?? 1, extras?.zOffsets ?? []);
  }
}
