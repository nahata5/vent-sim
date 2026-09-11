/**
 * Neural drive and Pmus generator (Brief 1 §1.3, §3.5; Spec §4.4).
 *
 * The patient runs its own clock. Each neural breath is {onset, neural Ti, Pmax, hold fraction,
 * relaxation τ}; the isometric muscle pressure is a parabolic rise (Albanese 2016) to Pmax, an optional
 * hold (ASL 5000 "Hold %"), then exponential relaxation. Breath-to-breath variability is AR(1) on Pmax,
 * Ti and rate. Entrainment (reverse triggering) phase-locks onsets to machine breath starts plus a delay
 * with < 5% jitter (Akoumianaki 2013). Expiratory muscles add a negative bump late in expiration.
 * Nothing here reads the ventilator except the breath-start hook used for entrainment.
 */
import { k } from '../../config/constants';
import type { Rng } from '../math/prng';
import { clamp } from '../math/filters';

export interface EntrainmentParams {
  ratio: 1 | 2 | 3;
  delay: number; // s after machine breath start
  jitter: number; // CV of the delay (< 0.05 per Akoumianaki)
}

export interface ExpiratoryParams {
  amp: number; // cmH2O (positive number; applied as negative Pmus)
  onsetFrac: number; // fraction of the free expiratory interval at which the push starts
  duration: number; // s
}

export interface DriveParams {
  rate: number; // neural RR, /min
  ti: number; // neural Ti, s
  pmax: number; // isometric peak, cmH2O
  relaxTau: number; // s
  holdFrac: number; // fraction of Ti held at Pmax
  cvRate: number;
  cvTi: number;
  cvPmax: number;
  ar1Phi: number;
  expiratory: ExpiratoryParams | null;
  sighInterval: number | null; // mean seconds between sighs
  entrainment: EntrainmentParams | null;
  lowDriveClusters: boolean;
  /** Force–velocity penalty: Pmus_eff = Pmus_iso·(1 − kFv·clamp(Q/qRef, 0, 1)). */
  kFv: number;
  qRef: number; // L/s
}

export interface NeuralBreath {
  index: number;
  tOnset: number;
  ti: number;
  pmax: number;
  holdFrac: number;
  relaxTau: number;
  /** End of the inspiratory effort including relaxation (Pmus back near zero). */
  tEnd: number;
  entrained: boolean;
  sigh: boolean;
  expiratory: { tOnset: number; duration: number; amp: number } | null;
}

export function defaultDriveParams(): DriveParams {
  return {
    rate: 15,
    ti: 1.0,
    pmax: 8,
    relaxTau: k('PMUS_RELAX_TAU'),
    holdFrac: k('PMUS_HOLD_FRAC'),
    cvRate: k('DRIVE_CV_DEFAULT'),
    cvTi: k('DRIVE_CV_DEFAULT'),
    cvPmax: k('DRIVE_CV_DEFAULT'),
    ar1Phi: k('DRIVE_AR1_PHI'),
    expiratory: null,
    sighInterval: null,
    entrainment: null,
    lowDriveClusters: false,
    kFv: k('PMUS_KFV'),
    qRef: k('PMUS_QREF'),
  };
}

/** Isometric Pmus of one effort at time x since its onset (≥ 0). */
export function pmusWaveform(x: number, p: { pmax: number; ti: number; holdFrac: number; relaxTau: number }): number {
  if (x <= 0) return 0;
  const tRise = p.ti * (1 - p.holdFrac);
  if (x <= tRise) {
    const u = x / tRise;
    return p.pmax * (2 * u - u * u);
  }
  if (x <= p.ti) return p.pmax;
  return p.pmax * Math.exp(-(x - p.ti) / p.relaxTau);
}

class Ar1 {
  private z = 0;
  constructor(
    private readonly phi: number,
    private readonly rng: Rng,
  ) {}
  /** Multiplicative factor 1 + cv·z with z an AR(1) standard process. */
  next(cv: number): number {
    this.z = this.phi * this.z + Math.sqrt(1 - this.phi * this.phi) * this.rng.gaussian();
    return clamp(1 + cv * this.z, 0.3, 2.0);
  }
}

export class NeuralDrive {
  params: DriveParams;
  readonly breaths: NeuralBreath[] = [];
  pmusIso = 0;
  private tNextOnset: number;
  private readonly arRate: Ar1;
  private readonly arTi: Ar1;
  private readonly arPmax: Ar1;
  private readonly arCluster: Ar1;
  private clusterFactor = 1;
  private machineCount = 0;
  private pendingEntrained: number[] = [];
  private pmaxScale = 1;
  private rateScale = 1;
  private lastPeriod: number;
  private readonly rng: Rng;

  constructor(params: DriveParams, rng: Rng) {
    this.params = params;
    this.rng = rng;
    this.arRate = new Ar1(params.ar1Phi, rng.fork('rate'));
    this.arTi = new Ar1(params.ar1Phi, rng.fork('ti'));
    this.arPmax = new Ar1(params.ar1Phi, rng.fork('pmax'));
    this.arCluster = new Ar1(k('DRIVE_CLUSTER_PHI'), rng.fork('cluster'));
    this.lastPeriod = 60 / params.rate;
    // First free-running onset at a random phase so scenarios do not all start in lock-step.
    this.tNextOnset = 0.3 + this.lastPeriod * rng.fork('phase').next();
  }

  /** External scaling of drive (CO2 loop, sedation slider). */
  setScale(pmaxScale: number, rateScale: number): void {
    this.pmaxScale = pmaxScale;
    this.rateScale = rateScale;
  }

  setParams(partial: Partial<DriveParams>): void {
    this.params = { ...this.params, ...partial };
  }

  /** Machine breath start hook for entrainment. */
  onVentBreath(t: number): void {
    const e = this.params.entrainment;
    if (!e) return;
    this.machineCount += 1;
    if (this.machineCount % e.ratio !== 0) return;
    const delay = e.delay * (1 + e.jitter * this.rng.gaussian());
    this.pendingEntrained.push(t + Math.max(0.05, delay));
  }

  private spawn(t: number, entrained: boolean): void {
    const p = this.params;
    const pmaxF = p.cvPmax > 0 ? this.arPmax.next(p.cvPmax) : 1;
    const tiF = p.cvTi > 0 ? this.arTi.next(p.cvTi) : 1;
    if (p.lowDriveClusters) this.clusterFactor = clamp(this.arCluster.next(k('DRIVE_CLUSTER_CV')), 0.2, 1.5);
    let sigh = false;
    if (p.sighInterval && this.rng.next() < this.lastPeriod / p.sighInterval) sigh = true;
    const pmax = clamp(p.pmax * pmaxF * this.pmaxScale * this.clusterFactor * (sigh ? k('SIGH_FACTOR') : 1), 0, 40);
    const ti = clamp(p.ti * tiF * (sigh ? 1.3 : 1), 0.4, 2.5);
    const relaxTau = p.relaxTau;
    const tEnd = t + ti + 5 * relaxTau;
    let expiratory: NeuralBreath['expiratory'] = null;
    if (p.expiratory && p.expiratory.amp > 0) {
      const free = Math.max(0, this.lastPeriod - ti - 3 * relaxTau);
      expiratory = {
        tOnset: t + ti + 3 * relaxTau + p.expiratory.onsetFrac * free,
        duration: p.expiratory.duration,
        amp: p.expiratory.amp,
      };
    }
    this.breaths.push({
      index: this.breaths.length,
      tOnset: t,
      ti,
      pmax,
      holdFrac: p.holdFrac,
      relaxTau,
      tEnd,
      entrained,
      sigh,
      expiratory,
    });
  }

  /** Advance the clock to time t and evaluate Pmus_iso(t). */
  advance(t: number, _dt: number): void {
    const p = this.params;
    if (p.entrainment) {
      while (this.pendingEntrained.length > 0 && (this.pendingEntrained[0] ?? Infinity) <= t) {
        const tOn = this.pendingEntrained.shift() ?? t;
        this.spawn(tOn, true);
      }
    } else {
      while (this.tNextOnset <= t) {
        const tOn = this.tNextOnset;
        this.spawn(tOn, false);
        const rateF = p.cvRate > 0 ? this.arRate.next(p.cvRate) : 1;
        const rate = clamp(p.rate * this.rateScale, 4, 60);
        this.lastPeriod = clamp((60 / rate) * rateF, 0.8, 15);
        this.tNextOnset = tOn + this.lastPeriod;
      }
    }
    // Sum active efforts (overlap allowed).
    let pm = 0;
    for (let i = this.breaths.length - 1; i >= 0; i--) {
      const b = this.breaths[i];
      if (!b) break;
      const expEnd = b.expiratory ? b.expiratory.tOnset + b.expiratory.duration : -Infinity;
      if (t > b.tEnd && t > expEnd) {
        if (b.tEnd < t - 30) break;
        continue;
      }
      if (t >= b.tOnset && t <= b.tEnd) pm += pmusWaveform(t - b.tOnset, b);
      if (b.expiratory && t >= b.expiratory.tOnset && t <= expEnd) {
        const u = (t - b.expiratory.tOnset) / b.expiratory.duration;
        pm -= b.expiratory.amp * Math.sin(Math.PI * u);
      }
    }
    this.pmusIso = pm;
  }
}
