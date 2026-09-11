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
import { resolveScenario, scenarioById, type ScenarioDef } from '../edu/scenarios';
import type { PatientSummary, SessionStatus, WorkerToMain } from '../worker/protocol';
import { StreamStore } from './StreamStore';
import { WorkerClient } from './WorkerClient';

export const SCROLLBACK_SECONDS = 120;

export interface ManeuverReadouts {
  p01: ManeuverResult | null;
  pocc: ManeuverResult | null;
  occlusionTest: ManeuverResult | null;
  inspHold: ManeuverResult | null;
  expHold: ManeuverResult | null;
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
  maneuvers: ManeuverReadouts = { p01: null, pocc: null, occlusionTest: null, inspHold: null, expHold: null };
  alarmLog: Array<Extract<VentEvent, { type: 'alarm' }>> = [];
  view: ViewState = { truth: false, frozen: false, tView: NaN, sweep: 12, speed: 1, paused: false };
  ready = false;
  /** Increments on every tick (canvases use it to detect new data). */
  tickCount = 0;
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
    this.maneuvers = { p01: null, pocc: null, occlusionTest: null, inspHold: null, expHold: null };
    this.alarmLog = [];
    this.view = { ...this.view, frozen: false, tView: NaN, paused: false };
    this.worker.init(spec);
    this.notify();
  }

  private onMessage(m: WorkerToMain): void {
    switch (m.type) {
      case 'ready': {
        this.store = new StreamStore({ fs: m.fs, seconds: SCROLLBACK_SECONDS });
        this.monitor = new Monitor({ fs: m.fs, pbw: m.patient.pbw });
        this.patient = m.patient;
        this.status = m.status;
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
        case 'peep-trial':
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

  maneuver(kind: ManeuverKind): void {
    this.worker.maneuver(kind);
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
