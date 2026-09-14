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
import type { AirwayBC, BreathKind, CycleCause, ManeuverKind, ManeuverResult, Phase, TriggerCause, VentEvent } from '../types';
import { clamp } from '../math/filters';
import { clampSettings, vcTiming, type VentSettings } from './settings';
import { makePeepManeuver, type PeepManeuver, type PeepManeuverKind } from './peep-maneuvers';

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
  | 'high-peepi'
  | 'prvc-limit';

interface BreathPlan {
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
  kind: BreathKind;
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
  /** Expiratory hold: short history of Paw and the running plateau (max of the smoothed signal). */
  pawHist: number[];
  plateau: number;
}

interface BreathHistory {
  tStart: number;
  vte: number;
}

type OcclusionKind = Extract<ManeuverKind, 'p01' | 'pocc' | 'occlusion-test'>;

interface ActiveOcclusion {
  kind: OcclusionKind;
  tStart: number;
  baselinePaw: number;
  baselinePes: number | null;
  minPaw: number;
  minPes: number | null;
  tOnset: number | null;
  prevPaw: number;
  prevT: number;
  /** 0 = classic (occlusion before the effort), 1 = at-trigger fallback. */
  method: number;
  /** Short history for moving averages that suppress the cardiac artifact (whole-breath maneuvers). */
  pawHist: number[];
  pesHist: number[];
  nBaseline: number;
}

export class Ventilator {
  private settings: VentSettings;
  private pending: Partial<VentSettings> | null = null;
  phase: Phase = 'exp';
  private tPhaseStart = 0;
  private tLastBreathStart = -Infinity;
  /** Start of the last mandatory (non-spontaneous) breath; the SIMV period clock. */
  private tLastMandatory = -Infinity;
  /** Breath kind requested for the pending trigger, while it waits out the actuator latency. */
  private pendingKind: BreathKind | undefined;
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
  private peakPawThisBreath = 0;
  private tEtsMet: number | null = null;
  /** Active R/I or decremental PEEP trial (Spec §5), driven by breath-start, cycle and hold events. */
  private peepManeuver: PeepManeuver | null = null;
  private lastPaw = 0;
  private tNow = 0;
  private holdRequest: HoldRequest | null = null;
  private hold: ActiveHold | null = null;
  private occlusionRequest: OcclusionKind | null = null;
  private occlusion: ActiveOcclusion | null = null;
  private backupActive = false;
  private readonly alarmState = new Map<AlarmId, boolean>();
  private tDisconnectStart: number | null = null;
  private history: BreathHistory[] = [];
  private lastMeasured: VentMeasured | null = null;
  /** Estimated expiratory leak baseline for optional leak compensation (L/s). */
  private leakBaseline = 0;
  private lastPeepTotal: number | null = null;
  /** PRVC: regulated pressure above PEEP, null until the test breath has estimated compliance. */
  private regulatedDp: number | null = null;
  /** PRVC: the breath now being delivered is the VC test breath whose plateau seeds `regulatedDp`. */
  private prvcTestPending = false;
  /** PRVC: consecutive breaths at the pressure ceiling that fell short of the volume target. */
  private prvcShortCount = 0;
  /** PRVC: compliance measured by the last test breath (L/cmH2O), the fallback when ΔP is too small to divide by. */
  private prvcCompliance = NaN;
  /** Settings actually in effect over time (initial + each commit), for the labeler and exports. */
  readonly settingsLog: Array<{ t: number; settings: VentSettings }> = [];

  constructor(settings: VentSettings) {
    this.settings = clampSettings(settings);
    this.plan = this.makePlan(this.settings);
    this.psrc = this.settings.peep;
    this.lastPaw = this.settings.peep;
    this.settingsLog.push({ t: 0, settings: this.settings });
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

  /** Settings accepted but not yet in effect (they commit at the next breath start). */
  pendingKeys(): Array<keyof VentSettings> {
    return this.pending ? (Object.keys(this.pending) as Array<keyof VentSettings>) : [];
  }

  /** Rate, volume and pressure changes take effect from the next breath (Spec §5 settings UX). */
  applySettings(partial: Partial<VentSettings>): void {
    this.pending = { ...(this.pending ?? {}), ...partial };
    // Some settings act immediately (PEEP, trigger, alarms). PEEP is applied through the servo target.
    const immediate: Array<keyof VentSettings> = ['peep', 'triggerType', 'flowTrigger', 'pressureTrigger', 'alarms', 'biasFlow', 'leakCompensation'];
    // Copy before mutating: the previous settings object is referenced by the settings log (labeler context).
    const target = { ...this.settings } as unknown as Record<string, unknown>;
    const pend = this.pending as Record<string, unknown>;
    for (const key of immediate) {
      if (key in partial) {
        target[key] = (partial as Record<string, unknown>)[key];
        delete pend[key];
      }
    }
    const prev = this.settings;
    this.settings = clampSettings(target as unknown as VentSettings);
    this.prvcResetIfRetargeted(prev);
    this.plan.peep = this.settings.peep;
    if (this.pending && Object.keys(this.pending).length === 0) this.pending = null;
    this.settingsLog.push({ t: this.tNow, settings: this.settings });
  }

  private commitPending(): void {
    if (!this.pending) return;
    const prev = this.settings;
    this.settings = clampSettings({ ...this.settings, ...this.pending });
    this.prvcResetIfRetargeted(prev);
    this.pending = null;
    this.settingsLog.push({ t: this.tNow, settings: this.settings });
  }

  /** Request an end-expiratory occlusion maneuver (P0.1, ΔPocc, or the balloon occlusion test). */
  requestOcclusion(kind: OcclusionKind): void {
    this.occlusionRequest = kind;
  }

  /** Request an inspiratory or expiratory hold at the next eligible phase. */
  requestHold(kind: 'insp' | 'exp', duration?: number): void {
    const d = duration ?? (kind === 'insp' ? 1.0 : k('EXP_HOLD_DEFAULT'));
    this.holdRequest = { kind, duration: clamp(d, k('INSP_HOLD_MIN'), 4) };
  }

  /** Start an R/I release or a decremental PEEP trial (ignored while one is running). */
  requestPeepManeuver(kind: PeepManeuverKind): void {
    if (this.peepManeuver) return;
    const vent = this; // eslint-disable-line @typescript-eslint/no-this-alias
    const host = {
      get peep() {
        return vent.settings.peep;
      },
      setPeep: (p: number) => this.applySettings({ peep: p }),
      requestInspHold: () => this.requestHold('insp'),
      cancelInspHold: () => {
        if (this.holdRequest?.kind === 'insp') this.holdRequest = null;
      },
    };
    this.peepManeuver = makePeepManeuver(kind, host, this.tNow);
  }

  get peepManeuverActive(): PeepManeuverKind | null {
    return this.peepManeuver?.kind ?? null;
  }

  private vcPlan(s: VentSettings): BreathPlan {
    const vc = vcTiming(s);
    return {
      ti: vc.ti,
      qPeak: vc.qPeak,
      square: s.flowPattern === 'square',
      rampEnd: s.rampEndFraction,
      pause: s.pause,
      pTarget: s.peep,
      riseTime: s.riseTime,
      ets: s.ets,
      tiMax: s.tiMax,
      peep: s.peep,
      vt: s.vt / 1000,
      spontaneous: false,
      kind: 'vc',
    };
  }

  private pcPlan(s: VentSettings, above: number): BreathPlan {
    const vc = vcTiming(s);
    return {
      ti: s.ti,
      qPeak: vc.qPeak,
      square: s.flowPattern === 'square',
      rampEnd: s.rampEndFraction,
      pause: 0,
      pTarget: s.peep + above,
      riseTime: s.riseTime,
      ets: s.ets,
      tiMax: s.tiMax,
      peep: s.peep,
      vt: s.vt / 1000,
      spontaneous: false,
      kind: 'pc',
    };
  }

  private psPlan(s: VentSettings): BreathPlan {
    const vc = vcTiming(s);
    const above = s.mode === 'CPAP' ? 0 : s.ps;
    return {
      ti: s.ti,
      qPeak: vc.qPeak,
      square: s.flowPattern === 'square',
      rampEnd: s.rampEndFraction,
      pause: 0,
      pTarget: s.peep + above,
      riseTime: s.riseTime,
      ets: s.ets,
      tiMax: s.tiMax,
      peep: s.peep,
      vt: s.vt / 1000,
      spontaneous: true,
      kind: 'ps',
    };
  }

  private makePlan(s: VentSettings, backup = false, kind?: BreathKind): BreathPlan {
    if (backup) {
      const plan = this.pcPlan(s, s.backupPinsp);
      return { ...plan, ti: s.ti, square: true, rampEnd: 0 };
    }
    switch (s.mode) {
      case 'VC-AC':
        return this.vcPlan(s);
      case 'PC-AC':
        return this.pcPlan(s, s.pinsp);
      case 'PSV':
      case 'CPAP':
        return this.psPlan(s);
      case 'SIMV':
        return kind === 'ps' ? this.psPlan(s) : s.simvBase === 'PC' ? this.pcPlan(s, s.pinsp) : this.vcPlan(s);
      case 'PRVC':
        // Until compliance is known, a square-flow VC test breath over the set Ti with a short pause.
        return this.regulatedDp === null
          ? this.vcPlan({ ...s, vcTiming: 'ti', flowPattern: 'square', pause: k('PRVC_TEST_PAUSE') })
          : this.pcPlan(s, this.regulatedDp);
    }
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
        if (this.plan.kind === 'vc') {
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
        this.controlOcclusion(m, events);
        break;
    }
    if (this.phase !== 'occlusion') this.checkDisconnect(m, events);
    // A PEEP maneuver whose hold could not be taken (alarm-cycled breaths) advances on an invalid readout.
    const pm = this.peepManeuver;
    if (pm?.pendingInvalid) {
      const read = pm.pendingInvalid;
      pm.pendingInvalid = null;
      const done = pm.onHold(read);
      if (done) {
        events.push({ type: 'maneuver', t: m.t, result: done });
        this.peepManeuver = null;
      }
    }
    return events;
  }

  private get hasMandatoryRate(): boolean {
    const mode = this.settings.mode;
    return mode === 'VC-AC' || mode === 'PC-AC' || mode === 'SIMV' || mode === 'PRVC';
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

    const period = 60 / s.rr;
    const sinceMandatory = t - (s.mode === 'SIMV' ? this.tLastMandatory : this.tLastBreathStart);
    const timeDue = this.hasMandatoryRate && sinceMandatory >= period - 1e-9;
    const inSyncWindow = s.mode === 'SIMV' && sinceMandatory >= period * (1 - s.simvWindow);
    const backupDue = this.backupActive && t - this.tApneaRef >= 60 / s.backupRR - 1e-9;
    // Expiratory hold: taken at the end of expiration (the moment a time trigger would fire in AC, or once
    // expiratory flow has settled in spontaneous modes), blocking the next breath.
    // "Settled" expiration in spontaneous modes: past the fast part of exhalation, no inspiratory flow
    // yet (an effort in progress must not be occluded mid-way), Paw back at PEEP.
    const settled =
      !this.hasMandatoryRate &&
      t - this.tLastCycle > 0.6 &&
      m.flow <= 0.005 &&
      m.flow >= -k('OCCLUSION_SETTLED_FLOW') &&
      m.paw >= s.peep - 0.3;
    if (this.holdRequest?.kind === 'exp') {
      if (timeDue || settled) {
        this.beginHold('exp', t, events);
        return;
      }
    }
    if (this.occlusionRequest && (timeDue || settled || (this.hasMandatoryRate && t - this.tLastCycle > 1.0))) {
      this.beginOcclusion(m, events);
      return;
    }
    // P0.1 fallback when the effort arrives before expiration settles (vendor method): occlude for
    // 100 ms from the trigger detection. Reads a little low because the deflection has already begun.
    if (this.occlusionRequest === 'p01' && this.patientTrigger(m)) {
      this.beginOcclusion(m, events);
      const o = this.occlusion;
      if (o) {
        o.tOnset = t;
        o.method = 1;
      }
      return;
    }
    if (timeDue) {
      this.scheduleInsp(t, 'time', events);
      return;
    }
    if (this.patientTrigger(m)) {
      if (this.backupActive) this.exitBackup(t, events);
      this.scheduleInsp(t, 'patient', events, s.mode === 'SIMV' && !inSyncWindow ? 'ps' : undefined);
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

  private scheduleInsp(t: number, cause: TriggerCause, events: VentEvent[], kind?: BreathKind): void {
    events.push({ type: 'trigger', t, cause });
    const latency = this.settings.ideal ? 0 : this.settings.actuatorLatency;
    if (latency <= 0) {
      this.startInsp(t, cause, events, kind);
    } else {
      this.tInspPending = t + latency;
      this.pendingCause = cause;
      this.pendingKind = kind;
    }
  }

  private startInsp(t: number, cause: TriggerCause, events: VentEvent[], kind?: BreathKind): void {
    this.tInspPending = null;
    const resolvedKind = kind ?? this.pendingKind;
    this.pendingKind = undefined;
    this.evaluateBreathAlarms(t, events);
    this.commitPending();
    this.prvcRegulate(t, events);
    this.plan = this.makePlan(this.settings, this.backupActive, resolvedKind);
    if (!this.plan.spontaneous) this.tLastMandatory = t;
    this.breathIndex += 1;
    events.push({ type: 'breath', t, kind: this.plan.kind, mandatory: !this.plan.spontaneous, pTarget: this.plan.kind === 'vc' ? NaN : this.plan.pTarget });
    this.phase = 'insp';
    this.tPhaseStart = t;
    this.tLastBreathStart = t;
    this.peakFlowThisBreath = 0;
    this.peakPawThisBreath = 0;
    this.tEtsMet = null;
    // Per-breath latching alarms clear at the start of the next breath.
    this.setAlarm('high-ppeak', false, t, events);
    this.setAlarm('ti-max', false, t, events);
    this.onInspStart?.(t, cause);
    this.peepManeuver?.onBreathStart(t, this.breathIndex, this.history[this.history.length - 1]?.vte ?? NaN);
  }

  /** Hook for the engine (volume reset, breath bookkeeping). */
  onInspStart: ((t: number, cause: TriggerCause) => void) | null = null;

  private controlInsp(m: VentMeasured, events: VentEvent[]): void {
    const t = m.t;
    const tIn = t - this.tPhaseStart;
    const p = this.plan;
    this.peakFlowThisBreath = Math.max(this.peakFlowThisBreath, m.flow);
    this.peakPawThisBreath = Math.max(this.peakPawThisBreath, m.paw);
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
    } else if (tIn >= p.ti - 1e-9) {
      // Non-spontaneous plans are volume-controlled (kind 'vc': VC-AC, or SIMV with a VC mandatory
      // breath) or pressure-controlled (kind 'pc': PC-AC, PRVC, SIMV-PC, or the apnea backup).
      cycle = p.kind === 'vc' ? 'volume' : 'time';
    }
    if (m.paw > this.settings.alarms.highPpeak) {
      cycle = 'alarm';
      this.setAlarm('high-ppeak', true, t, events);
    }
    if (cycle) {
      events.push({ type: 'cycle', t, cause: cycle });
      this.tLastCycle = t;
      if (cycle === 'ti-max') this.setAlarm('ti-max', true, t, events);
      this.peepManeuver?.onCycle(
        t,
        this.breathIndex,
        this.history.map((h) => h.vte),
      );
      if (cycle !== 'alarm' && this.holdRequest?.kind === 'insp') {
        this.beginHold('insp', t, events);
      } else if (p.pause > 0 && cycle !== 'alarm') {
        this.phase = 'pause';
        this.tPhaseStart = t;
      } else {
        // A test breath cut short (alarm cycle) has no plateau: seed from the end-inspiratory pressure.
        this.prvcSeedFromTestBreath(m);
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
        this.prvcSeedFromTestBreath(m);
        this.enterExp(t, events, 'pause');
        if (this.peepManeuver) {
          const done = this.peepManeuver.onHold({ t, pplat: m.paw, vti: m.vti, pes: m.pes, ppeak: this.peakPawThisBreath, rr: this.settings.rr });
          if (done) {
            events.push({ type: 'maneuver', t, result: done });
            this.peepManeuver = null;
          }
        }
      }
      return;
    }
    if (t - this.tPhaseStart >= this.plan.pause) {
      this.prvcSeedFromTestBreath(m);
      this.enterExp(t, events, 'pause');
    }
  }

  private controlExpHold(m: VentMeasured, events: VentEvent[]): void {
    const t = m.t;
    if (!this.hold) {
      this.phase = 'exp';
      return;
    }
    // Track the plateau on a short moving average; a patient effort pulls Paw below it and ends the hold
    // early (Brief 2 §5: total PEEP is read on the relaxed plateau, an active patient invalidates the rest).
    const h = this.hold;
    const win = Math.max(1, Math.round(k('OCCLUSION_BASELINE_WINDOW') * this.settings.deviceRate));
    h.pawHist.push(m.paw);
    if (h.pawHist.length > win) h.pawHist.shift();
    const pawS = h.pawHist.reduce((x, y) => x + y, 0) / h.pawHist.length;
    if (pawS > h.plateau) h.plateau = pawS;
    const interrupted = t - h.tStart > 0.2 && h.plateau - pawS > k('POCC_MIN_DIP');
    if (t >= h.tEnd || interrupted) {
      const peepTotal = interrupted ? h.plateau : pawS;
      const result: ManeuverResult = { kind: 'exp', tStart: h.tStart, tEnd: t, peepTotal };
      if (interrupted) result.values = { interrupted: 1 };
      events.push({ type: 'hold-end', t, kind: 'exp' });
      events.push({ type: 'maneuver', t, result });
      this.lastPeepTotal = peepTotal;
      this.setAlarm('high-peepi', peepTotal - this.settings.peep > this.settings.alarms.highPeepi, t, events);
      this.hold = null;
      this.phase = 'exp';
      this.tPhaseStart = t;
      // The held breath is delivered now in AC modes; an interrupting effort triggers it in any mode.
      if (interrupted) this.scheduleInsp(t, 'patient', events);
      else if (this.hasMandatoryRate) this.scheduleInsp(t, 'time', events);
    }
  }

  private beginOcclusion(m: VentMeasured, events: VentEvent[]): void {
    const kind = this.occlusionRequest ?? 'pocc';
    this.occlusionRequest = null;
    this.occlusion = {
      kind,
      tStart: m.t,
      baselinePaw: m.paw,
      baselinePes: m.pes,
      minPaw: m.paw,
      minPes: m.pes,
      tOnset: null,
      prevPaw: m.paw,
      prevT: m.t,
      method: 0,
      pawHist: [],
      pesHist: [],
      nBaseline: 0,
    };
    this.phase = 'occlusion';
    this.tPhaseStart = m.t;
    events.push({ type: 'hold-start', t: m.t, kind: 'occlusion' });
  }

  private endOcclusion(t: number, values: Record<string, number>, events: VentEvent[], triggerBreath: boolean): void {
    const o = this.occlusion;
    if (!o) return;
    const result: ManeuverResult = { kind: o.kind, tStart: o.tStart, tEnd: t, values };
    events.push({ type: 'hold-end', t, kind: 'occlusion' });
    events.push({ type: 'maneuver', t, result });
    this.occlusion = null;
    this.phase = 'exp';
    this.tPhaseStart = t;
    if (triggerBreath) this.scheduleInsp(t, 'patient', events);
  }

  /**
   * Occlusion maneuvers on measured Paw (and Pes for the occlusion test), Brief 2 §4–5. After the valves
   * close, Paw first rises toward the alveolar pressure (total PEEP), so the reference for every
   * deflection is the pre-effort plateau (running maximum), not the Paw at the instant of occlusion.
   *  - P0.1: Paw drop over the first 100 ms after the onset of the deflection, then release the breath.
   *  - ΔPocc: whole-effort occlusion, min Paw − plateau.
   *  - Occlusion test: ΔPes/ΔPaw over the same effort (Baydur 1982), on cardiac-smoothed signals.
   */
  private controlOcclusion(m: VentMeasured, events: VentEvent[]): void {
    const o = this.occlusion;
    if (!o) {
      this.phase = 'exp';
      return;
    }
    const t = m.t;
    if (o.kind === 'p01') {
      if (t - o.tStart > k('OCCLUSION_TIMEOUT')) {
        this.endOcclusion(t, { p01: NaN, method: o.method }, events, false);
        return;
      }
      if (o.tOnset === null) {
        // Track the pre-effort plateau on a short average; the plateau and the dip are read on the smoothed
        // signal so sensor noise cannot fake an onset, and the onset itself is the last raw sample still
        // inside the noise band of the plateau.
        const win = Math.max(1, Math.round(k('OCCLUSION_BASELINE_WINDOW') * this.settings.deviceRate));
        o.pawHist.push(m.paw);
        if (o.pawHist.length > win) o.pawHist.shift();
        const pawS = o.pawHist.reduce((x, y) => x + y, 0) / o.pawHist.length;
        if (pawS > o.baselinePaw) o.baselinePaw = pawS;
        if (m.paw >= o.baselinePaw - k('P01_NOISE_BAND')) {
          o.prevT = t;
          o.prevPaw = pawS; // plateau level at the onset (smoothed, unbiased by the running-max noise)
        }
        const dip = o.baselinePaw - pawS;
        if (dip >= k('P01_ONSET_THRESHOLD') && o.pawHist.length >= win) {
          o.tOnset = o.prevT;
          o.baselinePaw = o.prevPaw;
          o.pesHist = []; // reused as the readout buffer for the last few raw samples
        }
        return;
      }
      // Readout: average of the last 2 raw samples ending at onset + 100 ms (noise σ/√2, ~5 ms lag).
      o.pesHist.push(m.paw);
      if (o.pesHist.length > 2) o.pesHist.shift();
      if (t >= o.tOnset + k('P01_WINDOW') - 1e-9) {
        const read = o.pesHist.reduce((x, y) => x + y, 0) / o.pesHist.length;
        this.endOcclusion(t, { p01: o.baselinePaw - read, method: o.method, tOnset: o.tOnset }, events, true);
      }
      return;
    } else {
      // Whole-effort maneuvers: read the swings on signals averaged over OCCLUSION_SMOOTHING so the
      // cardiac artifact on Pes (and any on Paw) does not inflate the deflection.
      const win = Math.max(1, Math.round(k('OCCLUSION_SMOOTHING') * this.settings.deviceRate));
      o.pawHist.push(m.paw);
      if (o.pawHist.length > win) o.pawHist.shift();
      if (m.pes !== null) {
        o.pesHist.push(m.pes);
        if (o.pesHist.length > win) o.pesHist.shift();
      }
      const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const pawS = mean(o.pawHist);
      const pesS = o.pesHist.length > 0 ? mean(o.pesHist) : null;
      const dipSoFar = o.baselinePaw - o.minPaw;
      if (dipSoFar < k('POCC_MIN_DIP') && pawS >= o.baselinePaw) {
        // Still on the pre-effort plateau: track its running maximum as the reference.
        o.baselinePaw = pawS;
        o.baselinePes = pesS;
        o.minPaw = pawS;
        o.minPes = pesS;
      } else {
        o.minPaw = Math.min(o.minPaw, pawS);
        if (pesS !== null) o.minPes = o.minPes === null ? pesS : Math.min(o.minPes, pesS);
      }
      const maxDip = o.baselinePaw - o.minPaw;
      const recovered = maxDip >= k('POCC_MIN_DIP') && o.baselinePaw - pawS <= 0.3 * maxDip && t - o.tStart > 0.5;
      if (recovered || t - o.tStart > k('OCCLUSION_TIMEOUT')) {
        const dPocc = maxDip >= k('POCC_MIN_DIP') ? -maxDip : NaN;
        const values: Record<string, number> = { dPocc };
        if (o.kind === 'occlusion-test') {
          const dPes = o.baselinePes !== null && o.minPes !== null ? o.minPes - o.baselinePes : NaN;
          values.dPaw = dPocc;
          values.dPes = dPes;
          values.ratio = dPes / dPocc;
        }
        this.endOcclusion(t, values, events, false);
        return;
      }
    }
    o.prevPaw = m.paw;
    o.prevT = t;
  }

  private beginHold(kind: 'insp' | 'exp', t: number, events: VentEvent[]): void {
    const req = this.holdRequest;
    this.holdRequest = null;
    const duration = req?.duration ?? 1;
    this.hold = { kind, tStart: t, tEnd: t + duration, p1: null, pawHist: [], plateau: -Infinity };
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

  // ───────────────────────── PRVC regulator (Spec 2026-09-14 §3, D-023) ─────────────────────────

  /** Highest regulated ΔP above PEEP: the pressure alarm limit less a safety margin, never below the floor. */
  private prvcCeiling(s: VentSettings): number {
    return Math.max(s.prvcMinDp, s.alarms.highPpeak - k('PRVC_PMAX_MARGIN') - s.peep);
  }

  /**
   * At the start of a PRVC breath: adapt ΔP toward the volume target from the volume the previous breath
   * actually delivered (its effective compliance Vti/ΔP), limited to PRVC_STEP_MAX per breath and to the
   * floor/ceiling band. Two consecutive short breaths at the ceiling raise the volume-not-achieved alarm.
   */
  private prvcRegulate(t: number, events: VentEvent[]): void {
    const s = this.settings;
    if (s.mode !== 'PRVC') {
      // Another mode has no regulated pressure: the volume-not-achieved condition has ended.
      this.prvcShortCount = 0;
      this.setAlarm('prvc-limit', false, t, events);
      return;
    }
    if (this.regulatedDp === null) {
      // No compliance estimate yet: the plan built next is the VC test breath.
      this.prvcTestPending = true;
      this.prvcShortCount = 0;
      this.setAlarm('prvc-limit', false, t, events);
      return;
    }
    const m = this.lastMeasured;
    if (!m || this.breathIndex < 0) return;
    // The volume sensor resets on the next breath start (engine.onInspStart), so this is still the
    // inspired volume of the breath that just ended.
    const vtiPrev = m.vti;
    const target = s.vt / 1000;
    // Effective compliance of the previous breath. Once ΔP has been withdrawn to (nearly) nothing the
    // delivered volume is the patient's effort, not the pressure's effect, and Vti/ΔP diverges; the test
    // breath's compliance takes over, so a regulator parked at a floor of 0 can still step back up.
    const cEff = this.regulatedDp > k('PRVC_DP_EPSILON') && vtiPrev > 0.02 ? vtiPrev / this.regulatedDp : this.prvcCompliance;
    if (Number.isFinite(cEff) && cEff > 0) {
      const step = clamp((k('PRVC_GAIN') * (target - vtiPrev)) / cEff, -k('PRVC_STEP_MAX'), k('PRVC_STEP_MAX'));
      this.regulatedDp = clamp(this.regulatedDp + step, s.prvcMinDp, this.prvcCeiling(s));
    }
    const atCeiling = this.regulatedDp >= this.prvcCeiling(s) - 1e-9;
    const short = vtiPrev < k('PRVC_LIMIT_VT_FRACTION') * target;
    this.prvcShortCount = atCeiling && short ? this.prvcShortCount + 1 : 0;
    this.setAlarm('prvc-limit', this.prvcShortCount >= 2, t, events);
  }

  /**
   * End of the PRVC test breath: compliance from the measured plateau (Paw at the end of the pause, or the
   * end-inspiratory pressure when the breath was cut short) and the measured inspired volume, L/cmH2O.
   */
  private prvcSeedFromTestBreath(m: VentMeasured): void {
    if (!this.prvcTestPending) return;
    const s = this.settings;
    const cEst = m.vti / Math.max(0.5, m.paw - s.peep);
    this.prvcCompliance = cEst;
    this.regulatedDp = clamp(s.vt / 1000 / Math.max(1e-3, cEst), s.prvcMinDp, this.prvcCeiling(s));
    this.prvcTestPending = false;
  }

  /** Entering PRVC or changing the volume target invalidates the estimate: the next breath is a test breath. */
  private prvcResetIfRetargeted(prev: VentSettings): void {
    const s = this.settings;
    if (s.mode !== 'PRVC' || (prev.mode === 'PRVC' && prev.vt === s.vt)) return;
    this.regulatedDp = null;
    this.prvcShortCount = 0;
    this.prvcCompliance = NaN;
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

  /** PRVC: the regulated pressure above PEEP, null before the test breath has run. */
  get prvcDp(): number | null {
    return this.regulatedDp;
  }

  /** Last measured total PEEP from an expiratory hold, if any. */
  get peepTotalMeasured(): number | null {
    return this.lastPeepTotal;
  }
}
