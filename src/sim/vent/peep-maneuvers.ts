/**
 * PEEP maneuvers run by the ventilator on its own measured signals (Spec §5, Brief 2 §2.4):
 *
 *  - R/I (Chen 2020): at the next cycle-off drop PEEP from the set value to PEEP_low for one breath and
 *    measure the extra expired volume ΔVrelease = Vte(release) − mean Vte(previous breaths); keep PEEP low
 *    for a few breaths, take an inspiratory hold for Pplat,low → Crs,low = Vt/(Pplat,low − PEEP_low);
 *    restore PEEP. Vpred = Crs,low·(PEEP_high − PEEP_low), Vrec = ΔVrelease − Vpred,
 *    R/I = Vrec/(PEEP_high − PEEP_low)/Crs,low. Airway opening pressure is not modelled (D-014).
 *  - Decremental PEEP trial: start at max(set PEEP, 20), step down by 2 every N breaths, an inspiratory
 *    hold closes each step (Pplat, ΔP, Crs, PL,ei when Pes is available, bedside power); best-compliance
 *    PEEP = argmax Crs; PEEP is restored to the original value at the end.
 *
 * The ventilator drives these objects from its own breath-start, cycle and hold events. Nothing here
 * reads patient truth.
 */
import { k } from '../../config/constants';
import type { ManeuverResult } from '../types';

export type PeepManeuverKind = 'ri' | 'peep-trial';

/** What the maneuver may ask of the ventilator. */
export interface PeepManeuverHost {
  readonly peep: number;
  setPeep(p: number): void;
  requestInspHold(): void;
  /** Withdraw a pending hold request (an alarm-cycled breath cannot take it). */
  cancelInspHold(): void;
}

/** Measured values at the end of an inspiratory hold. */
export interface HoldReadout {
  t: number;
  pplat: number;
  /** Inspired volume of the held breath, L. */
  vti: number;
  pes: number | null;
  ppeak: number;
  /** Rate used for the bedside power surrogate, /min. */
  rr: number;
}

export interface PeepManeuver {
  readonly kind: PeepManeuverKind;
  /** A hold that could not be taken; the ventilator feeds it to onHold as an invalid readout. */
  pendingInvalid: HoldReadout | null;
  /** Called at every cycle-off (start of expiration) with the index of the breath that just ended inspiration. */
  onCycle(t: number, breathIndex: number, vteHistory: number[]): void;
  /** Called at every breath start with the measured Vte of the breath that just ended (L). */
  onBreathStart(t: number, breathIndex: number, lastVte: number): void;
  /** Called when an inspiratory hold completes; returns the maneuver result when finished. */
  onHold(read: HoldReadout): ManeuverResult | null;
}

/** Bedside mechanical power, Gattinoni 2016 simplified VC form (Brief 2 §3), J/min. */
function powerSimplified(rr: number, vtL: number, ppeak: number, dp: number): number {
  return k('J_PER_CMH2O_L') * rr * vtL * (ppeak - 0.5 * dp);
}

export class RiManeuver implements PeepManeuver {
  readonly kind = 'ri' as const;
  private phase: 'armed' | 'low' | 'done' = 'armed';
  private readonly peepHigh: number;
  private readonly peepLow = k('RI_PEEP_LOW');
  private releaseIndex = -1;
  private vteRef = NaN;
  private dVrelease = NaN;
  private holdAt: number | null = null;

  constructor(
    private readonly host: PeepManeuverHost,
    private readonly tStart: number,
  ) {
    this.peepHigh = host.peep;
  }

  onCycle(_t: number, breathIndex: number, vteHistory: number[]): void {
    if (this.phase !== 'armed') return;
    const n = k('RI_BASELINE_BREATHS');
    const ref = vteHistory.slice(-n);
    this.vteRef = ref.length > 0 ? ref.reduce((s, x) => s + x, 0) / ref.length : NaN;
    this.releaseIndex = breathIndex;
    this.host.setPeep(this.peepLow);
    this.phase = 'low';
  }

  onBreathStart(t: number, breathIndex: number, lastVte: number): void {
    if (this.phase !== 'low') return;
    if (breathIndex === this.releaseIndex + 1) this.dVrelease = lastVte - this.vteRef;
    if (breathIndex === this.releaseIndex + k('RI_LOW_BREATHS')) {
      this.host.requestInspHold();
      this.holdAt = breathIndex;
    }
    // No hold could be taken (alarm-cycled breaths): give up with an invalid result rather than stall.
    if (this.holdAt !== null && breathIndex >= this.holdAt + k('PEEP_TRIAL_HOLD_RETRIES')) {
      this.host.cancelInspHold();
      this.pendingInvalid = { t, pplat: NaN, vti: NaN, pes: null, ppeak: NaN, rr: NaN };
    }
  }

  /** Set when the hold never came; the ventilator polls it at the next control step. */
  pendingInvalid: HoldReadout | null = null;

  onHold(read: HoldReadout): ManeuverResult | null {
    if (this.phase !== 'low') return null;
    this.phase = 'done';
    this.host.setPeep(this.peepHigh);
    const dPeep = this.peepHigh - this.peepLow;
    const crsLow = read.vti / Math.max(0.5, read.pplat - this.peepLow); // L/cmH2O
    const valid = dPeep >= k('RI_MIN_RELEASE') && Number.isFinite(this.dVrelease) && Number.isFinite(crsLow) && crsLow > 0;
    const vpred = crsLow * dPeep;
    const vrec = this.dVrelease - vpred;
    const ri = valid ? vrec / dPeep / crsLow : NaN;
    return {
      kind: 'ri',
      tStart: this.tStart,
      tEnd: read.t,
      values: {
        peepHigh: this.peepHigh,
        peepLow: this.peepLow,
        dVrelease: this.dVrelease * 1000,
        vteRef: this.vteRef * 1000,
        pplatLow: read.pplat,
        crsLow: crsLow * 1000,
        vpred: vpred * 1000,
        vrec: vrec * 1000,
        ri,
        valid: valid ? 1 : 0,
      },
    };
  }
}

export class PeepTrial implements PeepManeuver {
  readonly kind = 'peep-trial' as const;
  private readonly peepOriginal: number;
  private peep: number;
  private stepStart: number | null = null;
  private holdAt: number | null = null;
  private readonly steps: Array<Record<string, number>> = [];
  private done = false;
  /** Set when the hold never came (alarm-cycled breaths); the ventilator polls it at the next control step. */
  pendingInvalid: HoldReadout | null = null;

  constructor(
    private readonly host: PeepManeuverHost,
    private readonly tStart: number,
  ) {
    this.peepOriginal = host.peep;
    this.peep = Math.max(host.peep, k('PEEP_TRIAL_START'));
    host.setPeep(this.peep);
  }

  onCycle(): void {
    /* nothing to do at cycle-off */
  }

  onBreathStart(t: number, breathIndex: number): void {
    if (this.done) return;
    if (this.stepStart === null) this.stepStart = breathIndex;
    if (breathIndex === this.stepStart + k('PEEP_TRIAL_BREATHS') - 1) {
      this.host.requestInspHold();
      this.holdAt = breathIndex;
    }
    if (this.holdAt !== null && breathIndex >= this.holdAt + k('PEEP_TRIAL_HOLD_RETRIES')) {
      // The step's hold was skipped repeatedly (alarm-cycled breaths): record it as invalid and move on.
      this.host.cancelInspHold();
      this.pendingInvalid = { t, pplat: NaN, vti: NaN, pes: null, ppeak: NaN, rr: NaN };
    }
  }

  onHold(read: HoldReadout): ManeuverResult | null {
    if (this.done) return null;
    this.holdAt = null;
    const dp = read.pplat - this.peep;
    const vtMl = read.vti * 1000;
    const crs = Number.isFinite(dp) ? vtMl / Math.max(0.5, dp) : NaN;
    this.steps.push({
      peep: this.peep,
      pplat: read.pplat,
      ppeak: read.ppeak,
      dp,
      vt: vtMl,
      crs,
      plEI: read.pes === null ? NaN : read.pplat - read.pes,
      power: powerSimplified(read.rr, read.vti, read.ppeak, dp),
      t: read.t,
    });
    const next = this.peep - k('PEEP_TRIAL_STEP');
    if (next < k('PEEP_TRIAL_END') - 1e-9) {
      this.done = true;
      this.host.setPeep(this.peepOriginal);
      let best: Record<string, number> | undefined;
      for (const s of this.steps) if (Number.isFinite(s.crs ?? NaN) && (s.crs ?? 0) > (best?.crs ?? -Infinity)) best = s;
      return {
        kind: 'peep-trial',
        tStart: this.tStart,
        tEnd: read.t,
        values: { bestPeep: best?.peep ?? NaN, bestCrs: best?.crs ?? NaN, peepStart: this.steps[0]?.peep ?? NaN, peepEnd: this.peep, peepOriginal: this.peepOriginal },
        table: this.steps,
      };
    }
    this.peep = next;
    this.host.setPeep(next);
    this.stepStart = null;
    return null;
  }
}

export function makePeepManeuver(kind: PeepManeuverKind, host: PeepManeuverHost, t: number): PeepManeuver {
  return kind === 'ri' ? new RiManeuver(host, t) : new PeepTrial(host, t);
}
