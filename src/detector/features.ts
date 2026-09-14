/**
 * Per-breath features from MEASURED signals only (Paw, flow, volume at the device rate), the ventilator's
 * own event markers and its settings. No truth channel is ever read here: the reader type only exposes the
 * measured keys, and `readChannels` records every channel touched so tests can prove it.
 */
import type { CycleCause, Mode, TriggerCause, VentEvent } from '../sim/types';
import type { VentSettings } from '../sim/vent/settings';
import { k } from '../config/constants';
import { breathKindFromMode, type BreathKind } from '../sim/vent/breath-kind';

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
  breathKind: BreathKind;
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
  rise: number; // L/min, trough to crest (Chen 2008 Fdef)
  deviation: number; // L/min, crest above the extrapolated passive decay
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
  /** VC: slope of the Paw ramp between 20% and 85% of Ti, cmH2O/s, and over the last 15% of Ti. */
  rampSlope: number;
  rampEndSlope: number;
  /** VC: mid-ramp deviation of the least-squares parabola from its chord, cmH2O (positive = scooped). */
  rampConvexity: number;
  /** PSV: time constant of the inspiratory flow decay tail (flow between ETS and 1.5·ETS of peak), s. */
  inspTailTau: number;
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
  /** Autocorrelation of the residual at the best heart-rate lag and at twice that lag. */
  cardiacCorr: number;
  cardiacCorr2: number;
  /** Pre-trigger Paw dip on a 0.1 s moving average (noise RMS ≈ 0.05), cmH2O. */
  preDipSmooth: number;
  /** End-inspiratory Paw rise above target on a 0.1 s moving average (pressure-targeted), cmH2O. */
  endInspRiseSmooth: number;
  /** Expiratory notches form a heart-rate-spaced train of similar size. */
  notchTrain: boolean;
  /** PSV/PC: seconds from the knee of the inspiratory flow decay (local τ doubling) to cycle-off. */
  slowTail: number;
  /** Start (s) of a flow deflection still rising at the breath end: the onset of the next breath's effort. */
  lastDeflectionStart: number;
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
  let preDipSmooth = 0;
  {
    const wp = Math.max(1, Math.round(0.1 * fs));
    let minSm = Infinity;
    for (let i = Math.max(wp, iTrig - pre); i <= iTrig; i++) {
      let m = 0;
      for (let j = i - wp + 1; j <= i; j++) m += rd('paw', j);
      minSm = Math.min(minSm, m / wp);
    }
    preDipSmooth = Number.isFinite(minSm) ? Math.max(0, baseline - minSm) : 0;
  }
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
  let endInspRiseSmooth = -Infinity;
  {
    const wp = Math.max(1, Math.round(0.1 * fs));
    for (let i = Math.max(iLastThird, iS + wp); i <= iC; i++) {
      let m = 0;
      for (let j = i - wp + 1; j <= i; j++) m += rd('paw', j);
      endInspRiseSmooth = Math.max(endInspRiseSmooth, m / wp - ctx.pTarget);
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
  const rampEndSlope = ((rd('paw', iC) - p85) * fs) / Math.max(1, iC - i85);
  // Least-squares quadratic over the ramp (20% of Ti to cycle-off): the parabola's deviation from its own
  // chord at mid-ramp, cmH2O (positive = convex / scooped, as when Pmus rises during the insufflation;
  // a passive ramp is linear to slightly concave-down). Uses every sample, unlike the 3-point concavity.
  let rampConvexity = 0;
  if (iC - i20 >= 6) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, sy = 0, sxy = 0, sx2y = 0;
    const T = (iC - i20) / fs;
    for (let i = i20; i <= iC; i++) {
      const x = (i - i20) / fs;
      const y = rd('paw', i);
      s0 += 1; s1 += x; s2 += x * x; s3 += x * x * x; s4 += x * x * x * x; sy += y; sxy += x * y; sx2y += x * x * y;
    }
    const m = [
      [s0, s1, s2],
      [s1, s2, s3],
      [s2, s3, s4],
    ];
    const det = (mm: number[][]) =>
      (mm[0]?.[0] ?? 0) * ((mm[1]?.[1] ?? 0) * (mm[2]?.[2] ?? 0) - (mm[1]?.[2] ?? 0) * (mm[2]?.[1] ?? 0)) -
      (mm[0]?.[1] ?? 0) * ((mm[1]?.[0] ?? 0) * (mm[2]?.[2] ?? 0) - (mm[1]?.[2] ?? 0) * (mm[2]?.[0] ?? 0)) +
      (mm[0]?.[2] ?? 0) * ((mm[1]?.[0] ?? 0) * (mm[2]?.[1] ?? 0) - (mm[1]?.[1] ?? 0) * (mm[2]?.[0] ?? 0));
    const dm = det(m);
    if (Math.abs(dm) > 1e-12) {
      const rhs = [sy, sxy, sx2y];
      const mc = m.map((row, i) => row.map((x, j) => (j === 2 ? (rhs[i] ?? 0) : x)));
      const cq = det(mc) / dm;
      rampConvexity = (cq * T * T) / 4;
    }
  }
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
  // Inspiratory flow decay tail (pressure-targeted breaths): log-linear fit of flow between ETS and
  // 1.5·ETS of the peak, i.e. the passive part of the decay after the effort has relaxed.
  let inspTailTau = NaN;
  if (ctx.breathKind !== 'vc' && flowPeak > 0.05) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    const hi = 1.5 * ctx.ets * flowPeak;
    const lo = 0.9 * ctx.ets * flowPeak;
    for (let i = iFlowPeak; i <= iC; i++) {
      const q = rd('flow', i);
      if (q > hi || q < lo || q <= 0) continue;
      const x = (i - iFlowPeak) / fs;
      const y = Math.log(q);
      sx += x; sy += y; sxx += x * x; sxy += x * y; n += 1;
    }
    if (n >= 6) {
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      if (slope < -0.05) inspTailTau = -1 / slope;
    }
  }
  // Flow shoulder: the decay over a 100 ms window becoming ≥ 2× steeper than over the previous 100 ms
  // (the effort starts to relax), searched on 0.05 s-smoothed flow at 20 ms steps so the shoulder is not
  // missed by window phase; the first window must already be decaying so the flow crest does not count.
  let shoulderTail = 0;
  {
    const w = Math.max(2, Math.round(0.1 * fs));
    const w2 = Math.max(1, Math.round(0.05 * fs));
    const qsm = (i: number): number => {
      let m = 0;
      let n = 0;
      for (let j = Math.max(iS, i - w2); j <= Math.min(iC, i + w2); j++) {
        m += rd('flow', j);
        n += 1;
      }
      return n ? m / n : rd('flow', i);
    };
    for (let i = iS + Math.round(0.3 * nI); i + 2 * w <= iC; i += Math.max(1, Math.round(0.02 * fs))) {
      const s1 = qsm(i + w) - qsm(i);
      const s2 = qsm(i + 2 * w) - qsm(i + w);
      if (s1 * 60 <= -1 && s2 < 2 * s1 && (s2 - s1) * 60 < -3) {
        shoulderTail = (iC - (i + w)) / fs;
        break;
      }
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
  }
  // Notches: local min → rise toward zero → FALL BACK (flow more negative again) or a reversal above zero.
  // A monotonic decay toward zero is not a notch; the fall-back distinguishes an effort from the decay.
  // Notches: deviations of the expiratory flow above its own passive decay (the BetterCare "deviation from
  // expected flow" idea). The search runs on a centred 0.1 s moving average of flow so sensor noise
  // (0.3 L/min RMS) and the 5–20 Hz secretion sawtooth are removed while an effort deflection (≥ 0.15 s)
  // survives. The passive prediction q_A·exp(−Δt/τ_ref) is anchored at the last sample that sat on the decay
  // and re-anchored every DET_NOTCH_REANCHOR s while no deflection is under way, so a decay slower than the
  // reference τ (flow limitation, non-exponential tails) never accumulates into a false notch, and a
  // deflection's start is the anchor rather than a noise-induced local minimum far up the decay.
  const notches: FlowNotch[] = [];
  let lastDeflectionStart = NaN;
  {
    const wq = Math.max(1, Math.round(0.05 * fs));
    const qs = new Float64Array(Math.max(0, iE - iC + 1));
    for (let i = iC; i <= iE; i++) {
      let m = 0;
      let n = 0;
      for (let j = Math.max(iC, i - wq); j <= Math.min(iE, i + wq); j++) {
        m += rd('flow', j);
        n += 1;
      }
      qs[i - iC] = n ? m / n : rd('flow', i);
    }
    const q = (i: number): number => qs[Math.min(iE, Math.max(iC, i)) - iC] ?? 0;
    const tauRefN = Number.isFinite(ref.tauMed) ? ref.tauMed : Number.isFinite(tauExpEarly) ? tauExpEarly : Infinity;
    const onsetThr = k('DET_NOTCH_ONSET') / 60;
    const reanchor = Math.max(1, Math.round(k('DET_NOTCH_REANCHOR') * fs));
    const wp = Math.max(1, Math.round(0.1 * fs));
    let iA = Math.max(iPeakExp, iC + 1);
    let qA = q(iA);
    let inDef = false;
    let iPk = iA;
    let dMax = 0;
    let qPk = qA;
    for (let j = iA + 1; j <= iE; j++) {
      const qj = q(j);
      const pred = qA < 0 ? qA * Math.exp(-((j - iA) / fs) / tauRefN) : qA;
      const d = qj - pred;
      if (!inDef) {
        if (d >= onsetThr) {
          inDef = true;
          iPk = j;
          dMax = d;
          qPk = qj;
        } else if (d < 0 || j - iA >= reanchor) {
          iA = j;
          qA = qj;
        }
        continue;
      }
      if (d > dMax) {
        dMax = d;
        iPk = j;
        qPk = qj;
      }
      // A genuine notch falls back: after the crest the flow becomes more negative again (the effort
      // relaxes and the passive decay resumes). A deviation that merely fades because the prediction
      // caught up is a decay-shape artifact (non-exponential, two-compartment), and one still rising at
      // the breath end is the effort that triggered the next breath; both are discarded.
      const fellBack = qPk - qj >= Math.max(1.5 / 60, 0.15 * dMax) && j - iPk >= 2;
      const faded = d < 0.5 * onsetThr;
      if (!fellBack && !faded && j < iE) continue;
      // Rise reported trough-to-crest as Chen 2008 measured Fdef; the deviation above the decay (dMax) is
      // the qualifying test that separates a deflection from the decay itself.
      const rise = (qPk - qA) * 60;
      if (!fellBack && j === iE && dMax * 60 >= k('DET_NOTCH_ONSET')) lastDeflectionStart = rd('t', iA);
      if (fellBack && dMax * 60 >= k('DET_NOTCH_ONSET') && iPk > iA) {
        const duration = (j - iA) / fs;
        // Paw reference just before the deflection. The first 0.15 s after cycle-off still carry the
        // Ppeak → PEEP transient, so a notch that early takes its reference from the interval up to 0.25 s
        // after cycle-off (the dip itself comes at the crest, 0.1–0.2 s after the anchor).
        let base = 0;
        let nb = 0;
        const iBase0 = Math.max(iC + Math.round(0.15 * fs), iA - Math.round(0.3 * fs));
        const iBase1 = Math.max(iA, iC + Math.round(0.25 * fs));
        for (let q2 = iBase0; q2 < iBase1; q2++) {
          base += rd('paw', q2);
          nb += 1;
        }
        base = nb >= 3 ? base / nb : ctx.peep;
        // Dip on a 0.1 s moving average of Paw (raw minima over a window are biased low by noise).
        let pawMin = Infinity;
        for (let q2 = iA; q2 <= Math.min(iE, iPk + Math.round(0.1 * fs)); q2++) {
          let m = 0;
          for (let q3 = q2 - wp + 1; q3 <= q2; q3++) m += rd('paw', Math.max(0, q3));
          pawMin = Math.min(pawMin, m / wp);
        }
        notches.push({ tStart: rd('t', iA), tPeak: rd('t', iPk), rise, deviation: dMax * 60, duration, pawDip: base - pawMin, reversal: qPk > 0.5 / 60 });
      }
      iA = j;
      qA = qj;
      inDef = false;
      dMax = 0;
    }
  }
  // ── Expiratory time constant on the longest notch-free stretch of the decay (an effort inside the fit
  // window would make the "decay" look several times faster than the lung's), from 80 ms after the peak
  // until flow is above −2 L/min, 0.3 s before the next trigger, or 1.5 s, whichever first.
  {
    const iStartFit = iPeakExp + Math.round(0.08 * fs);
    const iStopFit = Math.min(iE, (nextTriggerT !== null ? r.indexAt(nextTriggerT) : iE) - Math.round(0.3 * fs), iPeakExp + Math.round(1.5 * fs));
    const cuts: Array<[number, number]> = notches.map((nn) => [r.indexAt(nn.tStart) - Math.round(0.05 * fs), r.indexAt(nn.tStart) + Math.round(nn.duration * fs) + Math.round(0.1 * fs)]);
    let best: [number, number] | null = null;
    let segStart = iStartFit;
    const closeSeg = (end: number) => {
      if (end - segStart >= 8 && (best === null || end - segStart > best[1] - best[0])) best = [segStart, end];
    };
    for (let i = iStartFit; i <= iStopFit; i++) {
      const inNotch = cuts.some(([a, b2]) => i >= a && i <= b2);
      const tooSmall = -rd('flow', i) < 4 / 60;
      if (inNotch || tooSmall) {
        closeSeg(i - 1);
        segStart = i + 1;
        if (tooSmall && !inNotch) break;
      }
    }
    closeSeg(iStopFit);
    if (best !== null) {
      const [a, b2] = best as [number, number];
      let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
      for (let i = a; i <= b2; i++) {
        const q = -rd('flow', i);
        if (q < 4 / 60) continue;
        const x = (i - a) / fs;
        const y = Math.log(q);
        sx += x; sy += y; sxx += x * x; sxy += x * y; n += 1;
      }
      if (n >= 8) {
        const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
        if (slope < -0.05) tauExp = -1 / slope;
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
  if (ctx.breathKind === 'vc') {
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
  // oscillation (≈ A/R) through inspiration and expiration alike, so the window spans the 5 s before the
  // trigger; samples within ±0.25 s of a phase transition (breath start, cycle-off, trigger) are masked.
  // Regularity is judged by the autocorrelation of the detrended, 0.15 s-smoothed residual: a periodic
  // oscillation at a heart-rate period T shows r(T) and r(2T) both positive, a single effort deflection
  // only raises r at lags shorter than its own width.
  let cardiacOsc = 0;
  let cardiacRegular = false;
  let cardiacPeriod = NaN;
  let cardiacCorr = NaN;
  let cardiacCorr2 = NaN;
  {
    const wLong = Math.round(0.4 * fs);
    const wShort = Math.max(1, Math.round(0.15 * fs));
    const guard = Math.round(0.25 * fs);
    const iA = Math.max(0, iTrig - Math.round(5.0 * fs));
    const iB = iTrig - Math.round(0.1 * fs);
    const masked = (i: number): boolean => transitions.some((it) => Math.abs(i - it) <= guard);
    const half = Math.round(wLong / 2);
    const n = Math.max(0, iB - iA + 1);
    const resid = new Float64Array(n).fill(NaN);
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
      resid[i - iA] = rd('flow', i) - m / nm;
    }
    const sm = new Float64Array(n).fill(NaN);
    let ss = 0;
    let ns = 0;
    for (let i = wShort; i < n; i++) {
      let m = 0;
      let ok = true;
      for (let j = i - wShort + 1; j <= i; j++) {
        const v = resid[j] ?? NaN;
        if (!Number.isFinite(v)) {
          ok = false;
          break;
        }
        m += v;
      }
      if (!ok) continue;
      const v = m / wShort;
      sm[i] = v;
      ss += v * v;
      ns += 1;
    }
    if (ns > 2 * fs) {
      const varS = ss / ns;
      cardiacOsc = Math.sqrt(varS) * Math.SQRT2 * 60;
      const rAt = (lag: number): number => {
        let s = 0;
        let np = 0;
        for (let i = 0; i + lag < n; i++) {
          const a = sm[i] ?? NaN;
          const b = sm[i + lag] ?? NaN;
          if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
          s += a * b;
          np += 1;
        }
        return np > 0.5 * fs && varS > 0 ? s / np / varS : NaN;
      };
      const lagLo = Math.round(0.4 * fs);
      const lagHi = Math.round(1.25 * fs);
      let best = -Infinity;
      let bestLag = 0;
      for (let lag = lagLo; lag <= lagHi; lag++) {
        const r = rAt(lag);
        if (r > best) {
          best = r;
          bestLag = lag;
        }
      }
      if (bestLag > 0) {
        cardiacPeriod = bestLag / fs;
        cardiacCorr = best;
        cardiacCorr2 = rAt(2 * bestLag);
        // When the window is too short for the double lag, a stronger single-lag correlation is required.
        cardiacRegular = Number.isFinite(cardiacCorr2) ? best >= k('DET_AT_CARDIAC_CORR') && cardiacCorr2 >= 0.5 * k('DET_AT_CARDIAC_CORR') : best >= 1.4 * k('DET_AT_CARDIAC_CORR');
      }
    }
  }
  // A train of similar notches at a heart-rate spacing in this expiration is the cardiac oscillation
  // itself (an effort train at ≥ 48/min would be needed to mimic it); it marks the breath as cardiac and
  // sets a floor on the oscillation amplitude (raw peak-to-peak ≈ 3.3× the smoothed RMS·√2 amplitude).
  let notchTrain = false;
  if (notches.length >= 2) {
    let ok = 0;
    for (let i = 1; i < notches.length; i++) {
      const a = notches[i - 1];
      const b2 = notches[i];
      if (!a || !b2) continue;
      const dt = b2.tStart - a.tStart;
      const similar = Math.abs(a.rise - b2.rise) <= 0.4 * Math.max(a.rise, b2.rise);
      if (dt >= 0.4 && dt <= 1.25 && similar && a.duration <= 0.9 * dt) ok += 1;
    }
    if (ok >= 1) {
      notchTrain = true;
      const med = median(notches.map((n) => n.rise));
      cardiacOsc = Math.max(cardiacOsc, med / 3.3);
      cardiacRegular = true;
    }
  }
  // ── Knee of the inspiratory flow decay (pressure-targeted breaths): once the effort has relaxed the
  // decay continues on the passive time constant; a local τ that doubles marks the neural end, and the
  // time from there to cycle-off is how long the ventilator kept insufflating a relaxed patient.
  let slowTail = 0;
  if (ctx.breathKind !== 'vc' && flowPeak > 0.05) {
    const w2 = Math.max(1, Math.round(0.05 * fs));
    const qsm = (i: number): number => {
      let m = 0;
      let n = 0;
      for (let j = Math.max(iS, i - w2); j <= Math.min(iC, i + w2); j++) {
        m += rd('flow', j);
        n += 1;
      }
      return n ? m / n : rd('flow', i);
    };
    const tauLocal = (i: number): number => {
      const dq = ((qsm(i + 2) - qsm(i - 2)) * fs) / 4;
      const q = qsm(i);
      return q > 0.03 && dq < -0.005 ? q / -dq : NaN;
    };
    // The knee is gradual (relaxation τ 0.2 s), so the 0.2 s window mean after a point is compared with the
    // smallest window mean seen earlier in the decay, not only with the adjacent window.
    const win = Math.max(2, Math.round(0.2 * fs));
    const meanTau = (from: number): number => {
      let s = 0, n = 0;
      for (let j = from; j < from + win; j++) {
        const t = tauLocal(j);
        if (Number.isFinite(t)) { s += t; n += 1; }
      }
      return n >= win / 2 ? s / n : NaN;
    };
    let tMin = Infinity;
    for (let i = iS + Math.round(0.4 * nI); i + win <= iC - Math.round(0.05 * fs); i += Math.max(1, Math.round(0.02 * fs))) {
      const ta = meanTau(i);
      if (!Number.isFinite(ta)) continue;
      if (Number.isFinite(tMin) && ta >= k('DET_DC_KNEE_RATIO') * tMin && ta >= k('DET_DC_KNEE_TAU')) {
        slowTail = (iC - i) / fs;
        break;
      }
      tMin = Math.min(tMin, ta);
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
    cardiacCorr,
    cardiacCorr2,
    preDipSmooth,
    endInspRiseSmooth: Number.isFinite(endInspRiseSmooth) ? endInspRiseSmooth : 0,
    notchTrain,
    slowTail,
    lastDeflectionStart,
    rampEndSlope,
    rampConvexity,
    inspTailTau,
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
    breathKind: breathKindFromMode(s),
    riseTime: s.riseTime,
    ets: s.ets,
    flowTrigger: s.flowTrigger,
    pressureTrigger: s.pressureTrigger,
    triggerType: s.triggerType,
    highPpeak: s.alarms.highPpeak,
  };
}

export type { VentEvent };
