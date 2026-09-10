/**
 * SimEngine: fixed-step loop coupling the patient and the ventilator only through physics.
 * Runs headless in Node (tests, batch export) and in the Web Worker (live UI).
 */
import { k } from '../config/constants';
import { createRng, type Rng } from './math/prng';
import { PatientModel, type PatientDrive } from './patient/patient';
import type { PatientParams } from './patient/params';
import { Ventilator } from './vent/ventilator';
import { SensorChain } from './vent/sensor-chain';
import { clampSettings, type VentSettings } from './vent/settings';
import { PHASE_CODE, TRUTH_CHANNELS, type TruthChannel } from './channels';
import type { BreathRecord, Phase, TriggerCause, VentEvent } from './types';

export interface EngineOptions {
  patient: PatientParams;
  settings: VentSettings;
  seed: number | string;
}

export interface DeviceSample {
  t: number;
  paw: number;
  flow: number;
  vol: number;
  pes: number;
  truth: Record<TruthChannel, number>;
}

export class SimEngine {
  readonly dt = k('PHYSICS_DT');
  readonly rng: Rng;
  readonly patient: PatientModel;
  readonly vent: Ventilator;
  readonly sensors: SensorChain;
  t = 0;
  private stepIndex = 0;
  private readonly stepsPerSample: number;
  readonly breaths: BreathRecord[] = [];
  readonly events: VentEvent[] = [];
  private lastMeasured = { paw: 0, flow: 0, vol: 0, pes: 0 };
  private drive: PatientDrive = PatientModel.passiveDrive();
  private vtiTrueAcc = 0;
  private vteTrueAcc = 0;
  /** Listeners for device-rate samples and breath completion. */
  onSample: ((s: DeviceSample) => void) | null = null;
  onBreath: ((b: BreathRecord) => void) | null = null;
  onEvent: ((e: VentEvent) => void) | null = null;

  constructor(opts: EngineOptions) {
    this.rng = createRng(opts.seed);
    const settings = clampSettings(opts.settings);
    this.patient = new PatientModel(opts.patient);
    this.patient.initAtStatic(settings.peep);
    this.vent = new Ventilator(settings);
    this.sensors = new SensorChain({
      dt: this.dt,
      deviceRate: settings.deviceRate,
      ideal: settings.ideal,
      rng: this.rng.fork('sensors'),
    });
    this.sensors.prime(settings.peep, 0);
    this.stepsPerSample = Math.round(1 / settings.deviceRate / this.dt);
    this.vent.onInspStart = (t, cause) => this.startBreath(t, cause);
  }

  /** Replace the drive inputs (Pmus, cardiac, leak, injector terms) for subsequent steps. */
  setDrive(drive: Partial<PatientDrive>): void {
    this.drive = { ...this.drive, ...drive };
  }

  private startBreath(t: number, cause: TriggerCause): void {
    const prev = this.breaths[this.breaths.length - 1];
    if (prev && prev.tEnd === null) this.closeBreath(prev, t);
    this.sensors.resetVolume();
    this.vtiTrueAcc = 0;
    this.vteTrueAcc = 0;
    this.breaths.push({
      index: this.breaths.length,
      tStart: t,
      triggerCause: cause,
      tInspEnd: NaN,
      tPauseEnd: NaN,
      cycleCause: 'time',
      tEnd: null,
      vtiTrue: 0,
      vteTrue: 0,
      vtiMeasured: 0,
      vteMeasured: 0,
      peakFlowMeasured: 0,
      ppeakMeasured: 0,
    });
  }

  private closeBreath(b: BreathRecord, t: number): void {
    b.tEnd = t;
    b.vteTrue = this.vteTrueAcc;
    b.vteMeasured = this.sensors.vte;
    if (Number.isNaN(b.tPauseEnd)) b.tPauseEnd = b.tInspEnd;
    this.onBreath?.(b);
  }

  private static isInsp(phase: Phase): boolean {
    return phase === 'insp' || phase === 'pause';
  }

  /** Advance one physics step. */
  step(): void {
    const t = this.t;
    const phase = this.vent.phase;
    const inInsp = SimEngine.isInsp(phase);
    const bc = this.vent.actuate(t, this.dt, this.patient.out.paw);
    const out = this.patient.step(this.dt, bc, this.drive);
    const pesTrue = out.ppl[1]; // placeholder until the balloon model (M4): dependent-region Ppl
    this.sensors.push(out.paw, out.qv, pesTrue, inInsp);

    // True volume accounting by ventilator phase
    if (inInsp) this.vtiTrueAcc += Math.max(0, out.q) * this.dt;
    else this.vteTrueAcc += Math.max(0, -out.q) * this.dt;

    this.stepIndex += 1;
    this.t = this.stepIndex * this.dt;

    if (this.stepIndex % this.stepsPerSample === 0) {
      const m = this.sensors.sample();
      this.lastMeasured = m;
      const tDev = this.t;
      // Emit the sample for the phase the physics just ran in, before the controller acts on it.
      if (this.onSample) this.onSample(this.makeSample(tDev, m, pesTrue, phase));
      const events = this.vent.control({ t: tDev, paw: m.paw, flow: m.flow, vol: m.vol, pes: null });
      for (const e of events) {
        this.events.push(e);
        this.onEvent?.(e);
        const b = this.breaths[this.breaths.length - 1];
        if (b && b.tEnd === null) {
          if (e.type === 'cycle') {
            b.tInspEnd = e.t;
            b.cycleCause = e.cause;
            b.vtiTrue = this.vtiTrueAcc;
            b.vtiMeasured = this.sensors.vti;
            b.peakFlowMeasured = this.sensors.peakInspFlow;
            b.ppeakMeasured = this.sensors.peakPaw;
            if (this.vent.phase !== 'pause') b.tPauseEnd = e.t;
          } else if (e.type === 'pause-end') {
            b.tPauseEnd = e.t;
          }
        }
      }
    }
  }

  private makeSample(
    tDev: number,
    m: { paw: number; flow: number; vol: number; pes: number },
    pesTrue: number,
    phase: Phase,
  ): DeviceSample {
    const o = this.patient.out;
    const frc = this.patient.params.mechanics.frc;
    const w0 = (this.patient.comp[0].frc + o.v[0]) / (frc + o.vtot);
    const truth: Record<TruthChannel, number> = {
      paw: o.paw,
      flow: o.q,
      qv: o.qv,
      vlung: o.vtot,
      pmus: o.pmusEff,
      pmusIso: this.drive.pmusIso,
      palv: w0 * o.palv[0] + (1 - w0) * o.palv[1],
      palvND: o.palv[0],
      palvD: o.palv[1],
      pplND: o.ppl[0],
      pplD: o.ppl[1],
      plND: o.pl[0],
      plD: o.pl[1],
      pesTrue,
      qND: o.qComp[0],
      qD: o.qComp[1],
      pcwRec: o.pcwRec,
      phase: PHASE_CODE[phase],
    };
    return { t: tDev, paw: m.paw, flow: m.flow, vol: m.vol, pes: m.pes, truth };
  }

  /** Run for a duration of simulated seconds. */
  run(seconds: number): void {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) this.step();
  }

  get measured(): { paw: number; flow: number; vol: number; pes: number } {
    return this.lastMeasured;
  }

  static truthChannelNames(): readonly TruthChannel[] {
    return TRUTH_CHANNELS;
  }
}
