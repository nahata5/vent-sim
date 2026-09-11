/**
 * Ground-truth labeler (Spec §7 truth rules, Brief 1 §3 timing margins). Labels come from neural timing
 * versus ventilator timing plus true physiology and injector state; they grade the quiz, score the
 * detector and populate exports. The detector never reads anything in this module.
 */
import { k } from '../../config/constants';
import type { ChannelKey } from '../../worker/protocol';
import type { BreathRecord, CycleCause, Mode, TriggerCause, VentEvent } from '../types';
import type { NeuralBreath } from '../patient/neural-drive';
import type { VentSettings } from '../vent/settings';
import type { InjectorKind, InjectorLogEntry } from '../injectors';
import type { HeadlessResult } from '../headless';
import { TRUTH_CHANNELS } from '../channels';

export type PatternId =
  | 'ineffective-effort'
  | 'auto-trigger'
  | 'delayed-trigger'
  | 'double-trigger'
  | 'reverse-trigger'
  | 'premature-cycling'
  | 'delayed-cycling'
  | 'flow-starvation'
  | 'overshoot'
  | 'auto-peep'
  | 'leak'
  | 'secretions'
  | 'water'
  | 'high-resistance'
  | 'low-compliance'
  | 'cough'
  | 'pendelluft'
  | 'overdistension'
  | 'tidal-recruitment'
  | 'high-effort'
  | 'low-effort';

export const PATTERN_IDS: readonly PatternId[] = [
  'ineffective-effort',
  'auto-trigger',
  'delayed-trigger',
  'double-trigger',
  'reverse-trigger',
  'premature-cycling',
  'delayed-cycling',
  'flow-starvation',
  'overshoot',
  'auto-peep',
  'leak',
  'secretions',
  'water',
  'high-resistance',
  'low-compliance',
  'cough',
  'pendelluft',
  'overdistension',
  'tidal-recruitment',
  'high-effort',
  'low-effort',
];

/** Patterns counted as asynchronous events in the AI numerator (Thille 2006 + reverse trigger). */
export const AI_EVENT_PATTERNS: readonly PatternId[] = ['double-trigger', 'auto-trigger', 'reverse-trigger', 'premature-cycling', 'delayed-cycling'];

export interface LabelContext {
  mode: Mode;
  peep: number;
  /** Absolute inspiratory pressure target for pressure-targeted breaths (PEEP + Pinsp/PS). */
  pTarget: number;
  injectors: InjectorKind[];
  rScale: number;
  eScale: number;
  /** Effective total inspiratory resistance (preset × injector), cmH2O/(L/s), and static Crs, mL/cmH2O. */
  rTotal: number;
  crs: number;
}

export interface LabelInput {
  fs: number;
  n: number;
  read: (ch: ChannelKey, i: number) => number;
  indexAt: (t: number) => number;
  breaths: BreathRecord[];
  neural: NeuralBreath[];
  events: VentEvent[];
  ctxAt: (t: number) => LabelContext;
  /** Latest time for which data is complete; efforts whose window runs past it stay unjudged. */
  tEnd: number;
  hasDrive: boolean;
}

export interface BreathLabel {
  breathIndex: number;
  tStart: number;
  tEnd: number | null;
  triggerCause: TriggerCause;
  cycleCause: CycleCause;
  patterns: PatternId[];
  evidence: Record<string, number>;
  neuralIndex: number | null;
  triggerDelay: number | null;
  cycleDelay: number | null;
}

export interface EffortLabel {
  neuralIndex: number;
  tOnset: number;
  ti: number;
  /** Breath triggered by this effort, or null. */
  breathIndex: number | null;
  ineffective: boolean;
  /** Ventilator phase at the effort onset. */
  phase: 'exp' | 'insp';
  reverseTriggered: boolean;
  /** A time-triggered breath started inside the effort (D-012): assisted, though not by triggering. */
  assistedByMachine: boolean;
}

export interface LabelOutput {
  breaths: BreathLabel[];
  efforts: EffortLabel[];
}

export interface AsynchronyIndex {
  ai: number; // %
  events: number;
  cycles: number;
  ie: number;
  cluster: boolean;
  severe: boolean;
}

interface TriggerEvt {
  t: number;
  cause: TriggerCause;
  breathIndex: number;
}

export function labelBreaths(inp: LabelInput): LabelOutput {
  const lead = k('LABEL_EFFORT_LEAD');
  const tail = k('LABEL_EFFORT_TAIL');
  const breaths = inp.breaths;
  // Trigger events in order, each attached to the breath it started (the breath start follows the
  // trigger by the actuator latency).
  const triggers: TriggerEvt[] = [];
  let bi = 0;
  for (const e of inp.events) {
    if (e.type !== 'trigger') continue;
    while (bi < breaths.length && (breaths[bi]?.tStart ?? Infinity) < e.t - 1e-9) bi += 1;
    triggers.push({ t: e.t, cause: e.cause, breathIndex: bi < breaths.length ? bi : -1 });
  }
  const neural = inp.neural;
  const effortWindow = (j: number): [number, number] => {
    const e = neural[j];
    if (!e) return [0, 0];
    const next = neural[j + 1]?.tOnset ?? Infinity;
    return [e.tOnset - lead, Math.min(e.tOnset + e.ti + tail, next - lead)];
  };
  const effortOf = new Map<number, number>(); // breathIndex → neural index (trigger caused by effort)
  const triggersOf = new Map<number, TriggerEvt[]>(); // neural index → triggers inside its window
  for (let j = 0; j < neural.length; j++) {
    const [a, b] = effortWindow(j);
    const inside = triggers.filter((tr) => tr.t >= a && tr.t <= b && tr.breathIndex >= 0);
    triggersOf.set(j, inside);
    for (const tr of inside) if (tr.cause === 'patient' && !effortOf.has(tr.breathIndex)) effortOf.set(tr.breathIndex, j);
  }

  // Reverse triggers: a machine breath followed by an effort onset within RT_MAX_DELAY, phase-locked.
  const rtOf = new Map<number, number>(); // breathIndex → neural index
  const rtDelays: number[] = [];
  const rtMax = k('LABEL_RT_MAX_DELAY');
  const tol = k('LABEL_RT_PHASE_TOL');
  let nj = 0;
  for (let i = 0; i < breaths.length; i++) {
    const b = breaths[i];
    if (!b || b.triggerCause === 'patient') continue;
    while (nj < neural.length && (neural[nj]?.tOnset ?? Infinity) <= b.tStart) nj += 1;
    const e = neural[nj];
    if (!e) continue;
    const delay = e.tOnset - b.tStart;
    const nextStart = breaths[i + 1]?.tStart ?? Infinity;
    if (delay <= 0 || delay > rtMax || e.tOnset >= nextStart) continue;
    if (effortOf.has(i)) continue;
    const med = median(rtDelays.slice(-4));
    const locked = e.entrained || (rtDelays.length >= 2 && Math.abs(delay - med) <= tol * med + 0.05);
    rtDelays.push(delay);
    if (locked) rtOf.set(i, nj);
  }
  const rtEffort = new Set([...rtOf.values()]);

  // Assisted by a coincident machine breath (D-012): a time-triggered breath that starts inside the
  // effort's inspiratory window [onset − lead, onset + Ti] delivers gas during the effort, so the effort
  // is neither wasted nor a reverse trigger (an entrained effort starts after the machine breath).
  const assistedOf = new Map<number, number>(); // breathIndex → neural index
  {
    let bi2 = 0;
    for (let j = 0; j < neural.length; j++) {
      const e = neural[j];
      if (!e || rtEffort.has(j)) continue;
      const hasPatientTrigger = (triggersOf.get(j) ?? []).some((tr) => tr.cause === 'patient' && effortOf.get(tr.breathIndex) === j);
      if (hasPatientTrigger) continue;
      while (bi2 < breaths.length && (breaths[bi2]?.tStart ?? Infinity) < e.tOnset - lead) bi2 += 1;
      const b = breaths[bi2];
      if (b && b.triggerCause !== 'patient' && b.tStart <= e.tOnset + e.ti && !assistedOf.has(bi2) && !rtOf.has(bi2)) assistedOf.set(bi2, j);
    }
  }
  const assistedEffort = new Set([...assistedOf.values()]);

  // Effort labels.
  const efforts: EffortLabel[] = [];
  const machineInspAt = (t: number): boolean => {
    const b = breaths.find((x) => x.tStart <= t && (x.tEnd ?? Infinity) > t);
    return !!b && t < (Number.isNaN(b.tPauseEnd) ? b.tInspEnd : b.tPauseEnd);
  };
  for (let j = 0; j < neural.length; j++) {
    const e = neural[j];
    if (!e) continue;
    const [, wEnd] = effortWindow(j);
    if (wEnd > inp.tEnd) break; // not yet judgeable
    const trig = (triggersOf.get(j) ?? []).find((tr) => tr.cause === 'patient' && effortOf.get(tr.breathIndex) === j);
    const rt = rtEffort.has(j);
    const assisted = assistedEffort.has(j);
    const assistedBreath = assisted ? [...assistedOf.entries()].find(([, nj2]) => nj2 === j)?.[0] ?? null : null;
    efforts.push({
      neuralIndex: j,
      tOnset: e.tOnset,
      ti: e.ti,
      breathIndex: trig ? trig.breathIndex : assistedBreath,
      ineffective: !trig && !rt && !assisted,
      phase: machineInspAt(e.tOnset) ? 'insp' : 'exp',
      reverseTriggered: rt,
      assistedByMachine: assisted,
    });
  }

  // Breath labels.
  const out: BreathLabel[] = [];
  const lastEffortForBreath = new Map<number, number>(); // neural index → last breath index using it
  for (let i = 0; i < breaths.length; i++) {
    const b = breaths[i];
    if (!b || b.tEnd === null) continue;
    const ctx = inp.ctxAt(b.tStart);
    const patterns: PatternId[] = [];
    const ev: Record<string, number> = {};
    const iS = inp.indexAt(b.tStart);
    const tInspEnd = Number.isNaN(b.tPauseEnd) ? b.tInspEnd : b.tPauseEnd;
    const iI = inp.indexAt(tInspEnd);
    const iE = inp.indexAt(b.tEnd);
    const trig = triggers.find((tr) => tr.breathIndex === i);
    const ej = effortOf.get(i);
    const rtj = rtOf.get(i);
    const aj = assistedOf.get(i);
    let triggerDelay: number | null = null;
    let cycleDelay: number | null = null;
    const e = ej !== undefined ? neural[ej] : aj !== undefined ? neural[aj] : undefined;

    if (b.triggerCause === 'patient') {
      if (e && trig) {
        triggerDelay = trig.t - e.tOnset;
        ev.triggerDelay = triggerDelay;
        if (triggerDelay > k('LABEL_TRIGGER_DELAY')) patterns.push('delayed-trigger');
        // Double trigger: another breath already used this effort.
        const prev = lastEffortForBreath.get(ej as number);
        if (prev !== undefined && prev < i) {
          const pb = breaths[prev];
          patterns.push('double-trigger');
          ev.stackedVt = (pb ? Math.max(0, pb.vtiTrue - pb.vteTrue) : 0) + b.vtiTrue;
          ev.firstBreath = prev;
        }
        lastEffortForBreath.set(ej as number, i);
      } else if (trig) {
        // Stacked after a reverse trigger: the entrained effort re-triggers.
        const rtPrev = [...rtOf.entries()].find(([bi2, nj2]) => bi2 === i - 1 && neural[nj2] && trig.t <= (neural[nj2]?.tOnset ?? 0) + (neural[nj2]?.ti ?? 0) + tail);
        if (rtPrev) {
          const pb = breaths[i - 1];
          patterns.push('double-trigger');
          ev.stackedVt = (pb ? Math.max(0, pb.vtiTrue - pb.vteTrue) : 0) + b.vtiTrue;
          ev.firstBreath = i - 1;
          ev.afterReverseTrigger = 1;
        } else {
          patterns.push('auto-trigger');
        }
      }
    } else if (rtj !== undefined) {
      const re = neural[rtj];
      if (re) {
        patterns.push('reverse-trigger');
        ev.reverseDelay = re.tOnset - b.tStart;
        lastEffortForBreath.set(rtj, i);
      }
    } else if (aj !== undefined && e) {
      // Machine breath that met an effort already under way (D-012): late relative to the effort onset.
      triggerDelay = b.tStart - e.tOnset;
      ev.triggerDelay = triggerDelay;
      ev.assistedByMachine = 1;
      if (triggerDelay > k('LABEL_TRIGGER_DELAY')) patterns.push('delayed-trigger');
      lastEffortForBreath.set(aj, i);
    }

    // Cycling relative to the neural offset (matched effort only).
    if (e) {
      const neuralOff = e.tOnset + e.ti;
      cycleDelay = b.tInspEnd - neuralOff;
      ev.cycleDelay = cycleDelay;
      ev.neuralTi = e.ti;
      ev.ventTi = b.tInspEnd - b.tStart;
      if (!patterns.includes('double-trigger')) {
        if (cycleDelay < k('LABEL_EARLY_CYCLING')) patterns.push('premature-cycling');
        else if (cycleDelay > k('LABEL_LATE_CYCLING')) patterns.push('delayed-cycling');
      }
    }

    // Truth-channel findings over the breath.
    if (iS >= 0 && iE >= 0) {
      let ptp = 0;
      let pmusPeak = 0;
      let pmusMin = 0;
      let pawEarlyMax = -Infinity;
      let plMax = -Infinity;
      let pend = 0;
      const iEarly = inp.indexAt(b.tStart + k('LABEL_OVERSHOOT_WINDOW'));
      const pmusAtStart = Math.max(0, inp.read('truth.pmus', iS));
      for (let idx = iS; idx <= iE; idx++) {
        const pm = inp.read('truth.pmus', idx);
        if (idx <= iI && pm > 0) ptp += pm / inp.fs;
        if (pm > pmusPeak) pmusPeak = pm;
        if (pm < pmusMin) pmusMin = pm;
        if (idx <= iEarly) pawEarlyMax = Math.max(pawEarlyMax, inp.read('paw', idx));
        plMax = Math.max(plMax, inp.read('truth.plND', idx), inp.read('truth.plD', idx));
        const qnd = inp.read('truth.qND', idx);
        const qd = inp.read('truth.qD', idx);
        if (qnd < 0 && qd > 0) pend += -qnd / inp.fs;
        else if (qd < 0 && qnd > 0) pend += -qd / inp.fs;
      }
      ev.pmusPeak = pmusPeak;
      ev.ptpInsp = ptp;
      // Flow starvation: effort active during a VC insufflation (PTP), strong enough to shape the ramp, and
      // still rising after the breath began (a breath that arrives while Pmus already relaxes is a delayed
      // trigger, not starved demand; D-012).
      let pmusPeakInsp = 0;
      for (let idx = iS; idx <= iI; idx++) pmusPeakInsp = Math.max(pmusPeakInsp, inp.read('truth.pmus', idx));
      ev.pmusRiseInsp = pmusPeakInsp - pmusAtStart;
      if (ctx.mode === 'VC-AC' && (e || rtj !== undefined) && ptp >= k('LABEL_FLOW_STARVATION_PTP') && pmusPeak >= k('LABEL_FLOW_STARVATION_PMUS') && pmusPeakInsp - pmusAtStart >= k('LABEL_FLOW_STARVATION_RISE')) {
        patterns.push('flow-starvation');
      }
      if (ctx.mode !== 'VC-AC' && pawEarlyMax > ctx.pTarget + k('LABEL_OVERSHOOT_MARGIN')) {
        patterns.push('overshoot');
        ev.overshoot = pawEarlyMax - ctx.pTarget;
      }
      // End-expiratory alveolar pressure over the 30 ms before the next breath, with the effort removed:
      // Ppl = Pcw,rec − α·Pmus + …, so the relaxed alveolar pressure is Palv + Pmus_eff (α ≈ 1 on average).
      const tailN = Math.max(1, Math.round(0.03 * inp.fs));
      let palvEE = 0;
      for (let idx = iE - tailN + 1; idx <= iE; idx++) palvEE += inp.read('truth.palv', Math.max(0, idx)) + Math.max(0, inp.read('truth.pmus', Math.max(0, idx)));
      palvEE /= tailN;
      ev.palvEE = palvEE;
      if (palvEE > ctx.peep + k('LABEL_AUTO_PEEP')) patterns.push('auto-peep');
      if (pmusMin < -k('LABEL_COUGH_PMUS')) {
        patterns.push('cough');
        ev.coughPmus = pmusMin;
      }
      ev.plEI = plMax;
      if (plMax > k('PL_EI_WARN')) patterns.push('overdistension');
      if (pend >= k('LABEL_PENDELLUFT_VOL')) {
        patterns.push('pendelluft');
        ev.pendelluftVol = pend;
      }
      if (inp.hasDrive && (e || rtj !== undefined)) {
        if (pmusPeak > k('PMUS_HIGH')) patterns.push('high-effort');
        else if (pmusPeak < k('PMUS_LOW')) patterns.push('low-effort');
      }
    }
    // Leak and injector-derived findings.
    if (b.vtiTrue > 0.05) {
      ev.leakFraction = b.leakTrue / (b.vtiTrue + b.leakTrue);
      if (b.leakTrue / b.vtiTrue > k('LABEL_LEAK_FRACTION')) patterns.push('leak');
    }
    // Tidal recruitment (truth only, Spec §7): units that opened during the breath and closed again.
    if (b.tidalRecruitUnits >= k('LABEL_TIDAL_RECRUIT_UNITS')) {
      patterns.push('tidal-recruitment');
      ev.tidalRecruitUnits = b.tidalRecruitUnits;
    }
    if (ctx.injectors.includes('secretions')) patterns.push('secretions');
    if (ctx.injectors.includes('water')) patterns.push('water');
    if (ctx.rTotal >= k('LABEL_HIGH_R')) {
      patterns.push('high-resistance');
      ev.rTotal = ctx.rTotal;
    }
    if (ctx.eScale >= k('LABEL_E_SCALE') || ctx.crs < k('LABEL_LOW_C')) {
      patterns.push('low-compliance');
      ev.crs = ctx.crs;
    }
    out.push({
      breathIndex: i,
      tStart: b.tStart,
      tEnd: b.tEnd,
      triggerCause: b.triggerCause,
      cycleCause: b.cycleCause,
      patterns,
      evidence: ev,
      neuralIndex: ej ?? rtj ?? aj ?? null,
      triggerDelay,
      cycleDelay,
    });
  }
  return { breaths: out, efforts };
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? NaN) : 0.5 * ((s[m - 1] ?? 0) + (s[m] ?? 0));
}

/** Asynchrony index over [t0, t1] (Brief 1 §3): events / (cycles + ineffective efforts) × 100. */
export function asynchronyIndex(out: LabelOutput, t0: number, t1: number): AsynchronyIndex {
  const bs = out.breaths.filter((b) => b.tStart >= t0 && b.tStart <= t1);
  const ie = out.efforts.filter((e) => e.ineffective && e.tOnset >= t0 && e.tOnset <= t1);
  const events = bs.filter((b) => b.patterns.some((p) => AI_EVENT_PATTERNS.includes(p))).length + ie.length;
  const denom = bs.length + ie.length;
  const ai = denom > 0 ? (100 * events) / denom : 0;
  // Cluster flag: > IE_CLUSTER_COUNT ineffective efforts in any IE_CLUSTER_WINDOW.
  const win = k('IE_CLUSTER_WINDOW');
  let cluster = false;
  const times = ie.map((e) => e.tOnset);
  for (let i = 0; i < times.length; i++) {
    let j = i;
    while (j < times.length && (times[j] ?? 0) - (times[i] ?? 0) <= win) j += 1;
    if (j - i > k('IE_CLUSTER_COUNT')) {
      cluster = true;
      break;
    }
  }
  return { ai, events, cycles: bs.length, ie: ie.length, cluster, severe: ai > k('AI_SEVERE') };
}

export interface MechanicsSummary {
  /** Preset total inspiratory resistance incl. tube at the reference flow, cmH2O/(L/s). */
  rTotal: number;
  el: number;
  ecw: number;
}

function ctxFromLogs(settingsLog: Array<{ t: number; settings: VentSettings }>, injectorLog: InjectorLogEntry[], mech: MechanicsSummary): (t: number) => LabelContext {
  return (t) => {
    let s = settingsLog[0]?.settings;
    for (const e of settingsLog) if (e.t <= t + 1e-9) s = e.settings;
    let inj = injectorLog[0];
    for (const e of injectorLog) if (e.t <= t + 1e-9) inj = e;
    if (!s) throw new Error('no settings');
    return contextFromSettings(s, inj, mech);
  };
}

export function contextFromSettings(s: VentSettings, inj: InjectorLogEntry | undefined, mech: MechanicsSummary): LabelContext {
  const above = s.mode === 'PC-AC' ? s.pinsp : s.mode === 'PSV' ? s.ps : 0;
  const rScale = inj?.rScale ?? 1;
  const eScale = inj?.eScale ?? 1;
  return {
    mode: s.mode,
    peep: s.peep,
    pTarget: s.peep + above,
    injectors: inj?.kinds ?? [],
    rScale,
    eScale,
    rTotal: mech.rTotal * rScale,
    crs: 1000 / (mech.el * eScale + mech.ecw),
  };
}

/** Total inspiratory resistance of a mechanics set at the reference flow (tube Rohrer + central + peripheral). */
export function totalResistance(m: { rInsp: number; rCentral: number; ett: { k1: number; k2: number } | null }): number {
  const q = k('R_REFERENCE_FLOW');
  return m.rInsp + m.rCentral + (m.ett ? m.ett.k1 + m.ett.k2 * q : 0);
}

/** Reader over a headless result: keys match the worker batch layout. */
export function headlessReader(res: HeadlessResult): { n: number; read: LabelInput['read']; indexAt: LabelInput['indexAt'] } {
  const cols = new Map<ChannelKey, Float32Array>([
    ['t', res.t],
    ['paw', res.paw],
    ['flow', res.flow],
    ['vol', res.vol],
    ['pes', res.pes],
  ]);
  for (const c of TRUTH_CHANNELS) cols.set(`truth.${c}`, res.truth[c]);
  const t0 = res.t[0] ?? 0;
  return {
    n: res.t.length,
    read: (ch, i) => cols.get(ch)?.[i] ?? NaN,
    indexAt: (t) => {
      const i = Math.round((t - t0) * res.fs);
      return i < 0 || i >= res.t.length ? -1 : i;
    },
  };
}

/** Label a complete headless run. */
export function labelRun(res: HeadlessResult): LabelOutput {
  const r = headlessReader(res);
  return labelBreaths({
    fs: res.fs,
    n: r.n,
    read: r.read,
    indexAt: r.indexAt,
    breaths: res.breaths,
    neural: res.neuralBreaths,
    events: res.events,
    ctxAt: ctxFromLogs(res.settingsLog, res.injectorLog, res.mechanics),
    tEnd: res.t[res.t.length - 1] ?? 0,
    hasDrive: res.hasDrive,
  });
}
