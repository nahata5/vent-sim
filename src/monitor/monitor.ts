/**
 * Monitor: per-breath derived values from MEASURED signals only, like a real ventilator (Spec §6,
 * Brief 1 §2.7). It consumes device-rate samples plus the ventilator's own event markers and never reads
 * truth channels. Runs on the main thread in the app and headless in tests.
 */
import type { MeasuredSample, VentEvent, TriggerCause, CycleCause } from '../sim/types';
import { k } from '../config/constants';

export interface BreathMetrics {
  index: number;
  tStart: number;
  tEnd: number;
  triggerCause: TriggerCause;
  cycleCause: CycleCause;
  ppeak: number;
  /** Plateau from a pause ≥ INSP_HOLD_MIN in this breath, or the last inspiratory-hold P2 (stale allowed). */
  pplat: number | null;
  pplatFromThisBreath: boolean;
  pmean: number;
  peepMeasured: number;
  /** Total PEEP from the last expiratory hold (stale allowed) and derived intrinsic PEEP. */
  peepTotal: number | null;
  peepi: number | null;
  drivingPressure: number | null;
  cstat: number | null; // mL/cmH2O
  cdyn: number | null; // mL/cmH2O
  raw: number | null; // cmH2O/(L/s)
  vti: number; // mL
  vte: number; // mL
  leakPct: number;
  ti: number;
  te: number;
  ie: number;
  peakInspFlow: number; // L/s
  endExpFlow: number; // L/s at the end of expiration (negative = still exhaling)
  rrTotal: number; // /min, rolling
  veMinute: number; // L/min, rolling
  rsbi: number; // breaths/min/L
  vtPerKg: number; // mL/kg PBW (exhaled)
  lsqR: number;
  lsqC: number; // mL/cmH2O
  lsqPeep: number;
}

export interface MonitorOptions {
  fs: number;
  pbw: number;
}

interface BreathBuffer {
  tStart: number;
  triggerCause: TriggerCause;
  tCycle: number | null;
  cycleCause: CycleCause;
  tPauseEnd: number | null;
  t: number[];
  paw: number[];
  flow: number[];
  vol: number[];
}

export class Monitor {
  private readonly fs: number;
  private readonly pbw: number;
  private buf: BreathBuffer | null = null;
  private pplatHold: { value: number; t: number } | null = null;
  private peepTotalHold: { value: number; t: number } | null = null;
  private history: Array<{ tStart: number; vte: number }> = [];
  readonly breaths: BreathMetrics[] = [];
  latest: BreathMetrics | null = null;
  /** Rolling values available between breaths. */
  rrTotal = 0;
  veMinute = 0;
  onBreath: ((b: BreathMetrics) => void) | null = null;

  constructor(opts: MonitorOptions) {
    this.fs = opts.fs;
    this.pbw = opts.pbw;
  }

  onEvent(e: VentEvent): void {
    switch (e.type) {
      case 'trigger':
        this.finalize(e.t);
        this.buf = { tStart: e.t, triggerCause: e.cause, tCycle: null, cycleCause: 'time', tPauseEnd: null, t: [], paw: [], flow: [], vol: [] };
        break;
      case 'cycle':
        if (this.buf) {
          this.buf.tCycle = e.t;
          this.buf.cycleCause = e.cause;
        }
        break;
      case 'pause-end':
        if (this.buf) this.buf.tPauseEnd = e.t;
        break;
      case 'maneuver':
        if (e.result.kind === 'insp' && e.result.p2 !== undefined) this.pplatHold = { value: e.result.p2, t: e.t };
        if (e.result.kind === 'exp' && e.result.peepTotal !== undefined) this.peepTotalHold = { value: e.result.peepTotal, t: e.t };
        break;
      case 'hold-start':
      case 'hold-end':
      case 'alarm':
        break;
    }
  }

  onSample(s: MeasuredSample): void {
    if (!this.buf) return;
    this.buf.t.push(s.t);
    this.buf.paw.push(s.paw);
    this.buf.flow.push(s.flow);
    this.buf.vol.push(s.vol);
  }

  private finalize(tEnd: number): void {
    const b = this.buf;
    this.buf = null;
    if (!b || b.t.length < 5 || b.tCycle === null) return;
    const n = b.t.length;
    const dt = 1 / this.fs;
    const tInspEnd = b.tPauseEnd ?? b.tCycle;
    let ppeak = -Infinity;
    let pawSum = 0;
    let vti = 0;
    let vte = 0;
    let peakFlow = 0;
    // Vti = ∫ positive flow, Vte = ∫ negative flow over the whole cycle (robust to the sensor delay that
    // shifts the last few ms of inspiratory flow past the cycle marker).
    for (let i = 0; i < n; i++) {
      const t = b.t[i] ?? 0;
      const paw = b.paw[i] ?? 0;
      const q = b.flow[i] ?? 0;
      pawSum += paw;
      if (q > 0) vti += q * dt;
      else vte -= q * dt;
      if (t <= tInspEnd) {
        ppeak = Math.max(ppeak, paw);
        peakFlow = Math.max(peakFlow, q);
      }
    }
    const pmean = pawSum / n;
    // End-expiratory values: mean of the last 50 ms of the breath.
    const tail = Math.max(1, Math.round(0.05 * this.fs));
    let peepMeasured = 0;
    let endExpFlow = 0;
    for (let i = n - tail; i < n; i++) {
      peepMeasured += b.paw[i] ?? 0;
      endExpFlow += b.flow[i] ?? 0;
    }
    peepMeasured /= tail;
    endExpFlow /= tail;

    // Plateau: a pause of at least INSP_HOLD_MIN in this breath, else the last hold value.
    let pplat: number | null = null;
    let pplatFromThisBreath = false;
    if (b.tPauseEnd !== null && b.tPauseEnd - b.tCycle >= k('INSP_HOLD_MIN')) {
      const iEnd = this.indexBefore(b, b.tPauseEnd);
      pplat = b.paw[iEnd] ?? null;
      pplatFromThisBreath = pplat !== null;
    } else if (this.pplatHold) {
      pplat = this.pplatHold.value;
    }
    const peepTotal = this.peepTotalHold ? this.peepTotalHold.value : null;
    const peepi = peepTotal !== null ? peepTotal - peepMeasured : null;
    const peepRef = peepTotal ?? peepMeasured;
    const drivingPressure = pplat !== null ? pplat - peepRef : null;
    const cstat = pplat !== null && pplat - peepRef > 0.5 ? (vti * 1000) / (pplat - peepRef) : null;
    const cdyn = ppeak - peepMeasured > 0.5 ? (vti * 1000) / (ppeak - peepMeasured) : null;
    const raw = pplat !== null && peakFlow > 0.05 ? (ppeak - pplat) / peakFlow : null;
    const ti = tInspEnd - b.tStart;
    const te = tEnd - tInspEnd;
    const leakPct = vti > 0.05 ? (100 * (vti - vte)) / vti : 0;

    // Rolling one-minute window: each finalized breath is one complete cycle from its start to the next
    // trigger, so n breaths span history[0].tStart → tEnd.
    this.history.push({ tStart: b.tStart, vte });
    this.history = this.history.filter((h) => tEnd - h.tStart <= 60);
    const span = Math.max(1e-6, tEnd - (this.history[0]?.tStart ?? b.tStart));
    const rrTotal = (60 * this.history.length) / span;
    const veMinute = (60 * this.history.reduce((s, h) => s + h.vte, 0)) / span;
    this.rrTotal = rrTotal;
    this.veMinute = veMinute;

    const lsq = this.leastSquares(b, tInspEnd);

    const m: BreathMetrics = {
      index: this.breaths.length,
      tStart: b.tStart,
      tEnd,
      triggerCause: b.triggerCause,
      cycleCause: b.cycleCause,
      ppeak,
      pplat,
      pplatFromThisBreath,
      pmean,
      peepMeasured,
      peepTotal,
      peepi,
      drivingPressure,
      cstat,
      cdyn,
      raw,
      vti: vti * 1000,
      vte: vte * 1000,
      leakPct,
      ti,
      te,
      ie: te > 0 ? ti / te : 0,
      peakInspFlow: peakFlow,
      endExpFlow,
      rrTotal,
      veMinute,
      rsbi: vte > 0.02 ? rrTotal / vte : 0,
      vtPerKg: (vte * 1000) / this.pbw,
      lsqR: lsq.r,
      lsqC: lsq.c,
      lsqPeep: lsq.p0,
    };
    this.breaths.push(m);
    this.latest = m;
    this.onBreath?.(m);
  }

  private indexBefore(b: BreathBuffer, t: number): number {
    let i = b.t.length - 1;
    while (i > 0 && (b.t[i] ?? 0) >= t) i -= 1;
    return i;
  }

  /**
   * Least-squares fit of the equation of motion Paw = R·Q + E·V + P0 over the whole breath, using the
   * ventilator's own integrated volume (reset at inspiration start). Returns R, C = 1/E (mL/cmH2O), P0.
   */
  private leastSquares(b: BreathBuffer, tInspEnd: number): { r: number; c: number; p0: number } {
    // Fit on inspiration plus early expiration (up to 1 s), where the signal-to-noise is best.
    let sQQ = 0, sQV = 0, sQ = 0, sVV = 0, sV = 0, sN = 0, sPQ = 0, sPV = 0, sP = 0;
    for (let i = 0; i < b.t.length; i++) {
      const t = b.t[i] ?? 0;
      if (t > tInspEnd + 1.0) break;
      const q = b.flow[i] ?? 0;
      const v = b.vol[i] ?? 0;
      const p = b.paw[i] ?? 0;
      sQQ += q * q; sQV += q * v; sQ += q; sVV += v * v; sV += v; sN += 1; sPQ += p * q; sPV += p * v; sP += p;
    }
    // Solve the 3×3 normal equations by Cramer's rule.
    const a = [
      [sQQ, sQV, sQ],
      [sQV, sVV, sV],
      [sQ, sV, sN],
    ];
    const rhs = [sPQ, sPV, sP];
    const det3 = (m: number[][]) =>
      (m[0]?.[0] ?? 0) * ((m[1]?.[1] ?? 0) * (m[2]?.[2] ?? 0) - (m[1]?.[2] ?? 0) * (m[2]?.[1] ?? 0)) -
      (m[0]?.[1] ?? 0) * ((m[1]?.[0] ?? 0) * (m[2]?.[2] ?? 0) - (m[1]?.[2] ?? 0) * (m[2]?.[0] ?? 0)) +
      (m[0]?.[2] ?? 0) * ((m[1]?.[0] ?? 0) * (m[2]?.[1] ?? 0) - (m[1]?.[1] ?? 0) * (m[2]?.[0] ?? 0));
    const d = det3(a);
    if (Math.abs(d) < 1e-12) return { r: NaN, c: NaN, p0: NaN };
    const col = (j: number) => a.map((row, i) => row.map((x, jj) => (jj === j ? (rhs[i] ?? 0) : x)));
    const r = det3(col(0)) / d;
    const e = det3(col(1)) / d;
    const p0 = det3(col(2)) / d;
    return { r, c: e > 0 ? 1000 / e : NaN, p0 };
  }
}
