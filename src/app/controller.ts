/**
 * SessionController: main-thread owner of the worker client, the StreamStore, the Monitor (measured
 * only) and the truth-derived dashboard values. UI components subscribe for coarse updates; the canvases
 * read the store directly every animation frame.
 */
import { Monitor, type BreathMetrics } from '../monitor/monitor';
import { truthBreathMetrics, type TruthBreathMetrics } from '../sim/truth/lung-stress';
import type { BreathRecord, ManeuverKind, ManeuverResult, VentEvent } from '../sim/types';
import type { VentSettings } from '../sim/vent/settings';
import type { BalloonParams } from '../sim/patient/balloon';
import { defaultBalloon } from '../sim/patient/balloon';
import { resolveScenario, scenarioById, type ScenarioDef, type ScenarioFix } from '../edu/scenarios';
import type { PatientSummary, SessionStatus, WorkerToMain } from '../worker/protocol';
import { StreamStore } from './StreamStore';
import { WorkerClient } from './WorkerClient';
import { asynchronyIndex, contextFromSettings, labelBreaths, type AsynchronyIndex, type BreathLabel, type EffortLabel } from '../sim/truth/labeler';
import { detect, type DetectedBreath, type IeEvent } from '../detector/detector';
import { deviceContext, measuredBreath, type MeasuredBreath, type MeasuredKey } from '../detector/features';
import { INJECTOR_KINDS, type InjectorKind, type InjectorLogEntry, type InjectorParamMap } from '../sim/injectors';

/** Per-breath labels from the truth layer and the signal-only detector, keyed by the ventilator's breath index. */
export interface BreathLabels {
  truth: BreathLabel | null;
  det: DetectedBreath | null;
}

/** Simulated seconds of breaths the main-thread analysis re-labels on each closed breath (≈ 25 breaths). */
export const ANALYSIS_WINDOW_SECONDS = 90;
/** AI window (Brief 1 §3 uses minutes; the store keeps 120 s). */
export const AI_WINDOW_SECONDS = 120;

export const SCROLLBACK_SECONDS = 120;

export interface ManeuverReadouts {
  p01: ManeuverResult | null;
  pocc: ManeuverResult | null;
  occlusionTest: ManeuverResult | null;
  inspHold: ManeuverResult | null;
  expHold: ManeuverResult | null;
  ri: ManeuverResult | null;
  peepTrial: ManeuverResult | null;
}

const NO_MANEUVERS: ManeuverReadouts = { p01: null, pocc: null, occlusionTest: null, inspHold: null, expHold: null, ri: null, peepTrial: null };

/** Recruitment truth readouts of the last closed breath (recruitable lung only; zeros otherwise). */
export interface RecruitReadout {
  /** Aerated FRC of the recruited units above the phenotype's zero-PEEP FRC, L. */
  recruitedVolume: number;
  tidalRecruitUnits: number;
  openFraction: number;
}

export interface ViewState {
  truth: boolean;
  frozen: boolean;
  /** Time shown at the sweep cursor when frozen; NaN = live. */
  tView: number;
  sweep: number; // s
  speed: number;
  paused: boolean;
}

export type ControllerListener = () => void;

export class SessionController {
  readonly worker = new WorkerClient();
  store = new StreamStore({ fs: 100, seconds: SCROLLBACK_SECONDS });
  monitor = new Monitor({ fs: 100, pbw: 70 });
  scenario: ScenarioDef | null = null;
  patient: PatientSummary | null = null;
  status: SessionStatus | null = null;
  balloon: BalloonParams = defaultBalloon();
  latestBreath: BreathMetrics | null = null;
  latestTruth: TruthBreathMetrics | null = null;
  latestRecruit: RecruitReadout | null = null;
  maneuvers: ManeuverReadouts = { ...NO_MANEUVERS };
  alarmLog: Array<Extract<VentEvent, { type: 'alarm' }>> = [];
  view: ViewState = { truth: false, frozen: false, tView: NaN, sweep: 12, speed: 1, paused: false };
  ready = false;
  /** Increments on every tick (canvases use it to detect new data). */
  tickCount = 0;
  /** Labels for every closed breath in the analysis window (truth + detector), by breath index. */
  labels = new Map<number, BreathLabels>();
  ieEvents: IeEvent[] = [];
  efforts: EffortLabel[] = [];
  ai: AsynchronyIndex | null = null;
  /** Wall-clock cost of the last analysis pass, ms (perf tests). */
  analysisMs = 0;
  analysisCount = 0;
  /** Settings and injector timelines as seen in status messages (context for labeler and detector). */
  private settingsLog: Array<{ t: number; settings: VentSettings }> = [];
  private injectorLog: InjectorLogEntry[] = [];
  private analysisScheduled = false;
  private listeners = new Set<ControllerListener>();
  private notifyScheduled = false;

  constructor() {
    this.worker.subscribe((m) => this.onMessage(m));
  }

  subscribe(l: ControllerListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private notify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const l of this.listeners) l();
    });
  }

  loadScenario(id: string): void {
    const def = scenarioById(id);
    const spec = resolveScenario(def);
    this.scenario = def;
    this.ready = false;
    this.balloon = spec.patient.balloon ?? defaultBalloon();
    this.latestBreath = null;
    this.latestTruth = null;
    this.latestRecruit = null;
    this.maneuvers = { ...NO_MANEUVERS };
    this.alarmLog = [];
    this.labels = new Map();
    this.ieEvents = [];
    this.efforts = [];
    this.ai = null;
    this.settingsLog = [];
    this.injectorLog = [];
    this.view = { ...this.view, frozen: false, tView: NaN, paused: false };
    this.worker.init(spec);
    this.notify();
  }

  private recordStatus(s: SessionStatus): void {
    const last = this.settingsLog[this.settingsLog.length - 1];
    if (!last || last.settings !== s.settings) {
      // Settings objects are re-sent on every status; only keep a new entry when a value changed.
      if (!last || JSON.stringify(last.settings) !== JSON.stringify(s.settings)) this.settingsLog.push({ t: s.t, settings: s.settings });
    }
    const li = this.injectorLog[this.injectorLog.length - 1];
    if (!li || li.kinds.join() !== s.injectors.join() || li.rScale !== s.rScale || li.eScale !== s.eScale) {
      this.injectorLog.push({ t: s.t, kinds: s.injectors.slice(), rScale: s.rScale, eScale: s.eScale });
    }
    if (this.settingsLog.length > 64) this.settingsLog.shift();
    if (this.injectorLog.length > 64) this.injectorLog.shift();
  }

  private settingsAt(t: number): VentSettings | null {
    let s: VentSettings | null = this.settingsLog[0]?.settings ?? null;
    for (const e of this.settingsLog) if (e.t <= t + 1e-9) s = e.settings;
    return s;
  }

  private injectorAt(t: number): InjectorLogEntry | undefined {
    let e: InjectorLogEntry | undefined = this.injectorLog[0];
    for (const x of this.injectorLog) if (x.t <= t + 1e-9) e = x;
    return e;
  }

  /** Schedule one truth + detector pass over the store, off the animation frame. */
  private scheduleAnalysis(): void {
    if (this.analysisScheduled) return;
    this.analysisScheduled = true;
    setTimeout(() => {
      this.analysisScheduled = false;
      this.runAnalysis();
    }, 0);
  }

  /** Label every closed breath in the analysis window: truth labels and signal-only detector labels. */
  runAnalysis(): void {
    const store = this.store;
    const patient = this.patient;
    if (!patient || store.length === 0 || this.settingsLog.length === 0) return;
    const t0 = performance.now();
    const tLatest = store.tLatest;
    const tFrom = tLatest - ANALYSIS_WINDOW_SECONDS;
    const breaths = store.breaths.filter((b) => b.tEnd !== null && b.tStart >= tFrom);
    if (breaths.length === 0) return;
    const mech = { rTotal: patient.rTotal, el: patient.el, ecw: patient.ecw };
    const fallback = this.settingsLog[this.settingsLog.length - 1]?.settings;
    if (!fallback) return;
    const settingsAt = (t: number): VentSettings => this.settingsAt(t) ?? fallback;
    const truth = labelBreaths({
      fs: store.fs,
      n: store.length,
      read: (ch, i) => store.read(ch, i),
      indexAt: (t) => store.indexAt(t),
      breaths,
      neural: store.neural,
      events: store.events,
      ctxAt: (t) => contextFromSettings(settingsAt(t), this.injectorAt(t), mech),
      tEnd: tLatest,
      hasDrive: patient.hasDrive,
    });
    const measured = breaths.map(measuredBreath).filter((b): b is MeasuredBreath => b !== null);
    const det = detect({
      reader: { n: store.length, fs: store.fs, read: (ch: MeasuredKey, i: number) => store.read(ch, i), indexAt: (t) => store.indexAt(t) },
      breaths: measured,
      events: store.events,
      ctxAt: (t) => deviceContext(settingsAt(t)),
    });
    const labels = new Map<number, BreathLabels>();
    // The labeler indexes breaths by array position; map back to the ventilator's breath index.
    for (const tl of truth.breaths) {
      const b = breaths[tl.breathIndex];
      if (b) labels.set(b.index, { truth: { ...tl, breathIndex: b.index }, det: null });
    }
    for (const d of det.breaths) {
      const cur = labels.get(d.breathIndex);
      if (cur) cur.det = d;
      else labels.set(d.breathIndex, { truth: null, det: d });
    }
    this.labels = labels;
    this.ieEvents = det.ieEvents;
    this.efforts = truth.efforts;
    this.ai = asynchronyIndex(truth, Math.max(tFrom, tLatest - AI_WINDOW_SECONDS), tLatest);
    this.analysisMs = performance.now() - t0;
    this.analysisCount += 1;
    this.notify();
  }

  private onMessage(m: WorkerToMain): void {
    switch (m.type) {
      case 'ready': {
        this.store = new StreamStore({ fs: m.fs, seconds: SCROLLBACK_SECONDS });
        this.monitor = new Monitor({ fs: m.fs, pbw: m.patient.pbw });
        this.patient = m.patient;
        this.status = m.status;
        this.recordStatus(m.status);
        this.ready = true;
        this.worker.setSpeed(this.view.speed);
        this.notify();
        break;
      }
      case 'tick':
        this.onTick(m);
        break;
      case 'status':
        this.status = m.status;
        this.recordStatus(m.status);
        this.view.speed = m.speed;
        this.view.paused = m.paused;
        this.notify();
        break;
    }
  }

  private onTick(m: Extract<WorkerToMain, { type: 'tick' }>): void {
    const store = this.store;
    const n = m.n;
    store.append(m.samples, n);
    // Feed the monitor in time order: the engine emits each sample, then the events at that time.
    const tOff = 0;
    const events = m.events;
    let ei = 0;
    for (let i = 0; i < n; i++) {
      const t = m.samples[tOff + i] ?? 0;
      this.monitor.onSample({ t, paw: m.samples[n + i] ?? 0, flow: m.samples[2 * n + i] ?? 0, vol: m.samples[3 * n + i] ?? 0, pes: m.samples[4 * n + i] ?? 0 });
      while (ei < events.length && (events[ei]?.t ?? Infinity) <= t + 1e-6) {
        const e = events[ei];
        if (e) this.handleEvent(e);
        ei += 1;
      }
    }
    for (; ei < events.length; ei++) {
      const e = events[ei];
      if (e) this.handleEvent(e);
    }
    store.addEvents(events);
    store.addBreaths(m.breaths, m.neural);
    for (const b of m.breaths) this.onBreathClosed(b);
    if (m.breaths.some((b) => b.tEnd !== null)) this.scheduleAnalysis();
    if (this.monitor.latest !== this.latestBreath) this.latestBreath = this.monitor.latest;
    this.tickCount += 1;
    if (m.breaths.length || events.length) this.notify();
  }

  private handleEvent(e: VentEvent): void {
    this.monitor.onEvent(e);
    if (e.type === 'alarm') {
      this.alarmLog.push(e);
      if (this.alarmLog.length > 50) this.alarmLog.shift();
    } else if (e.type === 'maneuver') {
      const r = e.result;
      switch (r.kind) {
        case 'p01':
          this.maneuvers.p01 = r;
          break;
        case 'pocc':
          this.maneuvers.pocc = r;
          break;
        case 'occlusion-test':
          this.maneuvers.occlusionTest = r;
          break;
        case 'insp':
          this.maneuvers.inspHold = r;
          break;
        case 'exp':
          this.maneuvers.expHold = r;
          break;
        case 'ri':
          this.maneuvers.ri = r;
          break;
        case 'peep-trial':
          this.maneuvers.peepTrial = r;
          break;
      }
    }
  }

  private onBreathClosed(b: BreathRecord): void {
    if (b.tEnd === null || !this.patient) return;
    const s = this.store;
    const iStart = s.indexAt(b.tStart);
    const iEnd = s.indexAt(b.tEnd);
    if (iStart < 0 || iEnd < 0) return;
    const iInspEnd = Math.max(iStart, s.indexAt(Number.isNaN(b.tPauseEnd) ? b.tInspEnd : b.tPauseEnd));
    const period = b.tEnd - b.tStart;
    const rr = this.monitor.rrTotal > 0 ? this.monitor.rrTotal : period > 0 ? 60 / period : 0;
    this.latestTruth = truthBreathMetrics(
      { n: s.length, get: (ch, i) => s.read(ch, i) },
      { iStart, iInspEnd, iEnd, frc: this.patient.frc, rr },
    );
    this.latestRecruit = { recruitedVolume: b.frcAeratedEE - this.patient.frc, tidalRecruitUnits: b.tidalRecruitUnits, openFraction: b.openFractionEE };
  }

  // ─────────── commands ───────────

  applySettings(partial: Partial<VentSettings>): void {
    this.worker.applySettings(partial);
  }

  setBalloon(b: BalloonParams): void {
    this.balloon = b;
    this.worker.setBalloon(b);
    this.notify();
  }

  /** Toggle an injector live (default parameters when enabling). */
  setInjector<K extends InjectorKind>(kind: K, params: Partial<InjectorParamMap[K]> | null): void {
    this.worker.inject(kind, params);
  }

  /** Apply a scenario's scripted fix: settings, drive and injector changes, as the emergence test does. */
  applyFix(fix: ScenarioFix): void {
    if (fix.settings) this.worker.applySettings(fix.settings);
    if (fix.drive) this.worker.setPatient(fix.drive);
    if (fix.injectors) {
      for (const kind of INJECTOR_KINDS) {
        if (kind in fix.injectors) this.worker.inject(kind, fix.injectors[kind] ?? null);
      }
    }
    this.notify();
  }

  maneuver(kind: ManeuverKind): void {
    this.worker.maneuver(kind);
  }

  /** Time warp on the CO2 loop (×1–×60). */
  setWarp(warp: number): void {
    this.worker.setWarp(warp);
  }

  setSpeed(speed: number): void {
    this.view.speed = speed;
    this.worker.setSpeed(speed);
    this.notify();
  }

  togglePause(): void {
    if (this.view.paused) this.worker.resume();
    else this.worker.pause();
    this.view.paused = !this.view.paused;
    this.notify();
  }

  setTruth(on: boolean): void {
    this.view.truth = on;
    this.notify();
  }

  setSweep(s: number): void {
    this.view.sweep = s;
    this.notify();
  }

  freeze(on: boolean): void {
    this.view.frozen = on;
    this.view.tView = on ? this.store.tLatest : NaN;
    this.notify();
  }

  /** Scroll the frozen view to a time (clamped to the retained window). */
  scrollTo(t: number): void {
    if (!this.view.frozen) this.freeze(true);
    const lo = Math.min(this.store.tLatest, this.store.tOldest + this.view.sweep);
    this.view.tView = Math.max(lo, Math.min(this.store.tLatest, t));
    this.notify();
  }

  /** Time at the sweep cursor (live or frozen). */
  get tView(): number {
    return this.view.frozen && !Number.isNaN(this.view.tView) ? this.view.tView : this.store.tLatest;
  }

  get settings(): VentSettings | null {
    return this.status?.settings ?? null;
  }
}
