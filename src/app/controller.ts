/**
 * SessionController: main-thread owner of the worker client, the StreamStore, the Monitor (measured
 * only) and the truth-derived dashboard values. UI components subscribe for coarse updates; the canvases
 * read the store directly every animation frame.
 */
import { Monitor, type BreathMetrics } from '../monitor/monitor';
import { truthBreathMetrics, type TruthBreathMetrics } from '../sim/truth/lung-stress';
import { spo2Schematic, type Spo2Inputs, type Spo2Readout } from '../monitor/spo2';
import type { BreathRecord, ManeuverKind, ManeuverResult, VentEvent } from '../sim/types';
import type { VentSettings } from '../sim/vent/settings';
import type { BalloonParams } from '../sim/patient/balloon';
import { defaultBalloon } from '../sim/patient/balloon';
import { SCENARIOS, resolveScenario, type ScenarioDef, type ScenarioFix } from '../edu/scenarios';
import type { PatientSummary, SessionStatus, WorkerToMain } from '../worker/protocol';
import { StreamStore } from './StreamStore';
import { WorkerClient } from './WorkerClient';
import { asynchronyIndex, contextFromSettings, labelBreaths, type AsynchronyIndex, type BreathLabel, type EffortLabel } from '../sim/truth/labeler';
import { detect, type DetectedBreath, type IeEvent } from '../detector/detector';
import { deviceContext, measuredBreath, type MeasuredBreath, type MeasuredKey } from '../detector/features';
import { INJECTOR_KINDS, type InjectorKind, type InjectorLogEntry, type InjectorParamMap } from '../sim/injectors';
import type { Co2Sample, GasParams } from '../sim/patient/gas-exchange';
import type { DriveParams } from '../sim/patient/neural-drive';
import type { PatternId } from '../sim/truth/labeler';
import { QuizSession } from '../edu/quiz-session';
import { ProgressStore } from '../edu/progress';
import { CustomScenarioStore } from '../edu/custom-scenarios';
import { SEVERE_ALARMS, extrasFromTruth, truthPatternsInWindow, type FixGrade, type FixInput } from '../edu/quiz';
import { effortEvidence, explainBreath, type BreathExplanation } from '../edu/cards';
import type { QuizHideKey } from '../edu/quiz-view';
import { applyDriveSnapshot, buildDebrief, driveChangesFrom, driveSnapshot, injectorChange, settingChangesFrom, type Debrief, type DriveSnapshot, type SettingChange } from '../edu/debrief';
import { sessionCsv } from '../export/csv';
import { sessionJson, type SessionJson } from '../export/json';
import { downloadBytes, type DownloadOutcome } from '../export/download';
import { k } from '../config/constants';

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

export type DrawerTab = 'scenario' | 'explain' | 'quiz' | 'export';

export interface ViewState {
  truth: boolean;
  /** Pattern badges on the waveforms (hidden during the identification phase of a quiz). */
  badges: boolean;
  /** Instructor's hide set for the bedside view (design 2026-09-11, D-019); acts only while a quiz runs or the session is locked. */
  quizHide: Set<QuizHideKey>;
  /** Set by a quiz link; cleared on evaluate / end. Hides the instructor panel and disables the picker and truth toggle. */
  quizLocked: boolean;
  drawerTab: DrawerTab;
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
  /** Schematic SpO2 readout (Spec §4.6 stretch goal); null until the first breath closes. */
  latestSpo2: Spo2Readout | null = null;
  maneuvers: ManeuverReadouts = { ...NO_MANEUVERS };
  alarmLog: Array<Extract<VentEvent, { type: 'alarm' }>> = [];
  view: ViewState = { truth: false, badges: true, quizHide: new Set(), quizLocked: false, drawerTab: 'scenario', frozen: false, tView: NaN, sweep: 12, speed: 1, paused: false };
  ready = false;
  /** CO2 samples (≈ 1/s) since the scenario started, for the panel history and the export. */
  co2Log: Co2Sample[] = [];
  /** Every maneuver result since the scenario started (export). */
  maneuverLog: ManeuverResult[] = [];
  /** Per-breath monitor values since the scenario started (quiz fix window, export); capped. */
  monitorLog: BreathMetrics[] = [];
  /** Per-breath truth metrics with the breath start (quiz extras over the fix window); capped. */
  truthLog: Array<{ tStart: number; m: TruthBreathMetrics }> = [];
  /** Confirmed setting changes since the scenario started (quiz score). */
  settingChanges = 0;
  /** Confirmed setting and injector changes since the scenario started (debrief, D-019). */
  settingsChangeLog: SettingChange[] = [];
  /** The learner's identification picks (debrief). */
  quizPicks: PatternId[] = [];
  /** Debrief of the last evaluated quiz; null until evaluate. */
  lastDebrief: Debrief | null = null;
  private aiAtFixStart: number | null = null;
  private settingsAtFixStart: VentSettings | null = null;
  private injectorsAtFixStart: string[] = [];
  /** Patient drive as last commanded (scenario drive, instructor applies, scripted fixes); null when passive. */
  private drive: DriveSnapshot | null = null;
  private driveAtFixStart: DriveSnapshot | null = null;
  quiz = new QuizSession();
  progress = new ProgressStore();
  customScenarios = new CustomScenarioStore();
  /** Breath index whose explain card is open (badge click), or null for the latest labelled breath. */
  selectedBreath: number | null = null;
  private alarmsAtFixStart = 0;
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

  /** Re-render without a state change (custom-scenario list edits). */
  refresh(): void {
    this.notify();
  }

  /** Shipped library first, then the learner's saved scenarios. */
  findScenario(id: string): ScenarioDef | null {
    return SCENARIOS.find((s) => s.id === id) ?? this.customScenarios.get(id);
  }

  hasScenario(id: string): boolean {
    return this.findScenario(id) !== null;
  }

  loadScenario(id: string): void {
    const def = this.findScenario(id);
    if (!def) throw new Error(`unknown scenario ${id}`);
    const spec = resolveScenario(def);
    this.scenario = def;
    this.resetSessionState(spec);
    this.worker.init(spec);
    this.notify();
  }

  /** Load a scenario definition that is not in the library (instructor editor, imported JSON). */
  loadScenarioDef(def: ScenarioDef): void {
    const spec = resolveScenario(def);
    this.scenario = def;
    this.resetSessionState(spec);
    this.worker.init(spec);
    this.notify();
  }

  private resetSessionState(spec: ReturnType<typeof resolveScenario>): void {
    this.ready = false;
    this.balloon = spec.patient.balloon ?? defaultBalloon();
    this.latestBreath = null;
    this.latestTruth = null;
    this.latestRecruit = null;
    this.latestSpo2 = null;
    this.maneuvers = { ...NO_MANEUVERS };
    this.alarmLog = [];
    this.co2Log = [];
    this.maneuverLog = [];
    this.monitorLog = [];
    this.truthLog = [];
    this.settingChanges = 0;
    this.settingsChangeLog = [];
    this.drive = this.scenario?.drive ? driveSnapshot(this.scenario.drive) : null;
    this.driveAtFixStart = null;
    this.quizPicks = [];
    this.lastDebrief = null;
    this.selectedBreath = null;
    this.quiz.reset();
    this.labels = new Map();
    this.ieEvents = [];
    this.efforts = [];
    this.ai = null;
    this.settingsLog = [];
    this.injectorLog = [];
    this.view = { ...this.view, badges: true, frozen: false, tView: NaN, paused: false };
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
        if (this.patient && (this.patient.el !== m.status.mechanics.el || this.patient.ecw !== m.status.mechanics.ecw)) {
          this.patient = { ...this.patient, el: m.status.mechanics.el, ecw: m.status.mechanics.ecw };
        }
        this.recordStatus(m.status);
        this.view.speed = m.speed;
        this.view.paused = m.paused;
        if (m.status.co2) {
          const last = this.co2Log[this.co2Log.length - 1];
          if (!last || m.status.co2.t - last.t >= 1 - 1e-6) {
            this.co2Log.push(m.status.co2);
            if (this.co2Log.length > 7200) this.co2Log.shift();
          }
        }
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
    if (this.monitor.latest !== this.latestBreath) {
      this.latestBreath = this.monitor.latest;
      if (this.latestBreath) {
        this.monitorLog.push(this.latestBreath);
        if (this.monitorLog.length > 600) this.monitorLog.shift();
      }
    }
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
      this.maneuverLog.push(r);
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
      { iStart, iInspEnd, iEnd, frc: this.patient.frc, rr, fs: s.fs },
    );
    this.truthLog.push({ tStart: b.tStart, m: this.latestTruth });
    if (this.truthLog.length > 600) this.truthLog.shift();
    this.latestRecruit = { recruitedVolume: b.frcAeratedEE - this.patient.frc, tidalRecruitUnits: b.tidalRecruitUnits, openFraction: b.openFractionEE };
    // Schematic SpO2 (Spec §4.6 stretch goal): display only.
    let pawSum = 0;
    for (let i = iStart; i <= iEnd; i++) pawSum += s.read('paw', i);
    const spo2In: Spo2Inputs = {
      fio2: this.status?.settings.fio2 ?? 0.21,
      openFraction: b.openFractionEE,
      meanPaw: pawSum / Math.max(1, iEnd - iStart + 1),
      paCO2: this.co2Log.at(-1)?.paCO2 ?? k('CO2_SET_POINT'),
    };
    if (this.scenario?.shunt !== undefined) spo2In.shunt = this.scenario.shunt;
    this.latestSpo2 = spo2Schematic(spo2In);
  }

  // ─────────── commands ───────────

  applySettings(partial: Partial<VentSettings>): void {
    this.settingChanges += 1;
    if (this.status) this.settingsChangeLog.push(...settingChangesFrom(this.store.tLatest, this.status.settings, partial));
    this.worker.applySettings(partial);
  }

  /** Instructor: live drive, CO2-loop and mechanics changes. */
  setDrive(partial: Partial<DriveParams>): void {
    this.logDriveChange(partial);
    this.worker.setPatient(partial);
    this.notify();
  }

  /** Drive changes enter the confirmed-change log like settings (D-019 follow-up); passive scenarios have no drive to compare. */
  private logDriveChange(partial: Partial<DriveParams>): void {
    if (!this.drive) return;
    this.settingsChangeLog.push(...driveChangesFrom(this.store.tLatest, this.drive, partial));
    this.drive = applyDriveSnapshot(this.drive, partial);
  }

  setGas(partial: Partial<GasParams>): void {
    this.worker.setGas(partial);
  }

  setPatientScale(scale: { rScale?: number; eScale?: number }): void {
    this.worker.setPatientScale(scale);
  }

  /** Instructor: live EL / Ecw on the running patient (rebuilt at the current volume). */
  setMechanics(mechanics: { el?: number; ecw?: number }): void {
    this.worker.setMechanics(mechanics);
  }

  setDrawerTab(tab: DrawerTab): void {
    this.view.drawerTab = tab;
    this.notify();
  }

  // ─────────── bedside view (design 2026-09-11, D-019) ───────────

  /** True when `key` is hidden right now: the instructor set it and a quiz is running or the session is locked. */
  quizHides(key: QuizHideKey): boolean {
    if (!this.view.quizHide.has(key)) return false;
    const p = this.quiz.phase;
    return this.view.quizLocked || p === 'identify' || p === 'identified' || p === 'fix';
  }

  setQuizHide(keys: Iterable<QuizHideKey>): void {
    this.view.quizHide = new Set(keys);
    if (this.quizHides('explain') && this.view.drawerTab === 'explain') this.view.drawerTab = 'quiz';
    this.notify();
  }

  /** A quiz link: apply its hide set, lock the session and open the Quiz tab. */
  lockQuiz(hide: Iterable<QuizHideKey>): void {
    this.view.quizHide = new Set(hide);
    this.view.quizLocked = true;
    this.view.drawerTab = 'quiz';
    if (this.view.truth && this.quizHides('truth')) this.view.truth = false;
    this.notify();
  }

  // ─────────── explain cards ───────────

  /** Open the explain card for a breath (badge click). */
  selectBreath(index: number | null): void {
    if (this.quizHides('explain')) return;
    this.selectedBreath = index;
    this.view.drawerTab = 'explain';
    this.notify();
  }

  /** Most recent closed breath that carries a truth pattern, or null. */
  latestLabelledBreath(): number | null {
    let best: number | null = null;
    for (const [idx, l] of this.labels) if ((l.truth?.patterns.length ?? 0) > 0 && (best === null || idx > best)) best = idx;
    return best;
  }

  /** Cards with case-specific evidence for a breath (truth labels), plus the ineffective efforts inside it. */
  explanationFor(index: number): { index: number; tStart: number; cards: BreathExplanation[]; efforts: string[][] } | null {
    const l = this.labels.get(index)?.truth;
    const settings = this.settings;
    if (!l || !settings || !this.patient) return null;
    const neural = l.neuralIndex !== null ? (this.store.neural.find((n) => n.index === l.neuralIndex) ?? null) : null;
    const cards = explainBreath({ label: l, neural, settings, pbw: this.patient.pbw });
    const tEnd = l.tEnd ?? this.store.tLatest;
    const efforts = this.efforts.filter((e) => e.ineffective && e.tOnset >= l.tStart && e.tOnset < tEnd).map((e) => effortEvidence(e, settings));
    return { index, tStart: l.tStart, cards, efforts };
  }

  // ─────────── quiz ───────────

  startQuiz(): void {
    this.quiz.start(this.store.tLatest);
    this.view.badges = false;
    this.view.drawerTab = 'quiz';
    this.lastDebrief = null;
    this.notify();
  }

  /** Patterns present in the truth labels of the last QUIZ_FIX_WINDOW seconds (the identification key). */
  quizTruthPatterns(): PatternId[] {
    const t0 = this.store.tLatest - k('QUIZ_FIX_WINDOW');
    const breaths = [...this.labels.values()].map((l) => l.truth).filter((l): l is BreathLabel => l !== null && l.tStart >= t0);
    const efforts = this.efforts.filter((e) => e.tOnset >= t0);
    return truthPatternsInWindow(breaths, efforts);
  }

  submitQuizPicks(picks: PatternId[]): void {
    this.quizPicks = [...picks];
    this.quiz.submitIdentification(picks, this.quizTruthPatterns());
    // Badges return unless the truth layer is hidden for this quiz (then they wait for the debrief).
    this.view.badges = !this.quizHides('truth');
    this.notify();
  }

  startQuizFix(): void {
    this.quiz.startFix(this.store.tLatest, this.settingChanges);
    this.alarmsAtFixStart = this.alarmLog.length;
    this.aiAtFixStart = this.ai?.ai ?? null;
    this.settingsAtFixStart = this.status?.settings ?? null;
    this.injectorsAtFixStart = this.status?.injectors.slice() ?? [];
    this.driveAtFixStart = this.drive;
    this.notify();
  }

  /** Live fix-window measurements: AI over the window, per-breath limits, new severe alarms. */
  quizFixInput(): FixInput {
    const t0 = this.quiz.fixWindowStart;
    const t1 = this.store.tLatest;
    const breaths = [...this.labels.values()].map((l) => l.truth).filter((l): l is BreathLabel => l !== null && l.tStart >= t0);
    const efforts = this.efforts.filter((e) => e.tOnset >= t0);
    const ai = asynchronyIndex({ breaths, efforts }, t0, t1).ai;
    const mon = this.monitorLog.filter((m) => m.tStart >= t0).map((m) => ({ dp: m.drivingPressure, pplat: m.pplatFromThisBreath ? m.pplat : null, vtPerKg: m.vtPerKg }));
    const newSevereAlarms = this.alarmLog.slice(this.alarmsAtFixStart).filter((a) => a.active && (SEVERE_ALARMS as readonly string[]).includes(a.alarm)).map((a) => a.alarm);
    const extras = extrasFromTruth(this.scenario?.quizExtras ?? [], this.truthLog.filter((x) => x.tStart >= t0).map((x) => x.m));
    return { ai, breaths: mon, newSevereAlarms: [...new Set(newSevereAlarms)], extras };
  }

  evaluateQuiz(): void {
    if (!this.quiz.fixWindowReady(this.store.tLatest)) return;
    const r = this.quiz.evaluate(this.store.tLatest, this.quizFixInput(), this.settingChanges);
    this.lastDebrief = this.buildQuizDebrief(r.fix);
    r.attempt.debrief = this.lastDebrief.summary;
    if (this.scenario) this.progress.record(this.scenario.id, r.attempt);
    this.view.badges = true;
    this.view.quizLocked = false;
    this.notify();
  }

  endQuiz(): void {
    this.quiz.reset();
    this.view.badges = true;
    this.view.quizLocked = false;
    this.notify();
  }

  /** Latest case-evidence sentences per truth pattern (explain-card templates), for the debrief. */
  private latestEvidenceByPattern(patterns: PatternId[]): Partial<Record<PatternId, string[]>> {
    const out: Partial<Record<PatternId, string[]>> = {};
    const settings = this.settings;
    if (!settings || !this.patient) return out;
    const labels = [...this.labels.values()]
      .map((l) => l.truth)
      .filter((l): l is BreathLabel => l !== null)
      .sort((a, b) => b.tStart - a.tStart);
    for (const p of patterns) {
      if (p === 'ineffective-effort') {
        const e = [...this.efforts].reverse().find((x) => x.ineffective);
        if (e) out[p] = effortEvidence(e, settings);
        continue;
      }
      const l = labels.find((x) => x.patterns.includes(p));
      if (!l) continue;
      const neural = l.neuralIndex !== null ? (this.store.neural.find((n) => n.index === l.neuralIndex) ?? null) : null;
      const ex = explainBreath({ label: l, neural, settings, pbw: this.patient.pbw }).find((c) => c.card.id === p);
      if (ex) out[p] = ex.evidence;
    }
    return out;
  }

  private buildQuizDebrief(fixGrade: FixGrade): Debrief {
    const truthPatterns = this.quiz.identification?.truth ?? this.quizTruthPatterns();
    const t0 = this.quiz.fixWindowStart;
    return buildDebrief({
      changes: this.settingsChangeLog.filter((c) => c.t >= t0 - 1e-9),
      truthPatterns,
      picks: this.quizPicks,
      fixGrade,
      aiBefore: this.aiAtFixStart,
      fix: this.scenario?.fix ?? null,
      settingsAtFixStart: this.settingsAtFixStart,
      finalSettings: this.status?.settings ?? null,
      injectorsAtFixStart: this.injectorsAtFixStart,
      finalInjectors: this.status?.injectors.slice() ?? [],
      driveAtFixStart: this.driveAtFixStart,
      finalDrive: this.drive,
      evidence: this.latestEvidenceByPattern(truthPatterns),
    });
  }

  // ─────────── export ───────────

  sessionCsvText(truth: boolean): string {
    const s = this.store;
    return sessionCsv({ n: s.length, fs: s.fs, get: (ch, i) => s.read(ch, i), breaths: s.breaths, truth });
  }

  sessionJsonDoc(): SessionJson | null {
    if (!this.scenario || !this.patient) return null;
    const labels = [...this.labels.values()];
    const truthLabels = labels.map((l) => l.truth).filter((l): l is BreathLabel => l !== null).sort((a, b) => a.tStart - b.tStart);
    const detectorLabels = labels
      .map((l) => l.det)
      .filter((d): d is DetectedBreath => d !== null)
      .sort((a, b) => a.tStart - b.tStart)
      .map((d) => ({ breathIndex: d.breathIndex, tStart: d.tStart, tEnd: d.tEnd, patterns: d.patterns, evidence: d.evidence }));
    return sessionJson({
      scenario: this.scenario,
      seed: this.scenario.seed,
      fs: this.store.fs,
      pbw: this.patient.pbw,
      settingsLog: this.settingsLog,
      injectorLog: this.injectorLog,
      breaths: this.store.breaths,
      monitor: this.monitorLog,
      truthLabels,
      efforts: this.efforts,
      detectorLabels,
      ieEvents: this.ieEvents,
      maneuvers: this.maneuverLog,
      events: this.store.events,
      co2: this.co2Log,
      ai: this.ai,
    });
  }

  async exportCsv(truth: boolean): Promise<DownloadOutcome> {
    const name = `${this.scenario?.id ?? 'session'}-${truth ? 'truth' : 'measured'}.csv`;
    return downloadBytes(name, this.sessionCsvText(truth), 'text/csv');
  }

  async exportJson(): Promise<DownloadOutcome> {
    const doc = this.sessionJsonDoc();
    if (!doc) return 'failed';
    return downloadBytes(`${this.scenario?.id ?? 'session'}-session.json`, JSON.stringify(doc), 'application/json');
  }

  setBalloon(b: BalloonParams): void {
    this.balloon = b;
    this.worker.setBalloon(b);
    this.notify();
  }

  /** Toggle an injector live (default parameters when enabling). */
  setInjector<K extends InjectorKind>(kind: K, params: Partial<InjectorParamMap[K]> | null): void {
    this.settingsChangeLog.push(injectorChange(this.store.tLatest, kind, params !== null));
    this.worker.inject(kind, params);
  }

  /** Apply a scenario's scripted fix: settings, drive and injector changes, as the emergence test does. */
  applyFix(fix: ScenarioFix): void {
    if (fix.settings) {
      this.settingChanges += 1;
      if (this.status) this.settingsChangeLog.push(...settingChangesFrom(this.store.tLatest, this.status.settings, fix.settings));
      this.worker.applySettings(fix.settings);
    }
    if (fix.drive) {
      this.logDriveChange(fix.drive);
      this.worker.setPatient(fix.drive);
    }
    if (fix.injectors) {
      for (const kind of INJECTOR_KINDS) {
        if (kind in fix.injectors) {
          const params = fix.injectors[kind] ?? null;
          const wasOn = this.status?.injectors.includes(kind) ?? false;
          if ((params !== null) !== wasOn) this.settingsChangeLog.push(injectorChange(this.store.tLatest, kind, params !== null));
          this.worker.inject(kind, params);
        }
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
    if (on && (this.view.quizLocked || this.quizHides('truth'))) return;
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

  /** SIMV: mandatory and spontaneous breaths per minute over the last minute of the scrollback (from the breath events). */
  simvRates(): { mandatory: number; spontaneous: number } {
    const tLatest = this.store.tLatest;
    const span = Math.min(60, tLatest - this.store.tOldest);
    if (!(span > 5)) return { mandatory: 0, spontaneous: 0 };
    let mandatory = 0;
    let spontaneous = 0;
    for (const e of this.store.events) {
      if (e.type !== 'breath' || e.t < tLatest - span) continue;
      if (e.mandatory) mandatory += 1;
      else spontaneous += 1;
    }
    return { mandatory: (60 * mandatory) / span, spontaneous: (60 * spontaneous) / span };
  }
}
