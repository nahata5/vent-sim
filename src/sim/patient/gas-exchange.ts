/**
 * Minimal CO2 → drive loop (Spec §4.4, Brief 1 §1.5).
 *
 *   VA        = (Vt_true − VD)·60/max(period, t − t_lastBreath) of the last closed breath,  VD = 2.2 mL/kg PBW
 *               + apparatus (one-breath lag; the denominator keeps growing during an apnea so VA → 0)
 *   PaCO2_ss  = 0.863·VCO2/VA
 *   dPaCO2/dt = (VCO2 − VA·PaCO2/0.863)/K            (lumped body store as a CO2 mass balance)
 *             = (VA/VA_ref)·(PaCO2_ss − PaCO2)/τ     with K = τ·VA_ref/0.863, VA_ref = 0.863·VCO2/set point,
 *   so the approach has the brief's τ at eupneic ventilation, slows at low VA and is bounded in apnea
 *   (rise VCO2/K ≈ 13 mmHg/min for τ 3 min) instead of chasing an infinite target.
 *   PaCO2_d   = PaCO2 delayed by the chemoreceptor transport lag
 *   drive     = clamp(1 + G·(PaCO2_d − set), 0, Dmax) → Pmax scale; rate scale with its own gain
 *   apnea     = PaCO2_d < set − apneic offset → no efforts (the ventilator's backup takes over)
 *
 * The time warp multiplies dt for the store and the delay line only; breathing mechanics, the ventilator
 * and the neural clock run in unwarped simulated time (a warp of 60 makes one simulated second one
 * warped minute of CO2 dynamics). No randomness: the loop is deterministic for a given warp.
 */
import { k } from '../../config/constants';
import { clamp } from '../math/filters';

export interface GasParams {
  /** CO2 production, mL/min STPD. */
  vco2: number;
  /** Anatomic dead space per kg PBW and apparatus dead space (mL). */
  deadSpaceMlPerKg: number;
  apparatusDeadSpace: number;
  /** Body store time constant (s) and chemoreceptor delay (s), on the warped clock. */
  tau: number;
  delay: number;
  /** Drive gains per mmHg above the set point, drive ceiling, set point and apneic offset (mmHg). */
  gainPmax: number;
  gainRate: number;
  driveMax: number;
  paco2Set: number;
  apneicOffset: number;
  paco2Init: number;
  /** Time warp ×1–×60 on the CO2 dynamics only. */
  warp: number;
}

export function defaultGasParams(): GasParams {
  return {
    vco2: k('CO2_VCO2_DEFAULT'),
    deadSpaceMlPerKg: k('CO2_DEAD_SPACE_ML_PER_KG'),
    apparatusDeadSpace: k('CO2_APPARATUS_DEAD_SPACE'),
    tau: k('CO2_TAU'),
    delay: k('CO2_CHEMO_DELAY'),
    gainPmax: k('CO2_GAIN_PMAX'),
    gainRate: k('CO2_GAIN_RATE'),
    driveMax: k('CO2_DRIVE_MAX'),
    paco2Set: k('CO2_SET_POINT'),
    apneicOffset: k('CO2_APNEIC_OFFSET'),
    paco2Init: k('CO2_PACO2_INIT'),
    warp: 1,
  };
}

/** PaCO2_ss = 0.863·VCO2/VA (mmHg), VCO2 in mL/min, VA in L/min. */
export function steadyStatePaCO2(vco2: number, vaLpm: number): number {
  return (k('CO2_BTPS_FACTOR') * vco2) / Math.max(0.1, vaLpm);
}

export interface DriveOutput {
  pmaxScale: number;
  rateScale: number;
  apnea: boolean;
}

export class GasExchange {
  params: GasParams;
  paCO2: number;
  private readonly vdL: number;
  /** Last closed breath: end time, period and alveolar volume (L). */
  private last: { t: number; period: number; valv: number } | null = null;
  private tPrevBreathEnd = 0;
  private vaOverride: number | null = null;
  private tNow = 0;
  /** Store capacitance K = τ·VA_ref/0.863, mL CO2 per mmHg. */
  private readonly capacity: number;
  /** Delay line sampled every CO2_DELAY_SAMPLE warped seconds. */
  private readonly delayBuf: number[];
  private delayAcc = 0;

  constructor(params: GasParams, pbw: number) {
    this.params = params;
    this.paCO2 = params.paco2Init;
    this.vdL = (params.deadSpaceMlPerKg * pbw + params.apparatusDeadSpace) / 1000;
    const n = Math.max(1, Math.round(params.delay / k('CO2_DELAY_SAMPLE')));
    this.delayBuf = new Array<number>(n).fill(params.paco2Init);
    // K in mL/mmHg with τ in minutes (VA in L/min, 0.863 mmHg·L/mL): 3 min × 4.3 / 0.863 ≈ 15 mL/mmHg.
    this.capacity = ((params.tau / 60) * this.referenceVA) / k('CO2_BTPS_FACTOR');
  }

  /** Alveolar ventilation that holds PaCO2 at the set point, L/min. */
  get referenceVA(): number {
    return (k('CO2_BTPS_FACTOR') * this.params.vco2) / this.params.paco2Set;
  }

  get warp(): number {
    return this.params.warp;
  }

  setWarp(w: number): void {
    this.params = { ...this.params, warp: clamp(w, 1, k('CO2_WARP_MAX')) };
  }

  /** Dead space, L. */
  get deadSpace(): number {
    return this.vdL;
  }

  /** Oldest value of the delay line: PaCO2 as the chemoreceptors see it. */
  get paCO2Delayed(): number {
    return this.delayBuf[0] ?? this.paCO2;
  }

  /**
   * Alveolar ventilation estimate, L/min (null until the first breath closes): the last breath's alveolar
   * volume over the longer of its period and the time elapsed since it, so the estimate lags by one breath
   * (the warp multiplies any real-time lag in the loop; a longer averaging window made the warped loop
   * oscillate, D-014) and falls toward zero during an apnea; backup breaths count like any other.
   */
  get alveolarVentilation(): number | null {
    if (this.vaOverride !== null) return this.vaOverride;
    if (!this.last) return null;
    const period = Math.max(this.last.period, this.tNow - this.last.t);
    return (this.last.valv * 60) / period;
  }

  /** Fix VA directly (unit tests, instructor). */
  setAlveolarVentilation(vaLpm: number): void {
    this.vaOverride = vaLpm;
  }

  /** Test hook: force the store and the delay line to a value. */
  forcePaCO2(v: number): void {
    this.paCO2 = v;
    this.delayBuf.fill(v);
  }

  /** Register a closed ventilator breath (true inspired volume in L, end time in s). */
  onBreath(vtiTrue: number, tEnd: number): void {
    const period = Math.max(0.5, tEnd - this.tPrevBreathEnd);
    this.last = { t: tEnd, period, valv: Math.max(0, vtiTrue - this.vdL) };
    this.tPrevBreathEnd = tEnd;
  }

  /** Advance the store and the delay line by dt simulated seconds (× warp on the CO2 clock). */
  advance(dt: number): void {
    this.tNow += dt;
    const va = this.alveolarVentilation;
    if (va === null) return; // nothing known about ventilation yet: hold the initial value
    const dtw = dt * this.params.warp;
    // Mass balance: production in, alveolar clearance out (mL/min → per second).
    const clearance = (va * this.paCO2) / k('CO2_BTPS_FACTOR');
    this.paCO2 += ((this.params.vco2 - clearance) / this.capacity / 60) * dtw;
    this.delayAcc += dtw;
    const step = k('CO2_DELAY_SAMPLE');
    while (this.delayAcc >= step) {
      this.delayAcc -= step;
      this.delayBuf.shift();
      this.delayBuf.push(this.paCO2);
    }
  }

  drive(): DriveOutput {
    const p = this.params;
    const d = this.paCO2Delayed - p.paco2Set;
    const apnea = d < -p.apneicOffset;
    return {
      pmaxScale: apnea ? 0 : clamp(1 + p.gainPmax * d, 0, p.driveMax),
      rateScale: clamp(1 + p.gainRate * d, k('CO2_RATE_SCALE_MIN'), k('CO2_RATE_SCALE_MAX')),
      apnea,
    };
  }
}

export interface Co2Sample {
  t: number;
  paCO2: number;
  paCO2Delayed: number;
  pmaxScale: number;
  rateScale: number;
  apnea: boolean;
  va: number | null;
  warp: number;
}
