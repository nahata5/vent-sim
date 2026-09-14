/**
 * Signal-only dyssynchrony detector (Spec §7 detector rules, Brief 1 §3, §3.13). Inputs: measured Paw,
 * flow and volume at the device rate, the ventilator's own event markers and settings. Every label
 * carries an evidence string with the measured number and the threshold it crossed. Thresholds are
 * cited constants (DET_*), tuned on the tuning grid in scripts/tune-detector.ts and scored on the
 * disjoint held-out grid in tests/detector/heldout.test.ts.
 *
 * Two passes: per-breath candidate rules, then look-ahead rules that need the following breath (a
 * breath followed by a stacked breath was cycled prematurely; it was not an auto-trigger).
 */
import { k } from '../config/constants';
import type { PatternId } from '../sim/truth/labeler';
import type { VentEvent } from '../sim/types';
import type { VentSettings } from '../sim/vent/settings';
import type { HeadlessResult } from '../sim/headless';
import { breathEventAt } from '../sim/vent/breath-kind';
import { deviceContext, extractFeatures, measuredBreath, type BreathFeatures, type DeviceContext, type MeasuredBreath, type MeasuredReader, type PassiveRef } from './features';

export interface DetectedBreath {
  breathIndex: number;
  tStart: number;
  tEnd: number;
  patterns: PatternId[];
  evidence: Partial<Record<PatternId, string>>;
  features: BreathFeatures;
}

export interface IeEvent {
  t: number;
  breathIndex: number;
  evidence: string;
  phase: 'exp' | 'insp';
}

export interface DetectorOutput {
  breaths: DetectedBreath[];
  ieEvents: IeEvent[];
  readChannels: string[];
}

export interface DetectorInput {
  reader: MeasuredReader;
  breaths: MeasuredBreath[];
  events: VentEvent[];
  ctxAt: (t: number) => DeviceContext;
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? NaN) : 0.5 * ((s[m - 1] ?? 0) + (s[m] ?? 0));
}

interface Candidate {
  b: MeasuredBreath;
  f: BreathFeatures;
  ctx: DeviceContext;
  patterns: PatternId[];
  evidence: Partial<Record<PatternId, string>>;
  /** Early-return ratio (observed / predicted time for expiratory flow to reach ~0), NaN when not observable. */
  returnRatio: number;
  rtCandidate: boolean;
  rtPhase: number;
  autoTriggerCandidate: boolean;
  ieInsp: IeEvent | null;
  ieExp: IeEvent[];
}

export function detect(inp: DetectorInput): DetectorOutput {
  const seen = new Set<string>();
  const triggers = inp.events.filter((e): e is Extract<VentEvent, { type: 'trigger' }> => e.type === 'trigger');
  const cands: Candidate[] = [];
  let ti = 0;
  const tiHist: number[] = [];
  const cHist: number[] = [];
  const cBase: number[] = [];
  const vHist: Array<[number, number]> = [];
  let ppeakRun = NaN;
  const rtPhases: number[] = [];
  const rStepHist: number[] = [];
  const tauHist: number[] = [];

  for (let bi = 0; bi < inp.breaths.length; bi++) {
    const b = inp.breaths[bi];
    if (!b) continue;
    while (ti < triggers.length - 1 && (triggers[ti + 1]?.t ?? Infinity) <= b.tStart + 1e-9) ti += 1;
    const trig = triggers[ti];
    const triggerT = trig && trig.t <= b.tStart + 1e-9 ? trig.t : b.tStart;
    const nextTrig = triggers[ti + 1];
    const ctx0 = inp.ctxAt(b.tStart);
    const be = breathEventAt(inp.events, b.tStart);
    const ctx: DeviceContext = be ? { ...ctx0, breathKind: be.kind, pTarget: Number.isFinite(be.pTarget) ? be.pTarget : ctx0.pTarget } : ctx0;
    const prev = inp.breaths[bi - 1];

    const prevInspEnd = prev ? (Number.isNaN(prev.tPauseEnd) ? prev.tInspEnd : prev.tPauseEnd) : null;
    const ref: PassiveRef = {
      rMax: rStepHist.length ? Math.max(...rStepHist) : NaN,
      tauMed: tauHist.length >= 1 ? median(tauHist) : NaN,
      vTrapped: prev && prev.vti > 0.05 ? Math.max(0, prev.vti - prev.vte) : 0,
    };
    const recent = inp.breaths.slice(Math.max(0, bi - 6), bi).flatMap((x) => [x.tStart, Number.isNaN(x.tPauseEnd) ? x.tInspEnd : x.tPauseEnd]);
    const f = extractFeatures(inp.reader, b, ctx, triggerT, prevInspEnd, prev ? prev.tStart : null, nextTrig ? nextTrig.t : null, ref, recent, seen);
    const c: Candidate = { b, f, ctx, patterns: [], evidence: {}, returnRatio: NaN, rtCandidate: false, rtPhase: 0, autoTriggerCandidate: false, ieInsp: null, ieExp: [] };
    const add = (p: PatternId, e: string) => {
      if (!c.patterns.includes(p)) {
        c.patterns.push(p);
        c.evidence[p] = e;
      }
    };
    const medTi = tiHist.length >= 3 ? median(tiHist) : f.ti;
    const isPressure = ctx.breathKind !== 'vc';
    const spont = ctx.breathKind === 'ps';
    const tauFit = Number.isFinite(f.lsqR) && Number.isFinite(f.lsqC) && f.lsqR > 0 ? (f.lsqR * f.lsqC) / 1000 : NaN;
    // Passive expiratory time constant: the running maximum over previous breaths (an effort only shortens
    // the apparent decay), else this breath's own fit, else the equation-of-motion fit.
    const tauOwn = Number.isFinite(f.tauExp) ? f.tauExp : tauFit;
    const tau = Number.isFinite(ref.tauMed) ? Math.max(ref.tauMed, Number.isFinite(tauOwn) ? tauOwn : 0) : tauOwn;
    const qPk = Math.abs(f.peakExpFlow);
    const retPred = Number.isFinite(tau) && qPk > 2 ? tau * Math.log(qPk / 1) : NaN;
    if (Number.isFinite(f.expReturnTime) && Number.isFinite(retPred) && f.expReturnTime < f.te - k('DET_RETURN_MARGIN')) {
      c.returnRatio = f.expReturnTime / retPred;
    }
    const earlyReturn = c.returnRatio < k('DET_RETURN_RATIO') && f.expReturnTime < k('DET_RETURN_MAX');
    // A regular heart-rate oscillation raises every notch threshold by its own amplitude.
    const cardiacExtra = f.cardiacRegular ? k('DET_CARDIAC_NOTCH_FACTOR') * f.cardiacOsc : 0;
    const sawtooth = f.expHpRms > k('DET_SECRETIONS_HP_RMS');
    const earlyNotch = sawtooth ? undefined : f.notches.find((n) => n.tStart - b.tInspEnd < k('DET_PREM_WINDOW') && n.rise >= k('DET_PREM_NOTCH') + cardiacExtra);
    // For the reverse-trigger phase a Chen-sized effort notch suffices: the phase lock supplies the specificity.
    const earlyEffort = sawtooth ? undefined : f.notches.find((n) => n.tStart - b.tInspEnd < k('DET_RT_EXP_WINDOW') && n.rise >= k('DET_IE_FDEF') + cardiacExtra);
    // Leak evidence from the volumes of the last breaths (known at breath end). Every breath enters the
    // sums, including the small stacked breath of a double trigger whose exhaled volume belongs to the pair.
    vHist.push([b.vti, b.vte]);
    if (vHist.length > 8) vHist.shift();
    const sumIn = vHist.reduce((a, [x]) => a + x, 0);
    const leakRatio = vHist.length >= 4 && sumIn > 0.2 ? vHist.reduce((a, [, y]) => a + y, 0) / sumIn : 1;
    const leakEvident = leakRatio < k('DET_LEAK_RATIO');

    // ── Trigger side.
    if (b.triggerCause === 'patient') {
      const teBefore = prev ? b.tStart - (Number.isNaN(prev.tPauseEnd) ? prev.tInspEnd : prev.tPauseEnd) : Infinity;
      const vteRatio = prev && prev.vti > 0.05 ? prev.vte / prev.vti : 1;
      const teLimit = Math.max(k('DET_DT_TE_FRACTION') * medTi, k('DET_DT_TE_MAX'));
      const afterRt = prev !== undefined && prev.triggerCause !== 'patient' && teBefore < k('DET_DT_RT_TE');
      if ((teBefore < teLimit || afterRt) && vteRatio < k('DET_DT_VTE_RATIO')) {
        add(
          'double-trigger',
          afterRt && teBefore >= teLimit
            ? `patient trigger ${f2(teBefore)} s after a machine breath (< ${k('DET_DT_RT_TE')} s) with its volume not exhaled (Vte/Vti ${f2(vteRatio)}): stacking on an entrained effort`
            : `Te ${f2(teBefore)} s < ${f2(teLimit)} s (½·Ti ${f2(medTi)} or ${k('DET_DT_TE_MAX')} s); Vte/Vti of the first breath ${f2(vteRatio)} < ${k('DET_DT_VTE_RATIO')}`,
        );
      } else {
        const noDip = f.preDipSmooth < k('DET_AT_PAW_DIP');
        const noRamp = f.preFlowRise < k('DET_AT_FLOW_RISE');
        // Cardiac: heart-rate-band flow oscillation before the trigger with only a cardiac-sized inflection.
        const cardiac = f.cardiacOsc >= k('DET_AT_CARDIAC_OSC') && f.cardiacRegular && noRamp;
        // Leak: the net flow crosses the trigger threshold during its own decay toward the leak baseline.
        const onLeak = leakEvident && noRamp && f.preFlowFloor > -k('DET_AT_FLOW_RISE');
        if (noDip && (cardiac || onLeak)) {
          c.autoTriggerCandidate = true;
          c.evidence['auto-trigger'] = `pre-trigger Paw dip ${f2(f.preDipSmooth)} < ${k('DET_AT_PAW_DIP')} cmH2O; ${cardiac ? `regular ${f1(f.cardiacOsc)} L/min flow oscillation at ${f1(60 / Math.max(0.01, f.cardiacPeriod))}/min before the trigger (≥ ${k('DET_AT_CARDIAC_OSC')} L/min), inflection only ${f1(f.preFlowRise)} L/min` : `leak (ΣVte/ΣVti ${f2(leakRatio)} < ${k('DET_LEAK_RATIO')}) and no effort ramp (flow rise ${f1(f.preFlowRise)} < ${k('DET_AT_FLOW_RISE')} L/min from a floor of ${f1(f.preFlowFloor)} L/min)`}`;
        } else {
          // Effort onset: the Paw dip onset, or the start of the expiratory flow deflection that was still
          // rising when the previous breath ended (the deflection that became this trigger).
          const prevDefl = cands.length ? (cands[cands.length - 1]?.f.lastDeflectionStart ?? NaN) : NaN;
          const flowLead = Number.isFinite(prevDefl) && triggerT - prevDefl <= k('DET_DT_RT_TE') ? triggerT - prevDefl : 0;
          const lead = Math.max(f.preDipDuration, flowLead);
          if (lead > k('DET_DELAYED_TRIGGER')) {
            add('delayed-trigger', `effort onset → trigger ${f2(lead)} s > ${k('DET_DELAYED_TRIGGER')} s (Paw dip ${f2(f.preDip)} cmH2O over ${f2(f.preDipDuration)} s, flow deflection from ${f2(flowLead)} s before the trigger)`);
          }
        }
      }
    } else {
      // Machine breath: reverse-trigger candidates need an effort signature AND a stable phase.
      const vcDip = !isPressure && !sawtooth && f.midInspDip >= k('DET_RT_PAW_DIP');
      const pcHump = isPressure && !sawtooth && f.inspHump >= k('DET_RT_FLOW_HUMP') && f.inspHumpTime > 0.2;
      const phase = vcDip ? f.midInspDipTime : pcHump ? f.inspHumpTime : earlyEffort ? earlyEffort.tStart - b.tStart : earlyReturn && !sawtooth ? f.ti + f.expReturnTime : NaN;
      if (Number.isFinite(phase)) {
        const med = median(rtPhases.slice(-4));
        const locked = rtPhases.length >= 1 && Math.abs(phase - med) <= k('DET_RT_PHASE_TOL') * med + 0.05;
        rtPhases.push(phase);
        if (rtPhases.length > 8) rtPhases.shift();
        const why = vcDip
          ? `mid-inspiratory Paw dip ${f1(f.midInspDip)} ≥ ${k('DET_RT_PAW_DIP')} cmH2O at ${f2(f.midInspDipTime)} s`
          : pcHump
            ? `inspiratory flow hump ${f1(f.inspHump)} ≥ ${k('DET_RT_FLOW_HUMP')} L/min at ${f2(f.inspHumpTime)} s`
            : earlyEffort
              ? `early-expiratory effort notch ${f1(earlyEffort.rise)} L/min (≥ ${f1(k('DET_IE_FDEF') + cardiacExtra)}) ${f2(earlyEffort.tStart - b.tInspEnd)} s after cycle-off`
              : `expiratory flow back to zero in ${f2(f.expReturnTime)} s, ${f2(c.returnRatio)}× the τ prediction (< ${k('DET_RETURN_RATIO')})`;
        if (locked) {
          c.rtCandidate = true;
          c.rtPhase = phase;
          add('reverse-trigger', `${why}; phase ${f2(phase)} s locked to the machine breath (median ${f2(med)} s)`);
        } else if (pcHump || vcDip) {
          // An effort inside a machine insufflation that is not phase-locked: ineffective effort (inspiratory).
          c.ieInsp = { t: b.tStart + phase, breathIndex: b.index, evidence: `${why}; not phase-locked (median ${f2(med)} s)`, phase: 'insp' };
          add('ineffective-effort', c.ieInsp.evidence);
        }
      }
    }

    // ── Cycling (pass 2 strips these from breaths that remain stacked, as in the truth rule).
    if (b.triggerCause === 'patient' || spont) {
      if (b.cycleCause !== 'ti-max' && (earlyNotch || earlyReturn || (f.earlyExpPawDip > k('DET_PREM_PAW_DIP') && f.ti < 0.8 * medTi))) {
        add(
          'premature-cycling',
          earlyNotch
            ? `early-expiratory flow notch ${f1(earlyNotch.rise)} L/min at ${f2(earlyNotch.tStart - b.tInspEnd)} s after cycle-off`
            : earlyReturn
              ? `expiratory flow back to zero in ${f2(f.expReturnTime)} s, ${f2(c.returnRatio)}× the τ prediction (< ${k('DET_RETURN_RATIO')}): the effort outlasted the breath`
              : `Paw ${f1(f.earlyExpPawDip)} below PEEP after cycling; Ti ${f2(f.ti)} s short`,
        );
      }
      if (!isPressure && b.triggerCause === 'patient' && f.rampConvexity <= -k('DET_DC_VC_CONCAVITY')) {
        add('delayed-cycling', `patient-triggered VC breath with a concave-down Paw ramp (${f1(f.rampConvexity)} cmH2O ≤ −${k('DET_DC_VC_CONCAVITY')}): the effort was relaxing during the insufflation, so the breath outlasted it${c.patterns.includes('delayed-trigger') ? ' (late trigger)' : ''}`);
      }
      if (isPressure) {
        const rise = f.endInspRiseSmooth > k('DET_DC_PAW_RISE');
        const tiMax = b.cycleCause === 'ti-max';
        const shoulder = f.shoulderTail > k('DET_DC_SHOULDER_TAIL');
        const long = tiHist.length >= 3 && f.ti > k('DET_DC_TI_RATIO') * medTi;
        const tauTi = spont && Number.isFinite(f.inspTailTau) ? f.inspTailTau * Math.log(1 / Math.max(0.05, ctx.ets)) : NaN;
        const slowDecay = Number.isFinite(tauTi) && tauTi > k('DET_DC_TAU_TI') && f.ti > 0.8 * tauTi;
        const knee = f.slowTail >= k('DET_DC_KNEE_TAIL');
        if (rise || tiMax || shoulder || knee || long || slowDecay) {
          add(
            'delayed-cycling',
            rise
              ? `end-inspiratory Paw ${f1(f.endInspRiseSmooth)} above target (> ${k('DET_DC_PAW_RISE')})`
              : tiMax
                ? `cycled on Ti max after ${f2(f.ti)} s`
                : shoulder
                  ? `flow shoulder ${f2(f.shoulderTail)} s before cycle-off (> ${k('DET_DC_SHOULDER_TAIL')})`
                  : knee
                    ? `inspiratory flow decay knee (local τ doubled, passive tail ≥ ${k('DET_DC_KNEE_TAU')} s) ${f2(f.slowTail)} s before cycle-off (≥ ${k('DET_DC_KNEE_TAIL')})`
                  : long
                    ? `Ti ${f2(f.ti)} s > ${k('DET_DC_TI_RATIO')}× median ${f2(medTi)} s`
                    : `inspiratory flow tail τ ${f2(f.inspTailTau)} s with ETS ${Math.round(ctx.ets * 100)}% predicts ${f2(tauTi)} s to cycle (> ${k('DET_DC_TAU_TI')} s); Ti ${f2(f.ti)} s`,
          );
        }
      }
    }

    // ── Flow starvation (VC; the secretion sawtooth on Paw masks every ramp-shape rule).
    if (!isPressure && !sawtooth) {
      const steep = f.rampSlope > 0 && f.rampEndSlope >= k('DET_FS_END_STEEPENING') * f.rampSlope;
      if (f.rampConvexity >= k('DET_FS_CONVEXITY')) add('flow-starvation', `Paw ramp scooped: convexity ${f1(f.rampConvexity)} cmH2O (≥ ${k('DET_FS_CONVEXITY')}; mid-ramp ${f1(f.concavity)} below the chord)`);
      else if (f.concavity >= k('DET_FS_CONCAVITY')) add('flow-starvation', `Paw ramp scooped by ${f1(f.concavity)} cmH2O (≥ ${k('DET_FS_CONCAVITY')})`);
      else if (f.rampMinAbovePeep < 0.5) add('flow-starvation', `Paw fell to PEEP (${f1(f.rampMinAbovePeep)} above) during inspiration`);
      else if (steep) add('flow-starvation', `Paw ramp steepens from ${f1(f.rampSlope)} to ${f1(f.rampEndSlope)} cmH2O/s in the last 15% of Ti (≥ ${k('DET_FS_END_STEEPENING')}×): the effort relaxed before cycle-off`);
      else if (f.ptpDeficit >= k('DET_FS_PTP')) {
        add('flow-starvation', `Paw ${f2(f.ptpDeficit)} cmH2O·s below the passive prediction over inspiration (≥ ${k('DET_FS_PTP')}; τe ${f2(f.tauExp)} s, R ${f1(f.rStep)})`);
      }
    }
    // ── Overshoot.
    if (isPressure && f.overshoot > k('DET_OVERSHOOT_MARGIN')) add('overshoot', `Paw ${f1(f.overshoot)} above target in the first 200 ms (> ${k('DET_OVERSHOOT_MARGIN')})`);
    // ── Support withdrawal (PRVC, report only): the regulated pressure sits at its floor while the airway
    // pressure still sags below that target early in inspiration — the patient is supplying the volume.
    if (ctx.mode === 'PRVC' && ctx.breathKind === 'pc' && ctx.pTarget - ctx.peep <= ctx.prvcMinDp + k('LABEL_SUPPORT_WITHDRAWAL_MARGIN') && f.earlySag >= k('DET_SW_SAG')) {
      add('support-withdrawal', `ΔP ${f1(ctx.pTarget - ctx.peep)} within ${k('LABEL_SUPPORT_WITHDRAWAL_MARGIN')} of the floor ${ctx.prvcMinDp}, Paw sag ${f1(f.earlySag)} ≥ ${k('DET_SW_SAG')}`);
    }
    // ── Inspiratory IE on a pressure-targeted spontaneous breath: a flow hump after the peak.
    if (spont && !sawtooth && b.triggerCause === 'patient' && f.inspHump >= k('DET_IE_HUMP') && f.inspHumpTime > 0.25) {
      const e = `inspiratory flow hump ${f1(f.inspHump)} L/min ≥ ${k('DET_IE_HUMP')} at ${f2(f.inspHumpTime)} s (effort during insufflation)`;
      c.ieInsp = { t: b.tStart + f.inspHumpTime, breathIndex: b.index, evidence: e, phase: 'insp' };
      add('ineffective-effort', e);
    }
    // ── Expiratory IE: Chen 2008 flow-deflection criterion on notches after the blanking window. The Paw
    // deflection is not usable through an active exhalation valve (D-012); a regular cardiac oscillation
    // raises the flow threshold by its own amplitude, and the secretion sawtooth masks the rule.
    const blank = b.triggerCause === 'patient' ? k('DET_IE_EXP_BLANK') : 0.05;
    for (const n of f.notches) {
      const dt = n.tStart - b.tInspEnd;
      if (sawtooth || dt < blank || n.duration < k('DET_IE_MIN_DURATION')) continue;
      if (c.rtCandidate && dt < k('DET_RT_EXP_WINDOW')) continue; // the entrained effort itself
      const thr = k('DET_IE_FDEF') + cardiacExtra;
      if (n.rise >= thr) {
        const e = `Fdef ${f1(n.rise)} L/min ≥ ${f1(thr)}${cardiacExtra > 0 ? ` (${k('DET_IE_FDEF')} + cardiac ${f1(cardiacExtra)})` : ''} over ${f2(n.duration)} s (Pdef ${f2(n.pawDip)})`;
        c.ieExp.push({ t: n.tPeak, breathIndex: b.index, evidence: e, phase: 'exp' });
        add('ineffective-effort', e);
      }
    }
    // ── Auto-PEEP, leak, secretions, resistance, compliance, cough.
    if (f.endExpFlow < -k('DET_AUTOPEEP_FLOW')) add('auto-peep', `end-expiratory flow ${f1(f.endExpFlow)} L/min (< −${k('DET_AUTOPEEP_FLOW')})`);
    if (leakEvident) add('leak', `ΣVte/ΣVti ${f2(leakRatio)} over ${vHist.length} breaths < ${k('DET_LEAK_RATIO')}`);
    if (f.expHpRms > k('DET_SECRETIONS_HP_RMS')) add('secretions', `expiratory flow 5–20 Hz energy ${f2(f.expHpRms)} L/min > ${k('DET_SECRETIONS_HP_RMS')}`);
    const prevEefForR = cands.length ? (cands[cands.length - 1]?.f.endExpFlow ?? 0) : 0;
    if (!isPressure && Number.isFinite(f.rStep) && f.rStep > k('DET_HIGH_R') && prevEefForR > -k('DET_HIGH_R_EEF')) {
      add('high-resistance', `inspiratory resistance from the resistive step ${f1(f.rStep)} cmH2O/L/s > ${k('DET_HIGH_R')} (end-expiratory flow ${f1(prevEefForR)} L/min, no auto-PEEP inflating the step)`);
    }
    // Compliance from the equation-of-motion fit is only trustworthy without patient effort in the fit
    // window: controlled modes, breaths that carry no dyssynchrony flag.
    const asynchronous = c.patterns.some((p) => ['double-trigger', 'premature-cycling', 'flow-starvation', 'reverse-trigger', 'ineffective-effort'].includes(p)) || c.autoTriggerCandidate;
    if (!spont && !asynchronous && Number.isFinite(f.lsqC) && f.lsqC > 0) {
      const base = cBase.length >= 5 ? median(cBase) : NaN;
      const drop = Number.isFinite(base) && f.lsqC < k('DET_LOW_C_DROP') * base;
      if (f.lsqC < k('DET_LOW_C') || drop) {
        add('low-compliance', drop ? `fitted C ${f1(f.lsqC)} mL/cmH2O < ${k('DET_LOW_C_DROP')}× baseline ${f1(base)}` : `fitted C ${f1(f.lsqC)} mL/cmH2O < ${k('DET_LOW_C')}`);
      }
      if (cBase.length < 5) cBase.push(f.lsqC);
    }
    if (b.cycleCause === 'alarm' && f.pawMaxSlope > k('DET_COUGH_SLOPE') && Number.isFinite(ppeakRun) && f.pawMax > ppeakRun + k('DET_COUGH_SPIKE')) {
      add('cough', `Paw spike ${f1(f.pawMax)} cmH2O rising at ${f1(f.pawMaxSlope)} cmH2O/s (> ${k('DET_COUGH_SLOPE')}) with alarm cycling`);
    }

    // Running references, excluding aberrant breaths.
    if (!c.patterns.includes('double-trigger') && b.cycleCause !== 'alarm') {
      tiHist.push(f.ti);
      if (tiHist.length > 12) tiHist.shift();
      ppeakRun = Number.isFinite(ppeakRun) ? 0.8 * ppeakRun + 0.2 * b.ppeak : b.ppeak;
      if (Number.isFinite(f.lsqC) && f.lsqC > 0) {
        cHist.push(f.lsqC);
        if (cHist.length > 10) cHist.shift();
      }
      if (Number.isFinite(f.rStep) && f.rStep > 0 && f.rStep < 60) {
        rStepHist.push(f.rStep);
        if (rStepHist.length > 10) rStepHist.shift();
      }
      if (Number.isFinite(f.tauExp) && f.tauExp > 0.1 && f.tauExp < 5) {
        tauHist.push(f.tauExp);
        if (tauHist.length > 10) tauHist.shift();
      }
    }
    cands.push(c);
  }

  // ── Pass 2: look-ahead rules.
  const out: DetectedBreath[] = [];
  const ieEvents: IeEvent[] = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!c) continue;
    const next = cands[i + 1];
    let nextIsStacked = next?.patterns.includes('double-trigger') === true;
    // An auto-triggered breath had no effort behind it, so a patient trigger that follows it with its own
    // effort ramp is that effort's breath, not a stacked one; the auto-trigger stands.
    if (nextIsStacked && next && c.autoTriggerCandidate && next.f.preFlowRise >= k('DET_AT_FLOW_RISE')) {
      const idx = next.patterns.indexOf('double-trigger');
      if (idx >= 0) next.patterns.splice(idx, 1);
      delete next.evidence['double-trigger'];
      nextIsStacked = false;
    }
    if (nextIsStacked && next && c.b.triggerCause === 'patient' && !c.patterns.includes('premature-cycling')) {
      c.patterns.push('premature-cycling');
      c.evidence['premature-cycling'] = `the effort re-triggered a stacked breath ${f2(next.b.tStart - c.b.tInspEnd)} s after cycle-off`;
    }
    if (nextIsStacked && next && c.b.triggerCause !== 'patient' && !c.patterns.includes('reverse-trigger')) {
      c.patterns.push('reverse-trigger');
      c.evidence['reverse-trigger'] = `machine breath followed by a stacked patient trigger ${f2(next.b.tStart - c.b.tInspEnd)} s after cycle-off (reverse trigger with breath stacking)`;
      const ieIdx = c.patterns.indexOf('ineffective-effort');
      if (ieIdx >= 0 && c.ieInsp) {
        c.patterns.splice(ieIdx, 1);
        delete c.evidence['ineffective-effort'];
        c.ieInsp = null;
      }
    }
    if (c.autoTriggerCandidate && !nextIsStacked) {
      c.patterns.push('auto-trigger');
      for (const p of ['premature-cycling', 'delayed-cycling', 'delayed-trigger'] as const) {
        const idx = c.patterns.indexOf(p);
        if (idx >= 0) {
          c.patterns.splice(idx, 1);
          delete c.evidence[p];
        }
      }
    } else if (c.autoTriggerCandidate) {
      delete c.evidence['auto-trigger'];
    }
    if (c.patterns.includes('double-trigger')) {
      for (const p of ['premature-cycling', 'delayed-cycling'] as const) {
        const idx = c.patterns.indexOf(p);
        if (idx >= 0) {
          c.patterns.splice(idx, 1);
          delete c.evidence[p];
        }
      }
    }
    if (c.ieInsp) ieEvents.push(c.ieInsp);
    ieEvents.push(...c.ieExp);
    out.push({ breathIndex: c.b.index, tStart: c.b.tStart, tEnd: c.b.tEnd, patterns: c.patterns, evidence: c.evidence, features: c.f });
  }
  return { breaths: out, ieEvents, readChannels: [...seen] };
}

/** Measured-only reader over a headless result. */
export function measuredReaderFromHeadless(res: HeadlessResult): MeasuredReader {
  const t0 = res.t[0] ?? 0;
  const cols = { t: res.t, paw: res.paw, flow: res.flow, vol: res.vol, pes: res.pes } as const;
  return {
    n: res.t.length,
    fs: res.fs,
    read: (ch, i) => cols[ch][i] ?? NaN,
    indexAt: (t) => {
      const i = Math.round((t - t0) * res.fs);
      return i < 0 || i >= res.t.length ? -1 : i;
    },
  };
}

export function ctxFromSettingsLog(log: Array<{ t: number; settings: VentSettings }>): (t: number) => DeviceContext {
  return (t) => {
    let s = log[0]?.settings;
    for (const e of log) if (e.t <= t + 1e-9) s = e.settings;
    if (!s) throw new Error('no settings');
    return deviceContext(s);
  };
}

/** Run the detector over a complete headless run (tests, batch export, Validation page). */
export function detectRun(res: HeadlessResult): DetectorOutput {
  const breaths = res.breaths.map(measuredBreath).filter((b): b is MeasuredBreath => b !== null);
  return detect({ reader: measuredReaderFromHeadless(res), breaths, events: res.events, ctxAt: ctxFromSettingsLog(res.settingsLog) });
}
