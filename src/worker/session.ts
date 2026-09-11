/**
 * SimSession: the worker's pure core. One SimEngine advanced by simulated seconds, producing
 * channel-major sample batches, events and breath records. No timers, no postMessage, no DOM, so it
 * runs identically in Vitest and in the worker; determinism follows from the fixed-step engine and
 * from applying commands only between physics steps.
 */
import { SimEngine } from '../sim/engine';
import { TRUTH_CHANNELS } from '../sim/channels';
import type { BreathRecord, ManeuverKind, VentEvent } from '../sim/types';
import type { VentSettings } from '../sim/vent/settings';
import type { BalloonParams } from '../sim/patient/balloon';
import type { DriveParams, NeuralBreath } from '../sim/patient/neural-drive';
import type { InjectorKind, InjectorParamMap } from '../sim/injectors';
import { BATCH_CHANNELS, type PatientSummary, type ScenarioSpec, type SessionStatus } from './protocol';
import { totalResistance } from '../sim/truth/labeler';

export interface SessionOutput {
  n: number;
  t0: number;
  t1: number;
  samples: Float32Array;
  events: VentEvent[];
  breaths: BreathRecord[];
  /** Neural breaths that started since the previous output. */
  neural: NeuralBreath[];
}

const N_CH = BATCH_CHANNELS.length;
const N_MEASURED = 5;

export class SimSession {
  readonly engine: SimEngine;
  readonly fs: number;
  private acc = 0;
  private buf: Float32Array;
  private cap: number;
  private n = 0;
  private events: VentEvent[] = [];
  private breaths: BreathRecord[] = [];
  private neuralSent = 0;

  constructor(scenario: ScenarioSpec) {
    this.engine = new SimEngine(scenario);
    this.fs = this.engine.vent.current.deviceRate;
    this.cap = Math.max(16, Math.ceil(this.fs * 0.5));
    this.buf = new Float32Array(this.cap * N_CH);
    this.engine.onSample = (s) => {
      if (this.n >= this.cap) this.grow();
      const i = this.n;
      const n = this.cap;
      this.buf[i] = s.t;
      this.buf[n + i] = s.paw;
      this.buf[2 * n + i] = s.flow;
      this.buf[3 * n + i] = s.vol;
      this.buf[4 * n + i] = s.pes;
      for (let c = 0; c < TRUTH_CHANNELS.length; c++) {
        const key = TRUTH_CHANNELS[c];
        if (key) this.buf[(N_MEASURED + c) * n + i] = s.truth[key];
      }
      this.n += 1;
    };
    this.engine.onEvent = (e) => this.events.push(e);
    this.engine.onBreath = (b) => this.breaths.push({ ...b });
  }

  private grow(): void {
    const newCap = this.cap * 2;
    const nb = new Float32Array(newCap * N_CH);
    for (let c = 0; c < N_CH; c++) nb.set(this.buf.subarray(c * this.cap, c * this.cap + this.n), c * newCap);
    this.buf = nb;
    this.cap = newCap;
  }

  get t(): number {
    return this.engine.t;
  }

  /** Advance by simulated seconds and return everything produced. Fractional steps carry over. */
  advance(seconds: number): SessionOutput {
    const dt = this.engine.dt;
    this.acc += seconds;
    const steps = Math.floor(this.acc / dt + 1e-9);
    this.acc -= steps * dt;
    if (this.acc < 1e-12) this.acc = 0;
    const t0 = this.engine.t;
    for (let i = 0; i < steps; i++) this.engine.step();
    const n = this.n;
    const samples = new Float32Array(n * N_CH);
    for (let c = 0; c < N_CH; c++) samples.set(this.buf.subarray(c * this.cap, c * this.cap + n), c * n);
    const out: SessionOutput = {
      n,
      t0,
      t1: this.engine.t,
      samples,
      events: this.events,
      breaths: this.breaths,
      neural: this.engine.neuralBreaths.slice(this.neuralSent),
    };
    this.neuralSent = this.engine.neuralBreaths.length;
    this.n = 0;
    this.events = [];
    this.breaths = [];
    return out;
  }

  applySettings(partial: Partial<VentSettings>): void {
    this.engine.vent.applySettings(partial);
  }

  requestManeuver(kind: ManeuverKind): void {
    switch (kind) {
      case 'insp':
      case 'exp':
        this.engine.vent.requestHold(kind);
        break;
      case 'p01':
      case 'pocc':
      case 'occlusion-test':
        this.engine.vent.requestOcclusion(kind);
        break;
      case 'ri':
      case 'peep-trial':
        this.engine.vent.requestPeepManeuver(kind);
        break;
    }
  }

  inject<K extends InjectorKind>(kind: K, params: Partial<InjectorParamMap[K]> | null): void {
    this.engine.injectors.set(kind, params);
  }

  setDriveParams(partial: Partial<DriveParams>): void {
    this.engine.setDriveParams(partial);
  }

  setTimeWarp(warp: number): void {
    this.engine.setTimeWarp(warp);
  }

  setBalloon(balloon: BalloonParams): void {
    this.engine.balloon = balloon.enabled ? balloon : null;
    this.engine.vent.applySettings({ esophagealBalloon: balloon.enabled });
  }

  neuralBreaths(): NeuralBreath[] {
    return this.engine.neuralBreaths;
  }

  status(): SessionStatus {
    const vent = this.engine.vent;
    const inj = this.engine.injectors.log[this.engine.injectors.log.length - 1];
    return {
      t: this.engine.t,
      injectors: this.engine.injectors.activeKinds(),
      rScale: inj?.rScale ?? 1,
      eScale: inj?.eScale ?? 1,
      phase: vent.phase,
      alarms: vent.activeAlarms(),
      inBackup: vent.inBackup,
      settings: vent.current,
      pending: vent.pendingKeys(),
      breathCount: vent.breathCount,
      peepManeuver: vent.peepManeuverActive,
      co2: this.engine.co2Now(),
    };
  }

  patientSummary(): PatientSummary {
    const m = this.engine.patient.params.mechanics;
    return { frc: m.frc, pbw: m.pbw, el: m.el, ecw: m.ecw, rTotal: totalResistance(m), hasDrive: this.engine.neural !== null };
  }
}
