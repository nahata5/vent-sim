/**
 * Cited constants registry.
 *
 * Every physiologic, ventilator and detector constant lives here with a value, a unit, a source
 * (DOI or brief section) and a confidence tag carried over from the research briefs:
 *   V = verified against a primary source, L = literature but not re-verified, M = modeling assumption.
 *
 * Brief 1 = docs/research/01-dyssynchrony-vent-logic-realism.md
 * Brief 2 = docs/research/02-pressure-partitioning-lung-stress.md
 * Spec    = docs/superpowers/specs/2026-09-10-vent-sim-design.md
 */

export type Confidence = 'V' | 'L' | 'M';

export interface Constant<T = number> {
  readonly value: T;
  readonly unit: string;
  readonly source: string;
  readonly confidence: Confidence;
  readonly note?: string;
}

function c<T>(value: T, unit: string, source: string, confidence: Confidence, note?: string): Constant<T> {
  return note === undefined ? { value, unit, source, confidence } : { value, unit, source, confidence, note };
}

export const CONSTANTS = {
  // ───────────────────────── Simulation clock ─────────────────────────
  PHYSICS_DT: c(0.001, 's', 'Spec §4.1; Brief 1 §0 (fixed 1 kHz step)', 'V'),
  DEVICE_RATE_DEFAULT: c(100, 'Hz', 'Brief 1 §4 (ventMAP generic 100 Hz; PB840 50 Hz; Dräger V500 200 Hz)', 'V'),
  DEVICE_RATES: c([50, 100, 200], 'Hz', 'Brief 1 §4', 'V'),

  // ───────────────────────── Unit conversions ─────────────────────────
  J_PER_CMH2O_L: c(0.098, 'J/(cmH2O·L)', 'Brief 2 §3 mechanical power formulas', 'V'),

  // ───────────────────────── Endotracheal tube (Rohrer) ─────────────────────────
  ETT_K1: c(3.0, 'cmH2O/(L/s)', 'Brief 1 §1.1: 7.5–8 mm ETT adds ~4–8 cmH2O/L/s at 1 L/s [uncertain]; split into K1+K2', 'M'),
  ETT_K2: c(3.0, 'cmH2O/(L/s)²', 'Brief 1 §1.1: with K1, gives 6 cmH2O/L/s at 1 L/s, 4.5 at 0.5 L/s', 'M'),

  // ───────────────────────── Sensor chain ─────────────────────────
  SENSOR_LPF_TAU: c(0.015, 's', 'Brief 1 §4: first-order low-pass τ ≈ 10–30 ms [uncertain]', 'M'),
  SENSOR_DELAY: c(0.02, 's', 'Brief 1 §4: 10–30 ms transport delay [uncertain]', 'M'),
  SENSOR_NOISE_BANDWIDTH: c(15, 'Hz', 'Brief 1 §4 (van Diepen): low-pass white noise, 15 Hz bandwidth', 'V'),
  SENSOR_PAW_NOISE_RMS: c(0.15, 'cmH2O', 'Brief 1 §4: pressure SNR ≈ 15 dB against a ~1 cmH2O-RMS reference swing; chosen so Chen Pdef 0.45 stays resolvable', 'M'),
  SENSOR_FLOW_NOISE_RMS: c(0.005, 'L/s', 'Brief 1 §4: flow SNR ≈ 30 dB (0.3 L/min RMS)', 'M'),
  SENSOR_PAW_QUANTUM: c(0.1, 'cmH2O', 'Brief 1 §4: quantization 0.1 cmH2O', 'L'),
  SENSOR_FLOW_QUANTUM: c(0.1 / 60, 'L/s', 'Brief 1 §4: quantization 0.1 L/min', 'L'),

  // ───────────────────────── Ventilator logic ─────────────────────────
  TRIGGER_REFRACTORY: c(0.2, 's', 'Spec §5; Brief 1 §2.1: 150–300 ms [uncertain, vendor-specific]', 'M'),
  ACTUATOR_LATENCY: c(0.03, 's', 'Brief 1 §2.1: actuator latency ≈ 20–50 ms [uncertain]', 'M'),
  SERVO_TAU: c(0.03, 's', 'Spec §5; Brief 1 §1.1: pressure servo effective lag 20–50 ms [uncertain]', 'M'),
  SERVO_SOURCE_R: c(4.0, 'cmH2O/(L/s)', 'Spec §5 "small source resistance"; sized so a 6 L/min demand dips Paw ≈ 0.4 cmH2O before the servo recovers', 'M'),
  EXH_VALVE_R: c(1.5, 'cmH2O/(L/s)', 'Spec §5 exhalation valve resistance; typical active-valve drop ≈ 1–2 cmH2O at 1 L/s', 'M'),
  BIAS_FLOW_DEFAULT: c(3 / 60, 'L/s', 'Brief 1 §2.1: bias flow 2–10 L/min [vendor-specific]', 'M'),
  FLOW_TRIGGER_DEFAULT: c(2 / 60, 'L/s', 'Brief 1 §2.1: flow trigger typically 1–5 L/min, default ≈ 2–3', 'L'),
  PRESSURE_TRIGGER_DEFAULT: c(1.0, 'cmH2O', 'Brief 1 §2.1: pressure trigger 0.5–2 cmH2O', 'L'),
  ETS_DEFAULT: c(0.25, 'fraction of peak flow', 'Brief 1 §2.4: common default 25%', 'L'),
  TI_MAX_DEFAULT: c(2.0, 's', 'Brief 1 §2.4: Ti_max ≈ 1.5–3 s adult [uncertain]', 'M'),
  PRESSURE_CYCLE_MARGIN: c(3.0, 'cmH2O', 'Spec §5: cycle if Paw > target + 3 [vendor-specific]', 'M'),
  APNEA_TIME_DEFAULT: c(20, 's', 'Brief 1 §2.6: apnea alarm default 20 s', 'L'),
  RISE_TIME_DEFAULT: c(0.15, 's', 'Brief 1 §2.3: rise time ≈ 0.05–0.4 s', 'L'),
  HIGH_PPEAK_ALARM_DEFAULT: c(40, 'cmH2O', 'Brief 1 §2.6: Ppeak + 10, max 50', 'L'),

  // ───────────────────────── Clinical guardrails ─────────────────────────
  PBW_MALE_INTERCEPT: c(50, 'kg', 'Brief 1 §5 ARDSNet 2000: male PBW = 50 + 0.91·(height − 152.4)', 'L'),
  PBW_FEMALE_INTERCEPT: c(45.5, 'kg', 'Brief 1 §5 ARDSNet 2000: female PBW = 45.5 + 0.91·(height − 152.4)', 'L'),
  PBW_SLOPE: c(0.91, 'kg/cm', 'Brief 1 §5 ARDSNet 2000', 'L'),
  PBW_HEIGHT_REF: c(152.4, 'cm', 'Brief 1 §5 ARDSNet 2000', 'L'),
} as const satisfies Record<string, Constant<number> | Constant<readonly number[]>>;

export type ConstantKey = keyof typeof CONSTANTS;

/** Flat list for tests, the Validation page and MODEL.md generation. */
export function listConstants(): Array<Constant<number | readonly number[]> & { key: ConstantKey }> {
  return (Object.keys(CONSTANTS) as ConstantKey[]).map((key) => ({ key, ...CONSTANTS[key] }));
}

/** Shorthand for the numeric value of a constant. */
export function k(key: ConstantKey): number {
  const v = CONSTANTS[key].value;
  if (typeof v !== 'number') throw new Error(`constant ${key} is not scalar`);
  return v;
}
