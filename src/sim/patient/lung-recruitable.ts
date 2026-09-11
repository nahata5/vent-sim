/**
 * Recruitable-population lung recoil (Spec §4.3, Brief 2 §2.2 model B: simplified Hickling 1998 /
 * Bates–Irvin 2002). One instance per compartment holds N identical units stacked over the compartment's
 * height. A fraction of the units is recruitable: each has an opening pressure TOP_i drawn deterministically
 * from a normal distribution (quantiles, no PRNG) on the recoil axis (pressure above the compartment's FRC
 * anchor, D-003) and a closing pressure TOP_i − closeDelta. A unit opens when its local recoil pressure
 * (compartment recoil + the within-compartment pleural offset of its height) has stayed above TOP long
 * enough for a Bates–Irvin trajectory variable x_i to reach 1, and closes when x_i falls back to 0 below TCP.
 * The remaining units are always open (the aerated lung at zero PEEP).
 *
 * Open units share the compartment volume equally, so with n of N units open the recoil is
 *   P(V) = E_all·(N/n)·V·(1 + odGain·max(0, strain_u − strainCap)),  strain_u = V/(n·frcUnit),
 * where E_all = E_comp·f0 is the elastance of the fully recruited compartment (E_comp is Table 1's value,
 * measured with the fraction f0 open at zero PEEP) and frcUnit = FRC_comp/(N·f0) is one unit's aerated
 * volume at FRC. Fewer open units → a stiffer "baby lung"; over-inflated units stiffen (overdistension).
 * Opening and closing change P(V) discontinuously, so recruitment draws gas in and derecruitment pushes it
 * out through the airway ODE rather than by fiat.
 */
import type { LungRecoil } from './recoil';

export interface RecruitableSpec {
  kind: 'recruitable';
  /** Units per compartment. */
  n: number;
  /** Fraction of units that are recruitable (closed at zero PEEP); the rest are always open. */
  recruitableFraction: number;
  /** Opening pressure distribution on the recoil axis, cmH2O (Brief 2 §2.2: airway TOP mode 20–25 in
   *  oleic-acid dogs minus the pleural offset; [M]). */
  topMean: number;
  topSd: number;
  /** Closing pressure = TOP − closeDelta (5–10 cmH2O lower [M]). */
  closeDelta: number;
  /** Trajectory rates, 1/(cmH2O·s): x moves at kOpen·(P − TOP) above TOP and kClose·(TCP − P) below TCP. */
  kOpen: number;
  kClose: number;
  /** Unit strain (V_unit/FRC_unit) above which the unit stiffens, and the stiffening gain per unit strain. */
  strainCap: number;
  odGain: number;
}

/** Acklam's rational approximation of the inverse normal CDF (relative error < 1.2e-9). */
export function inverseNormal(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  const ph = 1 - pl;
  const g = (i: number, arr: number[]) => arr[i] ?? 0;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((g(0, c) * q + g(1, c)) * q + g(2, c)) * q + g(3, c)) * q + g(4, c)) * q + g(5, c)) / ((((g(0, d) * q + g(1, d)) * q + g(2, d)) * q + g(3, d)) * q + 1);
  }
  if (p > ph) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((g(0, c) * q + g(1, c)) * q + g(2, c)) * q + g(3, c)) * q + g(4, c)) * q + g(5, c)) / ((((g(0, d) * q + g(1, d)) * q + g(2, d)) * q + g(3, d)) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((g(0, a) * r + g(1, a)) * r + g(2, a)) * r + g(3, a)) * r + g(4, a)) * r + g(5, a)) * q) / (((((g(0, b) * r + g(1, b)) * r + g(2, b)) * r + g(3, b)) * r + g(4, b)) * r + 1);
}

export class RecruitableRecoil implements LungRecoil {
  readonly n: number;
  /** Opening pressure per unit (−Infinity for always-open units) and closing pressure. */
  private readonly top: Float64Array;
  private readonly tcp: Float64Array;
  private readonly zOff: Float64Array;
  private readonly open: Uint8Array;
  private readonly x: Float64Array;
  /** Units that opened since the last beginBreath (for the tidal-recruitment count). */
  private readonly openedSinceBreath: Uint8Array;
  /** Fully recruited elastance and one unit's aerated FRC. */
  readonly eAll: number;
  readonly frcUnit: number;
  readonly f0: number;

  constructor(
    readonly spec: RecruitableSpec,
    elComp: number,
    frcComp: number,
    zOffsets: number[],
  ) {
    const n = Math.max(2, Math.round(spec.n));
    this.n = n;
    this.top = new Float64Array(n).fill(-Infinity);
    this.tcp = new Float64Array(n).fill(-Infinity);
    this.zOff = new Float64Array(n);
    for (let i = 0; i < n; i++) this.zOff[i] = zOffsets[i] ?? 0;
    this.open = new Uint8Array(n).fill(1);
    this.x = new Float64Array(n).fill(1);
    this.openedSinceBreath = new Uint8Array(n);
    // Recruitable units: deterministic normal quantiles, interleaved over the height so every region holds
    // units of every opening pressure (the pleural gradient alone makes the dependent region collapse first).
    const m = Math.round(Math.min(1, Math.max(0, spec.recruitableFraction)) * n);
    const stride = m > 0 ? n / m : 1;
    for (let j = 0; j < m; j++) {
      const i = Math.min(n - 1, Math.floor(j * stride + stride / 2));
      const q = (j + 0.5) / m;
      const t = spec.topMean + spec.topSd * inverseNormal(q);
      this.top[i] = t;
      this.tcp[i] = t - spec.closeDelta;
      this.open[i] = 0;
      this.x[i] = 0;
    }
    this.f0 = (n - m) / n;
    this.eAll = elComp * Math.max(this.f0, 1 / n);
    this.frcUnit = frcComp / (n * Math.max(this.f0, 1 / n));
  }

  private nOpen(): number {
    let c = 0;
    for (let i = 0; i < this.n; i++) c += this.open[i] ?? 0;
    return c;
  }

  openFraction(): number {
    return this.nOpen() / this.n;
  }

  /** Aerated volume at FRC of the currently open units, L. */
  aeratedFrc(): number {
    return this.nOpen() * this.frcUnit;
  }

  /** Effective linear elastance with the current open set (a closed compartment is nearly incompressible). */
  private eEff(): number {
    const nOpen = this.nOpen();
    return nOpen === 0 ? this.eAll * this.n * 50 : (this.eAll * this.n) / nOpen;
  }

  pressure(v: number): number {
    const nOpen = Math.max(1, this.nOpen());
    const e = this.eEff();
    const vc = nOpen * this.frcUnit;
    const s = v / vc;
    const od = s > this.spec.strainCap ? 1 + this.spec.odGain * (s - this.spec.strainCap) : 1;
    return e * v * od;
  }

  elastance(v: number): number {
    const nOpen = Math.max(1, this.nOpen());
    const e = this.eEff();
    const vc = nOpen * this.frcUnit;
    const s = v / vc;
    if (s <= this.spec.strainCap) return e;
    return e * (1 + this.spec.odGain * (2 * s - this.spec.strainCap));
  }

  volumeAt(p: number): number {
    // Monotone in v: bisection.
    let lo = -0.95 * this.nOpen() * this.frcUnit - 0.05;
    let hi = 10;
    if (this.pressure(lo) > p) return lo;
    for (let i = 0; i < 80; i++) {
      const mid = 0.5 * (lo + hi);
      if (this.pressure(mid) < p) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Instantaneous equilibrium of the open set at a recoil pressure (initialization). */
  settle(p: number): void {
    for (let i = 0; i < this.n; i++) {
      const local = p + (this.zOff[i] ?? 0);
      if (!Number.isFinite(this.top[i] ?? NaN)) continue; // always open
      if ((this.open[i] ?? 0) === 1) {
        if (local < (this.tcp[i] ?? 0)) {
          this.open[i] = 0;
          this.x[i] = 0;
        }
      } else if (local > (this.top[i] ?? 0)) {
        this.open[i] = 1;
        this.x[i] = 1;
      }
    }
  }

  /** Advance the Bates–Irvin trajectories by dt at the compartment's recoil pressure p. */
  advance(dt: number, p: number): void {
    const { kOpen, kClose } = this.spec;
    for (let i = 0; i < this.n; i++) {
      const top = this.top[i] ?? -Infinity;
      if (!Number.isFinite(top)) continue;
      const local = p + (this.zOff[i] ?? 0);
      const tcp = this.tcp[i] ?? -Infinity;
      if ((this.open[i] ?? 0) === 1) {
        if (local < tcp) {
          this.x[i] = (this.x[i] ?? 1) - kClose * (tcp - local) * dt;
          if ((this.x[i] ?? 0) <= 0) {
            this.x[i] = 0;
            this.open[i] = 0;
          }
        } else {
          this.x[i] = Math.min(1, (this.x[i] ?? 1) + kOpen * Math.max(0, local - tcp) * dt);
        }
      } else if (local > top) {
        this.x[i] = (this.x[i] ?? 0) + kOpen * (local - top) * dt;
        if ((this.x[i] ?? 0) >= 1) {
          this.x[i] = 1;
          this.open[i] = 1;
          this.openedSinceBreath[i] = 1;
        }
      } else {
        this.x[i] = Math.max(0, (this.x[i] ?? 0) - kClose * Math.max(0, top - local) * dt);
      }
    }
  }

  beginBreath(): void {
    this.openedSinceBreath.fill(0);
  }

  /** Units that opened during this breath and are closed again now (tidal recruitment). */
  tidalRecruitCount(): number {
    let c = 0;
    for (let i = 0; i < this.n; i++) if ((this.openedSinceBreath[i] ?? 0) === 1 && (this.open[i] ?? 0) === 0) c += 1;
    return c;
  }
}
