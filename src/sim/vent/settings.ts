/**
 * Ventilator settings (Spec §5). User-facing units: mL, L/min, cmH2O, s.
 */
import { k } from '../../config/constants';
import type { Mode } from '../types';
import { clamp } from '../math/filters';

export type TriggerType = 'flow' | 'pressure';
export type FlowPattern = 'square' | 'ramp';
export type VcTiming = 'peakFlow' | 'ti';

export interface AlarmLimits {
  highPpeak: number; // cmH2O
  lowVte: number; // mL
  highVe: number; // L/min
  lowVe: number; // L/min
  highRR: number; // /min
  lowPeep: number; // cmH2O below set PEEP counts as disconnect
  highLeak: number; // %
  highPeepi: number; // cmH2O
}

export interface VentSettings {
  mode: Mode;
  peep: number;
  fio2: number;
  triggerType: TriggerType;
  flowTrigger: number; // L/min
  pressureTrigger: number; // cmH2O
  biasFlow: number; // L/min
  // VC
  vt: number; // mL
  rr: number; // /min
  vcTiming: VcTiming;
  peakFlow: number; // L/min
  flowPattern: FlowPattern;
  rampEndFraction: number; // ramp decelerates to this fraction of peak (0 = to zero)
  pause: number; // s
  // PC
  pinsp: number; // cmH2O above PEEP
  ti: number; // s (PC; VC when vcTiming = 'ti')
  riseTime: number; // s
  // PSV / CPAP
  ps: number; // cmH2O above PEEP
  ets: number; // fraction of peak flow
  tiMax: number; // s
  // Apnea backup
  apneaTime: number; // s
  backupRR: number;
  backupPinsp: number;
  // Alarms
  alarms: AlarmLimits;
  // Advanced / realism
  refractory: number; // s
  actuatorLatency: number; // s
  servoTau: number; // s
  leakCompensation: boolean;
  deviceRate: number; // Hz
  /** Ideal ventilator for analytic tests: no servo lag, no source/valve resistance, no sensor chain effects. */
  ideal: boolean;
  /** Esophageal balloon channel enabled. */
  esophagealBalloon: boolean;
}

export function defaultSettings(mode: Mode = 'VC-AC'): VentSettings {
  return {
    mode,
    peep: 5,
    fio2: 0.4,
    triggerType: 'flow',
    flowTrigger: k('FLOW_TRIGGER_DEFAULT') * 60,
    pressureTrigger: k('PRESSURE_TRIGGER_DEFAULT'),
    biasFlow: k('BIAS_FLOW_DEFAULT') * 60,
    vt: 450,
    rr: 16,
    vcTiming: 'peakFlow',
    peakFlow: 50,
    flowPattern: 'square',
    rampEndFraction: 0,
    pause: 0,
    pinsp: 15,
    ti: 1.0,
    riseTime: k('RISE_TIME_DEFAULT'),
    ps: 10,
    ets: k('ETS_DEFAULT'),
    tiMax: k('TI_MAX_DEFAULT'),
    apneaTime: k('APNEA_TIME_DEFAULT'),
    backupRR: 12,
    backupPinsp: 15,
    alarms: {
      highPpeak: k('HIGH_PPEAK_ALARM_DEFAULT'),
      lowVte: 250,
      highVe: 20,
      lowVe: 3,
      highRR: 35,
      lowPeep: 3,
      highLeak: 20,
      highPeepi: 5,
    },
    refractory: k('TRIGGER_REFRACTORY'),
    actuatorLatency: k('ACTUATOR_LATENCY'),
    servoTau: k('SERVO_TAU'),
    leakCompensation: false,
    deviceRate: k('DEVICE_RATE_DEFAULT'),
    ideal: false,
    esophagealBalloon: false,
  };
}

/** Clamp settings to the model bounds of Brief 1 §5 and sane device ranges. */
export function clampSettings(s: VentSettings): VentSettings {
  return {
    ...s,
    peep: clamp(s.peep, 0, 25),
    fio2: clamp(s.fio2, 0.21, 1),
    flowTrigger: clamp(s.flowTrigger, 0.5, 10),
    pressureTrigger: clamp(s.pressureTrigger, 0.5, 5),
    biasFlow: clamp(s.biasFlow, 2, 10),
    vt: clamp(s.vt, 100, 1200),
    rr: clamp(s.rr, 4, 60),
    peakFlow: clamp(s.peakFlow, 10, 120),
    rampEndFraction: clamp(s.rampEndFraction, 0, 0.9),
    pause: clamp(s.pause, 0, 2),
    pinsp: clamp(s.pinsp, 0, 40),
    ti: clamp(s.ti, 0.2, 3),
    riseTime: clamp(s.riseTime, 0, 0.4),
    ps: clamp(s.ps, 0, 40),
    ets: clamp(s.ets, 0.05, 0.8),
    tiMax: clamp(s.tiMax, 0.5, 4),
    apneaTime: clamp(s.apneaTime, 5, 60),
    refractory: clamp(s.refractory, 0, 0.5),
    deviceRate: [50, 100, 200].includes(s.deviceRate) ? s.deviceRate : 100,
  };
}

/** Inspiratory time and peak flow implied by VC settings (Brief 1 §2.2). */
export function vcTiming(s: VentSettings): { ti: number; qPeak: number } {
  const vtL = s.vt / 1000;
  const f = s.flowPattern === 'ramp' ? s.rampEndFraction : 1;
  if (s.vcTiming === 'ti') {
    // Vt = ∫Q = Qpeak·Ti·(1+f)/2 for a ramp, Qpeak·Ti for square.
    const qPeak = s.flowPattern === 'ramp' ? (2 * vtL) / (s.ti * (1 + f)) : vtL / s.ti;
    return { ti: s.ti, qPeak };
  }
  const qPeak = s.peakFlow / 60;
  const ti = s.flowPattern === 'ramp' ? (2 * vtL) / (qPeak * (1 + f)) : vtL / qPeak;
  return { ti, qPeak };
}
