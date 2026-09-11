/**
 * Fault injectors (Spec §2.1 principle 1, §7; Brief 1 §3.2, §3.11, §3.12). Each injector contributes a
 * term to the patient equations through `PatientDrive` and never touches the display:
 *
 *   leak          Q_leak = k·√max(Paw, 0) at the Y-piece (orifice model, Brief 1 §1.4)
 *   cardiac       Ppl += A·sin(2π·HR/60·t) (Brief 1 §3.2; flow oscillation ≈ A/R)
 *   secretions    R × (1 + a·n(t)), n band-limited 5–20 Hz gaussian noise (Brief 1 §3.12)
 *   water         R × (1 + a·sin(2π·f·t)), a regular oscillation (Brief 1 §3.12)
 *   cough         brief large expiratory Pmus bursts, provoked by inflation: a scheduled cough fires
 *                 COUGH_INSP_DELAY after the next inspiration starts (Brief 1 §3.12)
 *   pneumothorax  Ppl offset + lung elastance ×eScale, abrupt (Brief 1 §3.12)
 *   mainstem      lung elastance ×2, resistance ×1.5 (one lung ventilated; Brief 1 §3.12)
 *   bronchospasm  resistance ×rScale, ramped over rampSeconds (Brief 1 §3.12)
 *
 * The class is deterministic: it owns a forked PRNG and is evaluated once per physics step.
 */
import { k } from '../../config/constants';
import type { Rng } from '../math/prng';
import { BandLimitedNoise } from '../math/filters';

export interface InjectorParamMap {
  leak: { k: number }; // L/s per √cmH2O
  cardiac: { amp: number }; // cmH2O
  secretions: { amp: number }; // fractional resistance modulation, RMS
  water: { amp: number; freq: number }; // fraction, Hz
  cough: { interval: number; amp: number; duration: number }; // s, cmH2O, s
  pneumothorax: { eScale: number; ppl: number }; // ×, cmH2O
  mainstem: { eScale: number; rScale: number };
  bronchospasm: { rScale: number; rampSeconds: number };
}

export type InjectorKind = keyof InjectorParamMap;
export const INJECTOR_KINDS: readonly InjectorKind[] = ['leak', 'cardiac', 'secretions', 'water', 'cough', 'pneumothorax', 'mainstem', 'bronchospasm'];

/** Snapshot of the static injector state at a time (for the labeler and exports). */
export interface InjectorLogEntry {
  t: number;
  kinds: InjectorKind[];
  /** Static resistance and elastance multipliers (secretion noise and water oscillation excluded). */
  rScale: number;
  eScale: number;
}

export interface InjectorTerms {
  pcard: number;
  leak: ((paw: number) => number) | null;
  rScale: number;
  eScale: number;
  pplExtra: [number, number];
  pmusExtra: number;
}

interface ActiveInjector<K extends InjectorKind = InjectorKind> {
  kind: K;
  params: InjectorParamMap[K];
  tStart: number;
}

export function defaultInjectorParams<K extends InjectorKind>(kind: K): InjectorParamMap[K] {
  const d: InjectorParamMap = {
    leak: { k: k('LEAK_K_DEFAULT') },
    cardiac: { amp: k('CARDIAC_PPL_AMP_DEFAULT') },
    secretions: { amp: k('SECRETIONS_R_MODULATION') },
    water: { amp: k('WATER_R_MODULATION'), freq: k('WATER_OSC_FREQ') },
    cough: { interval: k('COUGH_INTERVAL_DEFAULT'), amp: k('COUGH_PMUS_AMP'), duration: k('COUGH_DURATION') },
    pneumothorax: { eScale: k('PNEUMOTHORAX_ESCALE'), ppl: k('PNEUMOTHORAX_PPL') },
    mainstem: { eScale: k('MAINSTEM_ESCALE'), rScale: k('MAINSTEM_RSCALE') },
    bronchospasm: { rScale: k('BRONCHOSPASM_RSCALE'), rampSeconds: k('BRONCHOSPASM_RAMP') },
  };
  return d[kind];
}

export class Injectors {
  private readonly active = new Map<InjectorKind, ActiveInjector>();
  private readonly noise: BandLimitedNoise;
  private readonly noiseHp: BandLimitedNoise;
  private tNow = 0;
  private nextCough = Infinity;
  private coughArmed = false;
  private coughFireAt = Infinity;
  private coughEnd = -Infinity;
  private terms: InjectorTerms = Injectors.none();
  readonly log: InjectorLogEntry[] = [{ t: 0, kinds: [], rScale: 1, eScale: 1 }];

  constructor(
    private readonly rng: Rng,
    dt: number,
    private readonly heartRate: number,
  ) {
    // Band-limited 5–20 Hz: difference of two low-passed noises (20 Hz minus 5 Hz), unit RMS-ish.
    this.noise = new BandLimitedNoise(rng.fork('secretions-hi'), 1, k('SECRETIONS_BAND_HI'), dt);
    this.noiseHp = new BandLimitedNoise(rng.fork('secretions-lo'), 1, k('SECRETIONS_BAND_LO'), dt);
  }

  static none(): InjectorTerms {
    return { pcard: 0, leak: null, rScale: 1, eScale: 1, pplExtra: [0, 0], pmusExtra: 0 };
  }

  /** Enable (or update) an injector with explicit or default params; `null` disables it. */
  set<K extends InjectorKind>(kind: K, params: Partial<InjectorParamMap[K]> | null): void {
    if (params === null) {
      this.active.delete(kind);
      if (kind === 'cough') {
        this.nextCough = Infinity;
        this.coughArmed = false;
        this.coughFireAt = Infinity;
      }
      this.pushLog();
      return;
    }
    const full = { ...defaultInjectorParams(kind), ...params };
    this.active.set(kind, { kind, params: full, tStart: this.tNow });
    if (kind === 'cough') this.scheduleCough(this.tNow, (full as InjectorParamMap['cough']).interval);
    this.pushLog();
  }

  clear(): void {
    this.active.clear();
    this.nextCough = Infinity;
    this.coughArmed = false;
    this.coughFireAt = Infinity;
    this.pushLog();
  }

  private pushLog(): void {
    let rScale = 1;
    let eScale = 1;
    for (const a of this.active.values()) {
      if (a.kind === 'mainstem') {
        const p = a.params as InjectorParamMap['mainstem'];
        rScale *= p.rScale;
        eScale *= p.eScale;
      } else if (a.kind === 'pneumothorax') {
        eScale *= (a.params as InjectorParamMap['pneumothorax']).eScale;
      } else if (a.kind === 'bronchospasm') {
        rScale *= (a.params as InjectorParamMap['bronchospasm']).rScale;
      }
    }
    this.log.push({ t: this.tNow, kinds: this.activeKinds(), rScale, eScale });
  }

  /** Engine hook: a ventilator inspiration starts (an armed cough fires shortly after inflation begins). */
  onBreathStart(t: number): void {
    if (this.coughArmed) {
      this.coughArmed = false;
      this.coughFireAt = t + k('COUGH_INSP_DELAY');
    }
  }

  activeKinds(): InjectorKind[] {
    return [...this.active.keys()];
  }

  params<K extends InjectorKind>(kind: K): InjectorParamMap[K] | null {
    const a = this.active.get(kind);
    return a ? (a.params as InjectorParamMap[K]) : null;
  }

  private scheduleCough(t: number, interval: number): void {
    // Exponential-ish spacing around the mean interval, never sooner than 1 s.
    this.nextCough = t + Math.max(1, interval * (0.5 + this.rng.next()));
  }

  /** Evaluate all active injector terms at simulated time t (call once per physics step). */
  termsAt(t: number): InjectorTerms {
    this.tNow = t;
    if (this.active.size === 0) {
      // Keep the noise generators in step whether or not they are used, so enabling secretions later
      // does not change the PRNG consumption of anything else.
      return this.terms.leak === null && this.terms.rScale === 1 ? this.terms : (this.terms = Injectors.none());
    }
    const out = Injectors.none();
    for (const a of this.active.values()) {
      switch (a.kind) {
        case 'leak': {
          const kk = (a.params as InjectorParamMap['leak']).k;
          out.leak = (paw: number) => kk * Math.sqrt(Math.max(0, paw));
          break;
        }
        case 'cardiac': {
          const amp = (a.params as InjectorParamMap['cardiac']).amp;
          out.pcard += amp * Math.sin((2 * Math.PI * this.heartRate * t) / 60);
          break;
        }
        case 'secretions': {
          const amp = (a.params as InjectorParamMap['secretions']).amp;
          const n = this.noise.next() - this.noiseHp.next();
          out.rScale *= Math.max(0.3, 1 + amp * n);
          break;
        }
        case 'water': {
          const p = a.params as InjectorParamMap['water'];
          out.rScale *= Math.max(0.3, 1 + p.amp * Math.sin(2 * Math.PI * p.freq * t));
          break;
        }
        case 'cough': {
          const p = a.params as InjectorParamMap['cough'];
          if (t >= this.nextCough && !this.coughArmed) {
            this.coughArmed = true;
            this.scheduleCough(t, p.interval);
          }
          if (t >= this.coughFireAt) {
            this.coughEnd = t + p.duration;
            this.coughFireAt = Infinity;
          }
          if (t < this.coughEnd) {
            // Half-sine expiratory burst (negative Pmus = expiratory muscles).
            const x = 1 - (this.coughEnd - t) / p.duration;
            out.pmusExtra -= p.amp * Math.sin(Math.PI * x);
          }
          break;
        }
        case 'pneumothorax': {
          const p = a.params as InjectorParamMap['pneumothorax'];
          out.eScale *= p.eScale;
          out.pplExtra = [out.pplExtra[0] + p.ppl, out.pplExtra[1] + p.ppl];
          break;
        }
        case 'mainstem': {
          const p = a.params as InjectorParamMap['mainstem'];
          out.eScale *= p.eScale;
          out.rScale *= p.rScale;
          break;
        }
        case 'bronchospasm': {
          const p = a.params as InjectorParamMap['bronchospasm'];
          const f = p.rampSeconds > 0 ? Math.min(1, (t - a.tStart) / p.rampSeconds) : 1;
          out.rScale *= 1 + (p.rScale - 1) * f;
          break;
        }
      }
    }
    this.terms = out;
    return out;
  }
}
