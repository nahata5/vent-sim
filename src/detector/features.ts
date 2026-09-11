/**
 * Per-breath features from MEASURED signals only (Paw, flow, volume at the device rate), the ventilator's
 * own event markers and its settings. No truth channel is ever read here: the reader type only exposes the
 * measured keys, and `readChannels` records every channel touched so tests can prove it.
 */
import type { CycleCause, Mode, TriggerCause, VentEvent } from '../sim/types';
import type { VentSettings } from '../sim/vent/settings';
import { k } from '../config/constants';

export type MeasuredKey = 't' | 'paw' | 'flow' | 'vol' | 'pes';

export interface MeasuredReader {
  n: number;
  fs: number;
  read: (ch: MeasuredKey, i: number) => number;
  indexAt: (t: number) => number;
}

/** Ventilator timing of one breath, as the device knows it (no true volumes). */
export interface MeasuredBreath {
  index: number;
  tStart: number;
  tInspEnd: number;
  tPauseEnd: number;
  tEnd: number;
  triggerCause: TriggerCause;
  cycleCause: CycleCause;
  vti: number; // L, measured
  vte: number; // L, measured
  ppeak: number;
}

export interface DeviceContext {
  mode: Mode;
  peep: number;
  pTarget: number;
  riseTime: number;
  ets: number;
  flowTrigger: number; // L/min
  pressureTrigger: number;
  triggerType: VentSettings['triggerType'];
  highPpeak: number;
}

/** Effort-free passive reference from previous breaths (VC flow-starvation prediction). */
export interface PassiveRef {
  /** Running maximum of the inspiratory resistive-step resistance, cmH2O/(L/s). */
  rMax: number;
  /** Running maximum of the expiratory time constant, s (efforts only shorten the apparent decay). */
  tauMed: number;
  /** Volume left in the lung from the previous breath (Vti − Vte), L. */
  vTrapped: number;
}

export interface FlowNotch {
  tStart: number; // local expiratory minimum (most negative) before the rise
  tPeak: number; // local maximum of the rise
  rise: number; // L/min, toward zero
  duration: number; // s from tStart to when flow falls back below (peak − rise/2) or the window ends
  pawDip: number; // cmH2O below the local baseline at the rise peak
  reversal: boolean; // flow crossed above zero
}

export interface BreathFeatures {
  ti: number;
  te: number;
  /** Pre-trigger Paw dip below the expiratory baseline (cmH2O) and the time from dip onset to trigger (s). */
  preDip: number;
  preDipDuration: number;
  /** Pre-trigger flow rise from the local minimum (L/min). */
  preFlowRise: number;
  /** Time from the last expiratory-flow minimum (effort onset, rise ≥ 5 L/min to the trigger) to the trigger, s. */
  effortLead: number;
  /** Minimum flow over [−0.5, −0.12] s before the trigger, L/min (a leak keeps it above zero). */
  preFlowFloor: number;
  /** VC: slope of the Paw ramp between 20% and 85% of Ti, cmH2O/s. */
  rampSlope: number;
  /** Early-inspiratory Paw sag below the servo target (pressure-targeted breaths), cmH2O. */
  earlySag: number;
  /** Overshoot above target in the first 200 ms, cmH2O. */
  overshoot: number;
  /** VC: mid-ramp concavity of Paw (chord − Paw at 50% Ti), cmH2O; min Paw during the ramp minus PEEP. */
  concavity: number;
  rampMinAbovePeep: number;
  /** VC: largest mid/late-inspiratory Paw dip from its running maximum (after 20% of Ti), cmH2O. */
  midInspDip: number;
  midInspDipTime: number; // s from breath start
  /** PC/PSV: largest flow rise after the inspiratory peak (hump), L/min, and when it started. */
  inspHump: number;
  inspHumpTime: number;
  /** End-inspiratory Paw rise above target in the last third (pressure-targeted), cmH2O. */
  endInspRise: number;
  /** Flow shoulder: seconds from an abrupt steepening of the inspiratory flow decay to cycle-off. */
  shoulderTail: number;
  /** Early expiration: peak expiratory flow (L/min, negative), Paw minimum in the first 0.4 s minus PEEP. */
  peakExpFlow: number;
  earlyExpPawDip: number;
  /** Time after cycle-off at which expiratory flow first came back above −1 L/min (s), or NaN. */
  expReturnTime: number;
  /** Expiratory flow notches (candidate efforts), in time order. */
  notches: FlowNotch[];
  /** End-expiratory flow (mean of the last 50 ms), L/min. */
  endExpFlow: number;
  /** First-difference RMS of expiratory flow, L/min (5–20 Hz energy proxy). */
  expHpRms: number;
  /** Least-squares R (cmH2O/(L/s)) and C (mL/cmH2O) over the breath. */
  lsqR: number;
  lsqC: number;
  pawMax: number;
  /** Expiratory time constant from the passive part of the flow decay (s), NaN if not fittable. */
  tauExp: number;
  /** VC: resistance from the resistive step at flow onset, cmH2O/(L/s) (effort-independent), NaN otherwise. */
  rStep: number;
  /** VC: pressure–time deficit of Paw below the passive prediction over inspiration, cmH2O·s (≈ ∫Pmus dt). */
  ptpDeficit: number;
  /** Heart-rate-band (≈0.8–2.5 Hz) flow oscillation amplitude over the 2.5 s before the trigger, L/min. */
  cardiacOsc: number;
  /** Oscillation is regular (≥ 2 intervals, period 0.4–1.25 s, CV < 0.3) and its mean period, s. */
  cardiacRegular: boolean;
  cardiacPeriod: number;
  /** Fastest Paw rise over 30 ms during the breath, cmH2O/s. */
  pawMaxSlope: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? NaN) : 0.5 * ((s[m - 1] ?? 0) + (s[m] ?? 0));
}

export function extractFeatures(r: MeasuredReader, b: MeasuredBreath, ctx: DeviceContext, triggerT: number, prevInspEndT: number | null, prevStartT: number | null, nextTriggerT: number | null, ref: PassiveRef, recentTransitions: number[], seen: Set<string>): BreathFeatures {
  const rd = (ch: MeasuredKey, i: number) => {
    seen.add(ch);
    return r.read(ch, Math.min(r.n - 1, Math.max(0, i)));
  };
  const fs = r.fs;
  const iTrig = r.indexAt(triggerT);
  const transitions = [iTrig, prevInspEndT !== null ? r.indexAt(prevInspEndT) : -99, prevStartT !== null ? r.indexAt(prevStartT) : -99, ...recentTransitions.map((t) => r.indexAt(t))];
  const iS = r.indexAt(b.tStart);
  const tInspEnd = Number.isNaN(b.tPauseEnd) ? b.tInspEnd : b.tPauseEnd;
  const iC = r.indexAt(b.tInspEnd);
  const iI = r.indexAt(tInspEnd);
  const iE = Math.max(iI, r.indexAt(b.tEnd) - 1);
  const ti = tInspEnd - b.tStart;
  const te = b.tEnd - tInspEnd;

  // ── Pre-trigger: baseline over [−1.0, −0.5] s, dip over the last 0.4 s.
  const pre = Math.round(k('DET_AT_PRE_WINDOW') * fs);
  // Baseline: median Paw over [−1.0, −0.5] s before the trigger, restricted to the previous expiration.
  const iPrevExpStart = prevInspEndT !== null ? r.indexAt(prevInspEndT) + Math.round(0.15 * fs) : 0;
  const bl: number[] = [];
  for (let i = Math.max(iPrevExpStart, iTrig - Math.round(1.0 * fs)); i < iTrig - Math.round(0.5 * fs); i++) if (i >= 0) bl.push(rd('paw', i));
  if (bl.length < 3) for (let i = Math.max(iPrevExpStart, iTrig - Math.round(0.5 * fs)); i < iTrig - Math.round(0.3 * fs); i++) if (i >= 0) bl.push(rd('paw', i));
  const baseline = bl.length ? median(bl) : ctx.peep;
  let preMin = Infinity;
  let flowMin = Infinity;
  for (let i = Math.max(0, iTrig - pre); i <= iTrig; i++) {
    preMin = Math.min(preMin, rd('paw', i));
    flowMin = Math.min(flowMin, rd('flow', i));
  }
  const preDip = Math.max(0, baseline - preMin);
  let onset = iTrig;
  for (let i = iTrig; i >= Math.max(0, iTrig - Math.round(1.5 * fs)); i--) {
    if (rd('paw', i) < baseline - k('DET_DIP_ONSET')) onset = i;
    else if (i < iTrig - 2) break;
  }
  const preDipDuration = preDip >= k('DET_DIP_ONSET') ? (iTrig - onset) / fs : 0;
  const preFlowRise = (rd('flow', iTrig) - flowMin) * 60;
  let preFlowFloor = Infinity;
  for (let i = Math.max(0, iTrig - Math.round(0.5 * fs)); i <= iTrig - Math.round(0.12 * fs); i++) preFlowFloor = Math.min(preFlowFloor, rd('flow', i));
  preFlowFloor = Number.isFinite(preFlowFloor) ? preFlowFloor * 60 : NaN;
  // Effort onset from the flow: the last local minimum before the trigger from which flow rose ≥ 5 L/min.
  let effortLead = 0;
  {
    const qTrig = rd('flow', iTrig);
    let iMinQ = iTrig;
    let vMinQ = qTrig;
    const iLo = Math.max(iPrevExpStart, iTrig - Math.round(1.0 * fs));
    for (let i = iTrig; i >= iLo; i--) {
      const q = rd('flow', i);
      if (q <= vMinQ) {
        vMinQ = q;
        iMinQ = i;
      } else if (q > vMinQ + 1.5 / 60) break;
    }
    if ((qTrig - vMinQ) * 60 >= 5) effortLead = (iTrig - iMinQ) / fs;
  }

  // ── Inspiration.
  const nI = Math.max(1, iI - iS);
  let pawMax = -Infinity;
  let earlyMax = -Infinity;
  let earlySagMin = Infinity;
  let runMax = -Infinity;
  let midInspDip = 0;
  let midInspDipTime = 0;
  let endInspRise = -Infinity;
  const iEarlyEnd = iS + Math.round(0.2 * fs);
  const iSagStart = iS + Math.round((ctx.riseTime + 0.05) * fs);
  const iSagEnd = iS + Math.round((ctx.riseTime + 0.35) * fs);
  const i20 = iS + Math.round(0.2 * nI);
  const i50 = iS + Math.round(0.5 * nI);
  const i85 = iS + Math.round(0.85 * nI);
  const iLastThird = iS + Math.round((2 / 3) * nI);
  let flowPeak = -Infinity;
  let iFlowPeak = iS;
  for (let i = iS; i <= iI; i++) {
    const p = rd('paw', i);
    const q = rd('flow', i);
    pawMax = Math.max(pawMax, p);
    if (i <= iEarlyEnd) earlyMax = Math.max(earlyMax, p);
    if (i >= iSagStart && i <= iSagEnd) earlySagMin = Math.min(earlySagMin, p);
    if (i >= i20 && i <= iC) {
      if (p > runMax) runMax = p;
      else if (runMax - p > midInspDip) {
        midInspDip = runMax - p;
        midInspDipTime = (i - iS) / fs;
      }
    }
    if (i >= iLastThird && i <= iC) endInspRise = Math.max(endInspRise, p - ctx.pTarget);
    if (q > flowPeak) {
      flowPeak = q;
      iFlowPeak = i;
    }
  }
  const overshoot = earlyMax - ctx.pTarget;
  const earlySag = Number.isFinite(earlySagMin) ? ctx.pTarget - earlySagMin : 0;
  // Concavity of the VC ramp: chord between 20% and 85% of Ti versus Paw at 50%.
  const p20 = rd('paw', i20);
  const p50 = rd('paw', i50);
  const p85 = rd('paw', i85);
  const chord = p20 + ((p85 - p20) * (i50 - i20)) / Math.max(1, i85 - i20);
  const concavity = chord - p50;
  const rampSlope = ((p85 - p20) * fs) / Math.max(1, i85 - i20);
  let rampMin = Infinity;
  for (let i = iS + Math.round(0.15 * fs); i <= iC; i++) rampMin = Math.min(rampMin, rd('paw', i));
  const rampMinAbovePeep = Number.isFinite(rampMin) ? rampMin - ctx.peep : 99;
  // Flow hump after the inspiratory peak (pressure-targeted breaths).
  let inspHump = 0;
  let inspHumpTime = 0;
  let localMin = Infinity;
  let iLocalMin = iFlowPeak;
  for (let i = iFlowPeak; i <= iC; i++) {
    const q = rd('flow', i);
    if (q < localMin) {
      localMin = q;
      iLocalMin = i;
    } else if ((q - localMin) * 60 > inspHump) {
      inspHump = (q - localMin) * 60;
      inspHumpTime = (iLocalMin - iS) / fs;
    }
  }
  // Flow shoulder: slope over 100 ms windows in the second half of inspiration becoming ≥ 2× steeper.
  let shoulderTail = 0;
  const w = Math.max(2, Math.round(0.1 * fs));
  for (let i = iS + Math.round(0.4 * nI); i + 2 * w <= iC; i += w) {
    const s1 = rd('flow', i + w) - rd('flow', i);
    const s2 = rd('flow', i + 2 * w) - rd('flow', i + w);
    if (s1 < 0 && s2 < 2 * s1 && (s2 - s1) * 60 < -3) {
      shoulderTail = (iC - (i + w)) / fs;
      break;
    }
  }

  // ── Expiration.
  let peakExp = Infinity;
  let iPeakExp = iI;
  let earlyPawMin = Infinity;
  const iEarlyExpEnd = Math.min(iE, iC + Math.round(0.4 * fs));
  for (let i = iC; i <= iE; i++) {
    const q = rd('flow', i);
    if (i <= iC + Math.round(0.6 * fs) && q < peakExp) {
      peakExp = q;
      iPeakExp = i;
    }
    if (i <= iEarlyExpEnd) earlyPawMin = Math.min(earlyPawMin, rd('paw', i));
  }
  const earlyExpPawDip = Number.isFinite(earlyPawMin) ? ctx.peep - earlyPawMin : 0;
  let expReturnTime = NaN;
  for (let i = iPeakExp; i <= iE; i++) {
    if (rd('flow', i) > -1 / 60) {
      expReturnTime = (i - iC) / fs;
      break;
    }
  }
  // ── Expiratory time constant: least-squares slope of ln(−Q) over the decay from 80 ms after the peak
  // until flow is above −2 L/min, the next effort (Paw dip) or 1.5 s, whichever first.
  let tauExp = NaN;
  let tauExpEarly = NaN;
  {
    // Early local estimate over the first 0.3 s after the peak (used for notch deviation).
    {
      let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
      const i0 = iPeakExp + Math.round(0.05 * fs);
      const i1 = Math.min(iE, iPeakExp + Math.round(0.3 * fs));
      for (let i = i0; i <= i1; i++) {
        const q = -rd('flow', i);
        if (q < 2 / 60) break;
        const x = (i - i0) / fs;
        const y = Math.log(q);
        sx += x; sy += y; sxx += x * x; sxy += x * y; n += 1;
      }
      if (n >= 6) {
        const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
        if (slope < -0.05) tauExpEarly = -1 / slope;
      }
    }
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    const iStartFit = iPeakExp + Math.round(0.08 * fs);
    const iStopFit = Math.min(iE, (nextTriggerT !== null ? r.indexAt(nextTriggerT) : iE) - Math.round(0.3 * fs), iPeakExp + Math.round(1.5 * fs));
    for (let i = iStartFit; i <= iStopFit; i++) {
      const q = -rd('flow', i);
      if (q < 2 / 60) break;
      const x = (i - iStartFit) / fs;
      const y = Math.log(q);
      sx += x; sy += y; sxx += x * x; sxy += x * y; n += 1;
    }
    if (n >= 8) {
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      if (slope < -0.05) tauExp = -1 / slope;
    }
  }
  // Notches: local min → rise toward zero → FALL BACK (flow more negative again) or a reversal above zero.
  // A monotonic decay toward zero is not a notch; the fall-back distinguishes an effort from the decay.
  const notches: FlowNotch[] = [];
  {
    let i = Math.max(iPeakExp, iC + 1);
    while (i < iE - 2) {
      let iMin = i;
      let vMin = rd('flow', i);
      while (iMin + 1 <= iE && rd('flow', iMin + 1) <= vMin) {
        iMin += 1;
        vMin = rd('flow', iMin);
      }
      let iPk = iMin;
      let vPk = vMin;
      let j = iMin + 1;
      let fellBack = false;
      let stalled = false;
      const stall = Math.max(2, Math.round(0.1 * fs));
      while (j <= iE) {
        const q = rd('flow', j);
        if (!stalled && q > vPk + 0.5 / 60) {
          vPk = q;
          iPk = j;
        } else if (!stalled && j - iPk >= stall) {
          stalled = true; // the deflection has crested; now wait for the fall-back
        }
        if (vPk - q >= Math.max(2.0 / 60, 0.15 * (vPk - vMin)) && j - iPk >= 2) {
          fellBack = true;
          break;
        }
        j += 1;
      }
      // Rise measured against the passive decay extrapolated from the minimum, so an effort riding on a fast
      // decay counts only for its deflection above the decay (BetterCare-style deviation from expected flow).
      const tauRefN = Number.isFinite(ref.tauMed) ? ref.tauMed : Number.isFinite(tauExpEarly) ? tauExpEarly : NaN;
      const passAtPk = Number.isFinite(tauRefN) && vMin < 0 ? vMin * Math.exp(-((iPk - iMin) / fs) / tauRefN) : vMin;
      const rise = (vPk - Math.max(vMin, passAtPk)) * 60;
      const reversal = vPk > 0.5 / 60;
      if (rise >= 2.0 && iPk > iMin && fellBack) {
        let iBack = j;
        while (iBack <= iE && rd('flow', iBack) > vPk - 0.5 * (vPk - vMin)) iBack += 1;
        const duration = (Math.min(iBack, iE) - iMin) / fs;
        let base = 0;
        let nb = 0;
        for (let q2 = Math.max(iC + Math.round(0.25 * fs), iMin - Math.round(0.3 * fs)); q2 < iMin; q2++) {
          base += rd('paw', q2);
          nb += 1;
        }
        base = nb ? base / nb : ctx.peep;
        // Dip on a 0.1 s moving average of Paw (raw minima over a window are biased low by noise).
        let pawMin = Infinity;
        const wp = Math.max(1, Math.round(0.1 * fs));
        for (let q2 = iMin; q2 <= Math.min(iE, iPk + Math.round(0.1 * fs)); q2++) {
          let m = 0;
          for (let q3 = q2 - wp + 1; q3 <= q2; q3++) m += rd('paw', Math.max(0, q3));
          pawMin = Math.min(pawMin, m / wp);
        }
        notches.push({ tStart: rd('t', iMin), tPeak: rd('t', iPk), rise, duration, pawDip: base - pawMin, reversal });
        i = Math.max(iBack, iPk + 1);
      } else {
        i = Math.max(iPk, iMin) + 1;
      }
    }
  }
  // End-expiratory flow and high-frequency energy.
  // End-expiratory flow read before the next breath's effort: 0.25–0.15 s before the next trigger, or
  // before the Paw dip onset of the next breath if that came earlier.
  const iNextTrig = nextTriggerT !== null ? r.indexAt(nextTriggerT) : iE;
  let iRef = Math.min(iE, iNextTrig - Math.round(0.15 * fs));
  {
    const blNext: number[] = [];
    for (let i = iNextTrig - Math.round(1.0 * fs); i < iNextTrig - Math.round(0.5 * fs); i++) if (i > iI) blNext.push(rd('paw', i));
    const bNext = blNext.length ? median(blNext) : ctx.peep;
    for (let i = iNextTrig; i >= Math.max(iI, iNextTrig - Math.round(1.0 * fs)); i--) {
      if (rd('paw', i) < bNext - k('DET_DIP_ONSET')) iRef = Math.min(iRef, i - 1);
      else if (i < iNextTrig - 2) break;
    }
  }
  const tailN = Math.max(1, Math.round(0.4 * fs));
  let endExp = 0;
  let nEnd = 0;
  for (let i = Math.max(iI + 1, iRef - tailN + 1); i <= Math.max(iI + 1, iRef); i++) {
    endExp += rd('flow', i);
    nEnd += 1;
  }
  endExp = nEnd ? (endExp / nEnd) * 60 : 0;
  // Second-difference RMS of expiratory flow: removes the decay slope, keeps 5–20 Hz sawtooth energy.
  let hp = 0;
  let nh = 0;
  for (let i = iC + 2; i <= iE; i++) {
    if (rd('flow', i) < -0.05) {
      const d = (rd('flow', i) - 2 * rd('flow', i - 1) + rd('flow', i - 2)) * 60;
      hp += d * d;
      nh += 1;
    }
  }
  const expHpRms = nh > 5 ? Math.sqrt(hp / nh) : 0;

  // Least squares Paw = R·Q + E·V + P0 over inspiration + 1 s of expiration.
  let sQQ = 0, sQV = 0, sQ = 0, sVV = 0, sV = 0, sN = 0, sPQ = 0, sPV = 0, sP = 0;
  for (let i = iS; i <= Math.min(iE, iI + Math.round(1.0 * fs)); i++) {
    const q = rd('flow', i);
    const v = rd('vol', i);
    const p = rd('paw', i);
    sQQ += q * q; sQV += q * v; sQ += q; sVV += v * v; sV += v; sN += 1; sPQ += p * q; sPV += p * v; sP += p;
  }
  const det3 = (m: number[][]) =>
    (m[0]?.[0] ?? 0) * ((m[1]?.[1] ?? 0) * (m[2]?.[2] ?? 0) - (m[1]?.[2] ?? 0) * (m[2]?.[1] ?? 0)) -
    (m[0]?.[1] ?? 0) * ((m[1]?.[0] ?? 0) * (m[2]?.[2] ?? 0) - (m[1]?.[2] ?? 0) * (m[2]?.[0] ?? 0)) +
    (m[0]?.[2] ?? 0) * ((m[1]?.[0] ?? 0) * (m[2]?.[1] ?? 0) - (m[1]?.[1] ?? 0) * (m[2]?.[0] ?? 0));
  const a = [
    [sQQ, sQV, sQ],
    [sQV, sVV, sV],
    [sQ, sV, sN],
  ];
  const rhs = [sPQ, sPV, sP];
  const d = det3(a);
  let lsqR = NaN;
  let lsqC = NaN;
  if (Math.abs(d) > 1e-12) {
    const col = (j: number) => a.map((row, i) => row.map((x, jj) => (jj === j ? (rhs[i] ?? 0) : x)));
    lsqR = det3(col(0)) / d;
    const e = det3(col(1)) / d;
    lsqC = e > 0 ? 1000 / e : NaN;
  }

  // ── VC resistive step (relative to set PEEP, so a pre-trigger effort does not hide in the baseline) and
  // the pressure–time deficit of Paw below the passive prediction built from previous breaths' references
  // (running-max R, median τe, trapped volume). Effort only lowers the apparent step, hence the running max.
  let rStep = NaN;
  let ptpDeficit = 0;
  if (ctx.mode === 'VC-AC') {
    const iStep = iS + Math.round(0.08 * fs);
    const qStep = rd('flow', iStep);
    const pStep = rd('paw', iStep);
    const tauRef = Number.isFinite(ref.tauMed) ? ref.tauMed : tauExp;
    if (qStep > 0.1 && Number.isFinite(tauRef)) {
      let r0 = (pStep - ctx.peep) / qStep;
      let cPass = tauRef / Math.max(1, r0);
      r0 = (pStep - ctx.peep - (qStep * 0.08 + ref.vTrapped) / cPass) / qStep;
      rStep = Math.max(0, r0);
      const rRef = Number.isFinite(ref.rMax) ? Math.max(ref.rMax, rStep) : rStep;
      cPass = tauRef / Math.max(1, rRef);
      let v = ref.vTrapped;
      for (let i = iS; i <= iC; i++) {
        const q = rd('flow', i);
        v += Math.max(0, q) / fs;
        const pPass = ctx.peep + rRef * Math.max(0, q) + v / cPass;
        const d = pPass - rd('paw', i);
        if (i >= iStep && d > 0) ptpDeficit += d / fs;
      }
    }
  }
  // ── Cardiac-band oscillation before the trigger. Pressure-targeted breaths carry the cardiac flow
  // oscillation (≈ A/R) through inspiration and expiration alike, so the window spans the 2.5 s before the
  // trigger; samples within ±0.25 s of a phase transition (breath start, cycle-off, trigger) are masked.
  let cardiacOsc = 0;
  let cardiacRegular = false;
  let cardiacPeriod = NaN;
  {
    const wLong = Math.round(0.4 * fs);
    const wShort = Math.max(1, Math.round(0.15 * fs));
    const guard = Math.round(0.25 * fs);
    const iA = Math.max(0, iTrig - Math.round(5.0 * fs));
    const iB = iTrig - Math.round(0.1 * fs);
    const masked = (i: number): boolean => transitions.some((it) => Math.abs(i - it) <= guard);
    const resid: number[] = [];
    const idx: number[] = [];
    const half = Math.round(wLong / 2);
    for (let i = iA + half; i <= iB - half; i++) {
      if (masked(i)) continue;
      let m = 0;
      let nm = 0;
      for (let j = i - half; j <= i + half; j++) {
        if (masked(j)) continue;
        m += rd('flow', j);
        nm += 1;
      }
      if (nm < wLong / 2) continue;
      resid.push(rd('flow', i) - m / nm);
      idx.push(i);
    }
    if (resid.length > wShort + 10) {
      const sm: number[] = [];
      for (let i = wShort; i < resid.length; i++) {
        let m = 0;
        for (let j = i - wShort; j < i; j++) m += resid[j] ?? 0;
        sm.push(m / wShort);
      }
      let ss = 0;
      for (const v of sm) ss += v * v;
      cardiacOsc = Math.sqrt(ss / sm.length) * Math.SQRT2 * 60;
      // Positive-going zero crossings with an amplitude gate of half the RMS.
      const gate = Math.sqrt(ss / sm.length) * 0.5;
      const cross: number[] = [];
      let armed = false;
      for (let i = 0; i < sm.length; i++) {
        const v = sm[i] ?? 0;
        if (v < -gate) armed = true;
        else if (armed && v > gate) {
          cross.push((idx[i + wShort] ?? 0) / fs);
          armed = false;
        }
      }
      if (cross.length >= 3) {
        const iv: number[] = [];
        for (let i = 1; i < cross.length; i++) iv.push((cross[i] ?? 0) - (cross[i - 1] ?? 0));
        const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
        const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length);
        cardiacPeriod = mean;
        cardiacRegular = mean >= 0.4 && mean <= 1.25 && sd / mean < 0.35;
      }
    }
  }
  // ── Fastest Paw rise (cough spike).
  let pawMaxSlope = 0;
  {
    const w3 = Math.max(1, Math.round(0.03 * fs));
    for (let i = iS + w3; i <= iE; i++) pawMaxSlope = Math.max(pawMaxSlope, ((rd('paw', i) - rd('paw', i - w3)) * fs) / w3);
  }

  return {
    ti,
    te,
    preDip,
    preDipDuration,
    preFlowRise,
    effortLead,
    preFlowFloor,
    rampSlope,
    earlySag,
    overshoot,
    concavity,
    rampMinAbovePeep,
    midInspDip,
    midInspDipTime,
    inspHump,
    inspHumpTime,
    endInspRise: Number.isFinite(endInspRise) ? endInspRise : 0,
    shoulderTail,
    peakExpFlow: Number.isFinite(peakExp) ? peakExp * 60 : 0,
    earlyExpPawDip,
    expReturnTime,
    notches,
    endExpFlow: endExp,
    expHpRms,
    lsqR,
    lsqC,
    pawMax,
    tauExp,
    rStep,
    ptpDeficit,
    cardiacOsc,
    cardiacRegular,
    cardiacPeriod,
    pawMaxSlope,
  };
}

/** Measured view of the ventilator's breath bookkeeping (drops every true quantity). */
export function measuredBreath(b: {
  index: number;
  tStart: number;
  tInspEnd: number;
  tPauseEnd: number;
  tEnd: number | null;
  triggerCause: TriggerCause;
  cycleCause: CycleCause;
  vtiMeasured: number;
  vteMeasured: number;
  ppeakMeasured: number;
}): MeasuredBreath | null {
  if (b.tEnd === null) return null;
  return {
    index: b.index,
    tStart: b.tStart,
    tInspEnd: b.tInspEnd,
    tPauseEnd: b.tPauseEnd,
    tEnd: b.tEnd,
    triggerCause: b.triggerCause,
    cycleCause: b.cycleCause,
    vti: b.vtiMeasured,
    vte: b.vteMeasured,
    ppeak: b.ppeakMeasured,
  };
}

export function deviceContext(s: VentSettings): DeviceContext {
  const above = s.mode === 'PC-AC' ? s.pinsp : s.mode === 'PSV' ? s.ps : 0;
  return {
    mode: s.mode,
    peep: s.peep,
    pTarget: s.peep + above,
    riseTime: s.riseTime,
    ets: s.ets,
    flowTrigger: s.flowTrigger,
    pressureTrigger: s.pressureTrigger,
    triggerType: s.triggerType,
    highPpeak: s.alarms.highPpeak,
  };
}

export type { VentEvent };
