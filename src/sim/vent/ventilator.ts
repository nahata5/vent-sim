/**
 * Ventilator: mode state machine on measured signals (device rate) plus continuous actuators
 * (flow source, pressure servo, exhalation valve) at the physics rate. Spec §5, Brief 1 §2.
 *
 *   EXP → (after refractory) → trigger (patient | time | backup) → INSP (rise → target) → cycle → [PAUSE] → EXP
 *
 * Hold and occlusion states are entered at the next eligible phase (Spec §5). Results are computed from
 * the ventilator's own *measured* airway pressure, as a real device would report them.
 */
import { k } from '../../config/constants';
import type { AirwayBC, CycleCause, ManeuverResult, Phase, TriggerCause, VentEvent } from '../types';
import { clamp } from '../math/filters';
import { clampSettings, vcTiming, type VentSettings } from './settings';

export interface VentMeasured {
  t: number;
  paw: number;
  flow: number; // L/s
  vol: number; // L (displayed volume)
  pes: number | null;
}

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

export class Ventilator {
  private settings: VentSettings;
  private pending: Partial<VentSettings> | null = null;
  phase: Phase = 'exp';
  private tPhaseStart = 0;
  private tLastBreathStart = -Infinity;
  private tLastCycle = -Infinity;
  private plan: BreathPlan;
  private breathIndex = -1;
  /** Servo internal source pressure (cmH2O). */
  private psrc: number;
  /** Time at which a pending trigger begins pressurization (actuator latency). */
  private tInspPending: number | null = null;
  private pendingCause: TriggerCause = 'time';
  private peakFlowThisBreath = 0;
  private lastPaw = 0;
  private tNow = 0;
  private holdRequest: HoldRequest | null = null;
  private hold: ActiveHold | null = null;

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

  /** Rate, volume and pressure changes take effect from the next breath (Spec §5 settings UX). */
  applySettings(partial: Partial<VentSettings>): void {
    this.pending = { ...(this.pending ?? {}), ...partial };
    // Some settings act immediately (PEEP, trigger, alarms). PEEP is applied through the servo target.
    const immediate: Array<keyof VentSettings> = ['peep', 'triggerType', 'flowTrigger', 'pressureTrigger', 'alarms', 'biasFlow'];
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

  private makePlan(s: VentSettings): BreathPlan {
    const vc = vcTiming(s);
    const isVc = s.mode === 'VC-AC';
    const isPc = s.mode === 'PC-AC';
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

    const servoTo = (target: number, rsrc: number): AirwayBC => {
      if (tau <= 0) {
        this.psrc = target;
      } else {
        // Integral action on the airway-pressure error: drives Paw → target with time constant τ.
        this.psrc += ((target - pawTrue) / tau) * dt;
        this.psrc = clamp(this.psrc, -5, 80);
      }
      return { kind: 'pressure', psrc: this.psrc, rsrc };
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
        return servoTo(target, rsrcInsp);
      }
      case 'pause':
      case 'exp-hold':
      case 'occlusion':
        this.psrc = pawTrue;
        return { kind: 'occluded' };
      case 'exp':
        return servoTo(this.plan.peep, rsrcExp);
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
    return events;
  }

  private get isAC(): boolean {
    return this.settings.mode === 'VC-AC' || this.settings.mode === 'PC-AC';
  }

  private controlExp(m: VentMeasured, events: VentEvent[]): void {
    const t = m.t;
    const s = this.settings;
    // Pending trigger waiting for actuator latency
    if (this.tInspPending !== null) {
      if (t >= this.tInspPending) this.startInsp(t, this.pendingCause, events);
      return;
    }
    const timeDue = this.isAC && t - this.tLastBreathStart >= 60 / s.rr - 1e-9;
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
    // Patient trigger (after refractory) — enabled in M3.
    if (this.patientTrigger(m)) {
      this.scheduleInsp(t, 'patient', events);
    }
  }

  /** Patient trigger detection on measured signals. Placeholder until M3. */
  protected patientTrigger(_m: VentMeasured): boolean {
    return false;
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

  private startInsp(t: number, cause: TriggerCause, _events: VentEvent[]): void {
    this.tInspPending = null;
    this.commitPending();
    this.plan = this.makePlan(this.settings);
    this.breathIndex += 1;
    this.phase = 'insp';
    this.tPhaseStart = t;
    this.tLastBreathStart = t;
    this.peakFlowThisBreath = 0;
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
    switch (p.mode) {
      case 'VC-AC':
        if (tIn >= p.ti - 1e-9) cycle = 'volume';
        break;
      case 'PC-AC':
        if (tIn >= p.ti - 1e-9) cycle = 'time';
        break;
      case 'PSV':
      case 'CPAP':
        // Flow cycling (ETS), Ti_max and pressure cycling — M3.
        if (tIn >= p.tiMax) cycle = 'ti-max';
        break;
      case 'SIMV':
      case 'PRVC':
        // Reserved (Spec §1: interfaces ready, modes not built).
        if (tIn >= p.ti) cycle = 'time';
        break;
    }
    if (m.paw > this.settings.alarms.highPpeak) cycle = 'alarm';
    if (cycle) {
      events.push({ type: 'cycle', t, cause: cycle });
      this.tLastCycle = t;
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

  /** Time since the last cycle-off (for refractory logic). */
  get sinceCycle(): number {
    return this.tNow - this.tLastCycle;
  }
}
