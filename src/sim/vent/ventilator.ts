/**
 * Ventilator: mode state machine on measured signals (device rate) plus continuous actuators
 * (flow source, pressure servo, exhalation valve) at the physics rate. Spec §5, Brief 1 §2.
 *
 *   EXP → (after refractory) → trigger (patient | time | backup) → INSP (rise → target) → cycle → [PAUSE] → EXP
 *
 * Hold and occlusion states are entered at the next eligible phase (Spec §5). Results and alarms are
 * computed from the ventilator's own *measured* signals, as a real device would report them. The
 * ventilator never reads patient truth.
 */
import { k } from '../../config/constants';
import type { AirwayBC, CycleCause, ManeuverResult, Phase, TriggerCause, VentEvent } from '../types';
import { clamp } from '../math/filters';
import { clampSettings, vcTiming, type VentSettings } from './settings';

export interface VentMeasured {
  t: number;
  paw: number;
  flow: number; // L/s, ventilator-side
  vol: number; // L (displayed volume)
  /** Inspired / expired volume of the current breath so far, integrated from measured flow (L). */
  vti: number;
  vte: number;
  pes: number | null;
}

export type AlarmId =
  | 'high-ppeak'
  | 'low-vte'
  | 'high-ve'
  | 'low-ve'
  | 'apnea'
  | 'high-rr'
  | 'disconnect'
  | 'high-leak'
  | 'ti-max'
  | 'high-peepi';

interface BreathPlan {
  mode: VentSettings['mode'];
  ti: number;
  qPeak: number;
  square: boolean;
  rampEnd: number;
  pause: number;
  pTarget: number; // absolute target (PEEP + ΔP)
  riseTime: number;
  ets: number;
  tiMax: number;
  peep: number;
  vt: number;
  /** Spontaneous pressure-targeted breath (PSV/CPAP): flow-cycled with pressure safety. */
  spontaneous: boolean;
}

interface HoldRequest {
  kind: 'insp' | 'exp';
  duration: number;
}

interface ActiveHold {
  kind: 'insp' | 'exp';
  tStart: number;
  tEnd: number;
  p1: number | null;
}

interface BreathHistory {
  tStart: number;
  vte: number;
}

export class Ventilator {
  private settings: VentSettings;
  private pending: Partial<VentSettings> | null = null;
  phase: Phase = 'exp';
  private tPhaseStart = 0;
  private tLastBreathStart = -Infinity;
  /** Start of ventilation (t = 0) is the apnea reference until the first breath. */
  private get tApneaRef(): number {
    return Math.max(0, this.tLastBreathStart);
  }
  private tLastCycle = -Infinity;
  private plan: BreathPlan;
  private breathIndex = -1;
  /** Servo internal source pressure (cmH2O). */
  private psrc: number;
  /** Time at which a pending trigger begins pressurization (actuator latency). */
  private tInspPending: number | null = null;
  private pendingCause: TriggerCause = 'time';
  private peakFlowThisBreath = 0;
  private tEtsMet: number | null = null;
  private lastPaw = 0;
  private tNow = 0;
  private holdRequest: HoldRequest | null = null;
  private hold: ActiveHold | null = null;
  private backupActive = false;
  private readonly alarmState = new Map<AlarmId, boolean>();
  private tDisconnectStart: number | null = null;
  private history: BreathHistory[] = [];
  private lastMeasured: VentMeasured | null = null;
  /** Estimated expiratory leak baseline for optional leak compensation (L/s). */
  private leakBaseline = 0;
  private lastPeepTotal: number | null = null;

  constructor(settings: VentSettings) {
    this.settings = clampSettings(settings);
    this.plan = this.makePlan(this.settings);
    this.psrc = this.settings.peep;
    this.lastPaw = this.settings.peep;
  }

  get current(): VentSettings {
    return this.settings;
  }

  get breathCount(): number {
    return this.breathIndex + 1;
  }

  get inBackup(): boolean {
    return this.backupActive;
  }

  activeAlarms(): AlarmId[] {
    return [...this.alarmState.entries()].filter(([, v]) => v).map(([id]) => id);
  }

  /** Rate, volume and pressure changes take effect from the next breath (Spec §5 settings UX). */
  applySettings(partial: Partial<VentSettings>): void {
    this.pending = { ...(this.pending ?? {}), ...partial };
    // Some settings act immediately (PEEP, trigger, alarms). PEEP is applied through the servo target.
    const immediate: Array<keyof VentSettings> = ['peep', 'triggerType', 'flowTrigger', 'pressureTrigger', 'alarms', 'biasFlow', 'leakCompensation'];
    const target = this.settings as unknown as Record<string, unknown>;
    const pend = this.pending as Record<string, unknown>;
    for (const key of immediate) {
      if (key in partial) {
        target[key] = (partial as Record<string, unknown>)[key];
        delete pend[key];
      }
    }
    this.settings = clampSettings(this.settings);
    this.plan.peep = this.settings.peep;
    if (this.pending && Object.keys(this.pending).length === 0) this.pending = null;
  }

  private commitPending(): void {
    if (!this.pending) return;
    this.settings = clampSettings({ ...this.settings, ...this.pending });
    this.pending = null;
  }

  /** Request an inspiratory or expiratory hold at the next eligible phase. */
  requestHold(kind: 'insp' | 'exp', duration?: number): void {
    const d = duration ?? (kind === 'insp' ? 1.0 : k('EXP_HOLD_DEFAULT'));
    this.holdRequest = { kind, duration: clamp(d, k('INSP_HOLD_MIN'), 4) };
  }

  private makePlan(s: VentSettings, backup = false): BreathPlan {
    const vc = vcTiming(s);
    if (backup) {
      return {
        mode: 'PC-AC',
        ti: s.ti,
        qPeak: vc.qPeak,
        square: true,
        rampEnd: 0,
        pause: 0,
        pTarget: s.peep + s.backupPinsp,
        riseTime: s.riseTime,
        ets: s.ets,
        tiMax: s.tiMax,
        peep: s.peep,
        vt: s.vt / 1000,
        spontaneous: false,
      };
    }
    const isVc = s.mode === 'VC-AC';
    const isPc = s.mode === 'PC-AC';
    const spontaneous = s.mode === 'PSV' || s.mode === 'CPAP';
    const above = isPc ? s.pinsp : s.mode === 'PSV' ? s.ps : 0;
    return {
      mode: s.mode,
      ti: isVc ? vc.ti : s.ti,
      qPeak: vc.qPeak,
      square: s.flowPattern === 'square',
      rampEnd: s.rampEndFraction,
      pause: isVc ? s.pause : 0,
      pTarget: s.peep + above,
      riseTime: s.riseTime,
      ets: s.ets,
      tiMax: s.tiMax,
      peep: s.peep,
      vt: s.vt / 1000,
      spontaneous,
    };
  }

  // ───────────────────────── Continuous actuators (physics rate) ─────────────────────────

  /**
   * Produce the boundary condition for the next physics step. `pawTrue` is the pressure at the valve
   * (the servo's own fast internal sensor).
   */
  actuate(t: number, dt: number, pawTrue: number): AirwayBC {
    this.tNow = t;
    this.lastPaw = pawTrue;
    const s = this.settings;
    const ideal = s.ideal;
    const rsrcInsp = ideal ? 0 : k('SERVO_SOURCE_R');
    const rsrcExp = ideal ? 0 : k('EXH_VALVE_R');
    const tau = ideal ? 0 : s.servoTau;

    const qMax = k('MAX_SERVO_FLOW');
    const servoTo = (target: number, rsrc: number, qMin: number, qMaxOverride?: number): AirwayBC => {
      if (tau <= 0) {
        this.psrc = target;
      } else {
        // Integral action on the airway-pressure error: drives Paw → target with time constant τ.
        this.psrc += ((target - pawTrue) / tau) * dt;
        this.psrc = clamp(this.psrc, -5, 80);
      }
      return { kind: 'pressure', psrc: this.psrc, rsrc, qMin, qMax: qMaxOverride ?? qMax };
    };

    switch (this.phase) {
      case 'insp': {
        const tIn = t - this.tPhaseStart;
        if (this.plan.mode === 'VC-AC') {
          const q = this.vcFlowAt(tIn);
          this.psrc = pawTrue; // keep the servo state continuous for the transition to expiration
          return { kind: 'flow', qv: q };
        }
        const rise = this.plan.riseTime > 0 ? Math.min(1, tIn / this.plan.riseTime) : 1;
        const target = this.plan.peep + (this.plan.pTarget - this.plan.peep) * rise;
        // Exhalation valve closed during inspiration: the source cannot take flow back.
        return servoTo(target, rsrcInsp, 0);
      }
      case 'pause':
      case 'exp-hold':
      case 'occlusion':
        this.psrc = pawTrue;
        return { kind: 'occluded' };
      case 'exp':
        // During expiration the inspiratory valve supplies at most the bias flow; a larger patient demand
        // pulls Paw down (the pressure-trigger mechanism, Brief 1 §2.1).
        return servoTo(this.plan.peep, rsrcExp, -Infinity, s.biasFlow / 60);
    }
  }

  private vcFlowAt(tIn: number): number {
    const p = this.plan;
    if (tIn >= p.ti) return 0;
    if (p.square) return p.qPeak;
    return p.qPeak * (1 - (1 - p.rampEnd) * (tIn / p.ti));
  }

  // ───────────────────────── Discrete control (device rate) ─────────────────────────

  /** Evaluate trigger/cycle rules on measured signals. Returns events emitted this tick. */
  control(m: VentMeasured): VentEvent[] {
    const events: VentEvent[] = [];
    this.lastMeasured = m;
    switch (this.phase) {
      case 'exp':
        this.controlExp(m, events);
        break;
      case 'insp':
        this.controlInsp(m, events);
        break;
      case 'pause':
        this.controlPause(m, events);
        break;
      case 'exp-hold':
        this.controlExpHold(m, events);
        break;
      case 'occlusion':
        // Occlusion maneuvers (P0.1, ΔPocc, occlusion test) — M4.
        break;
    }
    this.checkDisconnect(m, events);
    return events;
  }

  private get isAC(): boolean {
    return this.settings.mode === 'VC-AC' || this.settings.mode === 'PC-AC';
  }

  private get isSpontMode(): boolean {
    return this.settings.mode === 'PSV' || this.settings.mode === 'CPAP';
  }

  private controlExp(m: VentMeasured, events: VentEvent[]): void {
    const t = m.t;
    const s = this.settings;
    // Pending trigger waiting for actuator latency
    if (this.tInspPending !== null) {
      if (t >= this.tInspPending) this.startInsp(t, this.pendingCause, events);
      return;
    }
    // Leak-compensation baseline: slow tracking of expiratory flow once expiration has settled.
    if (t - this.tLastCycle > 0.8) this.leakBaseline += 0.02 * (m.flow - this.leakBaseline);

    const timeDue = this.isAC && t - this.tLastBreathStart >= 60 / s.rr - 1e-9;
    const backupDue = this.backupActive && t - this.tApneaRef >= 60 / s.backupRR - 1e-9;
    // Expiratory hold: taken at the end of expiration (the moment a time trigger would fire in AC, or once
    // expiratory flow has settled in spontaneous modes), blocking the next breath.
    if (this.holdRequest?.kind === 'exp') {
      const settled = !this.isAC && (Math.abs(m.flow) < 0.05 || t - this.tLastCycle > 1.5);
      if (timeDue || settled) {
        this.beginHold('exp', t, events);
        return;
      }
    }
    if (timeDue) {
      this.scheduleInsp(t, 'time', events);
      return;
    }
    if (this.patientTrigger(m)) {
      if (this.backupActive) this.exitBackup(t, events);
      this.scheduleInsp(t, 'patient', events);
      return;
    }
    if (this.isSpontMode && !this.backupActive && t - this.tApneaRef >= s.apneaTime) {
      this.backupActive = true;
      this.setAlarm('apnea', true, t, events);
      this.scheduleInsp(t, 'backup', events);
      return;
    }
    if (backupDue) this.scheduleInsp(t, 'backup', events);
  }

  private exitBackup(t: number, events: VentEvent[]): void {
    this.backupActive = false;
    this.setAlarm('apnea', false, t, events);
  }

  /** Patient trigger detection on measured signals (Brief 1 §2.1). */
  private patientTrigger(m: VentMeasured): boolean {
    const s = this.settings;
    if (m.t - this.tLastCycle < s.refractory) return false;
    if (s.triggerType === 'flow') {
      const flow = s.leakCompensation ? m.flow - this.leakBaseline : m.flow;
      return flow >= s.flowTrigger / 60;
    }
    return m.paw <= s.peep - s.pressureTrigger;
  }

  private scheduleInsp(t: number, cause: TriggerCause, events: VentEvent[]): void {
    events.push({ type: 'trigger', t, cause });
    const latency = this.settings.ideal ? 0 : this.settings.actuatorLatency;
    if (latency <= 0) {
      this.startInsp(t, cause, events);
    } else {
      this.tInspPending = t + latency;
      this.pendingCause = cause;
    }
  }

  private startInsp(t: number, cause: TriggerCause, events: VentEvent[]): void {
    this.tInspPending = null;
    this.evaluateBreathAlarms(t, events);
    this.commitPending();
    this.plan = this.makePlan(this.settings, this.backupActive);
    this.breathIndex += 1;
    this.phase = 'insp';
    this.tPhaseStart = t;
    this.tLastBreathStart = t;
    this.peakFlowThisBreath = 0;
    this.tEtsMet = null;
    // Per-breath latching alarms clear at the start of the next breath.
    this.setAlarm('high-ppeak', false, t, events);
    this.setAlarm('ti-max', false, t, events);
    this.onInspStart?.(t, cause);
  }

  /** Hook for the engine (volume reset, breath bookkeeping). */
  onInspStart: ((t: number, cause: TriggerCause) => void) | null = null;

  private controlInsp(m: VentMeasured, events: VentEvent[]): void {
    const t = m.t;
    const tIn = t - this.tPhaseStart;
    const p = this.plan;
    this.peakFlowThisBreath = Math.max(this.peakFlowThisBreath, m.flow);
    let cycle: CycleCause | null = null;
    if (p.spontaneous) {
      const minTi = k('PSV_CYCLE_MIN_TI');
      const etsMet =
        tIn >= minTi && this.peakFlowThisBreath > k('PSV_CYCLE_MIN_PEAK_FLOW') && m.flow <= p.ets * this.peakFlowThisBreath;
      // The flow criterion must persist for a short confirmation window; pressure safety is immediate.
      if (etsMet) {
        if (this.tEtsMet === null) this.tEtsMet = t;
      } else {
        this.tEtsMet = null;
      }
      if (tIn >= p.riseTime && m.paw > p.pTarget + k('PRESSURE_CYCLE_MARGIN')) {
        cycle = 'pressure';
      } else if (this.tEtsMet !== null && t - this.tEtsMet >= k('ETS_CONFIRM_TIME') - 1e-9) {
        cycle = 'flow';
      } else if (tIn >= p.tiMax) {
        cycle = 'ti-max';
      }
    } else {
      switch (p.mode) {
        case 'VC-AC':
          if (tIn >= p.ti - 1e-9) cycle = 'volume';
          break;
        case 'PC-AC':
        case 'SIMV':
        case 'PRVC':
        case 'PSV':
        case 'CPAP':
          if (tIn >= p.ti - 1e-9) cycle = 'time';
          break;
      }
    }
    if (m.paw > this.settings.alarms.highPpeak) {
      cycle = 'alarm';
      this.setAlarm('high-ppeak', true, t, events);
    }
    if (cycle) {
      events.push({ type: 'cycle', t, cause: cycle });
      this.tLastCycle = t;
      if (cycle === 'ti-max') this.setAlarm('ti-max', true, t, events);
      if (cycle !== 'alarm' && this.holdRequest?.kind === 'insp') {
        this.beginHold('insp', t, events);
      } else if (p.pause > 0 && cycle !== 'alarm') {
        this.phase = 'pause';
        this.tPhaseStart = t;
      } else {
        this.enterExp(t, events, 'insp');
      }
    }
  }

  private controlPause(m: VentMeasured, events: VentEvent[]): void {
    const t = m.t;
    if (this.hold?.kind === 'insp') {
      if (this.hold.p1 === null && t - this.hold.tStart >= k('INSP_HOLD_P1_DELAY')) this.hold.p1 = m.paw;
      if (t >= this.hold.tEnd) {
        const result: ManeuverResult = {
          kind: 'insp',
          tStart: this.hold.tStart,
          tEnd: t,
          p1: this.hold.p1 ?? m.paw,
          p2: m.paw,
        };
        events.push({ type: 'hold-end', t, kind: 'insp' });
        events.push({ type: 'maneuver', t, result });
        this.hold = null;
        this.enterExp(t, events, 'pause');
      }
      return;
    }
    if (t - this.tPhaseStart >= this.plan.pause) this.enterExp(t, events, 'pause');
  }

  private controlExpHold(m: VentMeasured, events: VentEvent[]): void {
    const t = m.t;
    if (!this.hold) {
      this.phase = 'exp';
      return;
    }
    if (t >= this.hold.tEnd) {
      const result: ManeuverResult = { kind: 'exp', tStart: this.hold.tStart, tEnd: t, peepTotal: m.paw };
      events.push({ type: 'hold-end', t, kind: 'exp' });
      events.push({ type: 'maneuver', t, result });
      this.lastPeepTotal = m.paw;
      this.setAlarm('high-peepi', m.paw - this.settings.peep > this.settings.alarms.highPeepi, t, events);
      this.hold = null;
      this.phase = 'exp';
      this.tPhaseStart = t;
      // The held breath is delivered now in AC modes.
      if (this.isAC) this.scheduleInsp(t, 'time', events);
    }
  }

  private beginHold(kind: 'insp' | 'exp', t: number, events: VentEvent[]): void {
    const req = this.holdRequest;
    this.holdRequest = null;
    const duration = req?.duration ?? 1;
    this.hold = { kind, tStart: t, tEnd: t + duration, p1: null };
    this.phase = kind === 'insp' ? 'pause' : 'exp-hold';
    this.tPhaseStart = t;
    events.push({ type: 'hold-start', t, kind });
  }

  private enterExp(t: number, events: VentEvent[], from: 'insp' | 'pause'): void {
    if (from === 'pause') events.push({ type: 'pause-end', t });
    this.phase = 'exp';
    this.tPhaseStart = t;
    this.psrc = this.lastPaw;
  }

  // ───────────────────────── Alarms (Brief 1 §2.6) ─────────────────────────

  private setAlarm(id: AlarmId, active: boolean, t: number, events: VentEvent[]): void {
    const was = this.alarmState.get(id) ?? false;
    if (was === active) return;
    this.alarmState.set(id, active);
    events.push({ type: 'alarm', t, alarm: id, active });
  }

  /** Breath-based alarms, evaluated when the next breath starts (previous breath's measured volumes). */
  private evaluateBreathAlarms(t: number, events: VentEvent[]): void {
    const m = this.lastMeasured;
    const a = this.settings.alarms;
    if (m && this.breathIndex >= 0) {
      const vtiMl = m.vti * 1000;
      const vteMl = m.vte * 1000;
      this.setAlarm('low-vte', vteMl < a.lowVte, t, events);
      const leakPct = vtiMl > 50 ? (100 * (vtiMl - vteMl)) / vtiMl : 0;
      this.setAlarm('high-leak', leakPct > a.highLeak, t, events);
      this.history.push({ tStart: this.tLastBreathStart, vte: m.vte });
    }
    // Rolling one-minute window for rate and minute ventilation.
    const window = 60;
    this.history = this.history.filter((h) => t - h.tStart <= window);
    const span = Math.min(window, t - (this.history[0]?.tStart ?? t));
    if (this.history.length >= 3 && span > 20) {
      const rr = (this.history.length * 60) / span;
      const ve = (this.history.reduce((s, h) => s + h.vte, 0) * 60) / span;
      this.setAlarm('high-rr', rr > a.highRR, t, events);
      this.setAlarm('high-ve', ve > a.highVe, t, events);
      this.setAlarm('low-ve', ve < a.lowVe, t, events);
    }
  }

  private checkDisconnect(m: VentMeasured, events: VentEvent[]): void {
    // Any phase: a disconnected circuit never pressurizes, and auto-triggering through the leak can keep
    // expiration too short for a phase-limited check.
    const low = m.paw < this.settings.peep - this.settings.alarms.lowPeep;
    if (low) {
      if (this.tDisconnectStart === null) this.tDisconnectStart = m.t;
      if (m.t - this.tDisconnectStart > k('DISCONNECT_SUSTAIN')) this.setAlarm('disconnect', true, m.t, events);
    } else {
      this.tDisconnectStart = null;
      if (!low) this.setAlarm('disconnect', false, m.t, events);
    }
  }

  /** Time since the last cycle-off (for refractory logic). */
  get sinceCycle(): number {
    return this.tNow - this.tLastCycle;
  }

  /** Last measured total PEEP from an expiratory hold, if any. */
  get peepTotalMeasured(): number | null {
    return this.lastPeepTotal;
  }
}
