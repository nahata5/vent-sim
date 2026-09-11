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

  R_CENTRAL_DEFAULT: c(1.0, 'cmH2O/(L/s)', 'Brief 2 §1.1: Pelosi 1996 lung-only Rmin,L 1.0 (normal); shared central airway term', 'V'),
  R_REFERENCE_FLOW: c(0.5, 'L/s', 'Brief 1 §1.4: Arnal resistances measured at typical VC flows (~30 L/min); used to split total R into tube + peripheral', 'M'),

  // ───────────────────────── Lung tissue / chest wall ─────────────────────────
  VISCOELASTIC_TAU: c(0.7, 's', 'Brief 1 §1.2 / Brief 2 §5: P1→P2 decay over 0.5–2 s [τ uncertain]', 'M'),
  PLEURAL_GRADIENT_NORMAL: c(0.25, 'cmH2O/cm', 'Brief 2 §1.3: ~0.25 cmH2O/cm (0.2–0.5 by posture), Agostoni/D\'Angelo', 'V'),
  PLEURAL_GRADIENT_ARDS: c(0.5, 'cmH2O/cm', 'Brief 2 §1.3: steeper in ARDS (tissue weight doubles, Pelosi 1994); 0.4–0.7 suggested', 'M'),
  LUNG_HEIGHT_SUPINE: c(17, 'cm', 'Brief 2 §1.3: supine anterior–posterior height 15–20 cm', 'L'),
  ALPHA_ND_INJURED: c(0.65, 'fraction', 'Brief 2 §4: αND ≈ 0.7, αD ≈ 1.4 in injured lungs (Yoshida 2013), weighted mean = 1', 'M'),
  ALPHA_D_INJURED: c(1.35, 'fraction', 'Brief 2 §4: αD ≈ 1.4 in injured lungs (Yoshida 2013), weighted mean = 1', 'M'),

  // ───────────────────────── Neural drive / Pmus ─────────────────────────
  PMUS_KFV: c(0.3, 'fraction', 'Spec §4.4: k_fv ≈ 0.25–0.3 [M], calibrated so the *measured* ΔPocc → Pmus ratio on the PSV grid gives Bertoni 2019 k1 = −0.74 (the measured ΔPocc slightly under-reads Pmus_iso because Paw is still equilibrating after the occlusion)', 'M'),
  PMUS_QREF: c(0.15, 'L/s', 'Flow above which the force–velocity penalty is fully applied [M]; low so that any flowing breath is penalized and an occluded (isometric) one is not, reproducing Bertoni k1 across the Pmax range', 'M'),
  PMUS_RELAX_TAU: c(0.2, 's', 'Brief 1 §1.3: relaxation exponential τ ≈ 0.1–0.3 s [uncertain]', 'M'),
  PMUS_HOLD_FRAC: c(0.05, 'fraction of Ti', 'Brief 1 §1.3 ASL 5000 Hold % 0–5% [uncertain]', 'M'),
  DRIVE_CV_DEFAULT: c(0.12, 'fraction', 'Brief 1 §4: AR(1) CV ≈ 10–25% on Pmax, Ti, rate [uncertain]', 'M'),
  DRIVE_AR1_PHI: c(0.7, 'dimensionless', 'AR(1) autocorrelation of breath-to-breath variability [M]', 'M'),
  DRIVE_CLUSTER_PHI: c(0.97, 'dimensionless', 'Slow AR(1) for clusters of low-drive breaths (Vaporidi 2017 IE clusters) [M]', 'M'),
  DRIVE_CLUSTER_CV: c(0.35, 'fraction', 'Amplitude of slow drive modulation producing IE clusters [M]', 'M'),
  SIGH_FACTOR: c(2, 'multiple of Pmax', 'Brief 1 §4: sighs ≈ 2× effort every 5–10 min [uncertain]', 'M'),
  ENTRAIN_DELAY_DEFAULT: c(0.4, 's', 'Brief 1 §3.5: reverse-trigger phase delay ≈ 0.39 s (phase angle ~60°) [uncertain generalizability]', 'L'),
  ENTRAIN_JITTER_DEFAULT: c(0.03, 'fraction', 'Brief 1 §3.5 Akoumianaki 2013: CV of reverse-triggered breath frequency < 5%', 'V'),

  // ───────────────────────── Esophageal balloon ─────────────────────────
  PES_OFFSET_SUPINE: c(3, 'cmH2O', 'Brief 2 §1.3: supine mediastinal offset +2 to +5 (Washko 2006), default +3', 'V'),
  PES_Z_DEFAULT: c(0.7, 'fraction of lung height', 'Brief 2 §1.3: balloon samples mid-to-dependent lung (Yoshida 2018); 0.7 of the vertical height [M within that range]', 'V'),
  PES_Z_HIGH: c(0.3, 'fraction of lung height', 'Balloon positioned too high (upper esophagus) [M]', 'M'),
  BALLOON_BEST_FILL: c(3.5, 'mL', 'Brief 2 §1.3 Mojoli 2016: best filling volume 3.5 ± 1.9 mL', 'V'),
  BALLOON_HIGH_POSITION_FACTOR: c(0.6, 'fraction', 'Swing attenuation of a high-positioned balloon [M]', 'M'),
  ESO_WALL_ELASTANCE: c(1.1, 'cmH2O/mL', 'Brief 2 §1.3 Mojoli 2016: esophageal wall elastance 1.1 ± 0.5', 'V'),
  ESO_WALL_FREE_VOLUME: c(1.6, 'mL', 'Fill below which no wall pressure develops; gives Pew ≈ 2.0 at 3.5 mL and 2.6 at 4 mL (Mojoli: 2.0, 3.0)', 'M'),
  PES_CARDIAC_AMP: c(1.5, 'cmH2O', 'Brief 2 §1.3: cardiac artifact on Pes ≈ 1–3 cmH2O [M]', 'M'),
  HEART_RATE_DEFAULT: c(80, '/min', 'Typical ICU heart rate; cardiac artifact band 0.8–4 Hz (Brief 2 §1.3)', 'L'),
  IAP_DEFAULT: c(8, 'cmH2O', 'Brief 2 Table 1: normal IAP 8.5 ± 3 (Gattinoni 1998)', 'V'),
  PGA_BETA: c(0.4, 'fraction', 'Brief 2 §1.2: Pga = IAP + β·Pmus, β ≈ 0.3–0.5 [M]', 'M'),
  PGA_GAMMA: c(0.3, 'fraction', 'Brief 2 §1.2: γ·Ecw·V term, γ ≈ 0.3 [M]', 'M'),

  // ───────────────────────── Occlusion maneuvers ─────────────────────────
  P01_ONSET_THRESHOLD: c(0.5, 'cmH2O', 'Detection of the Paw deflection onset during an occlusion, above sensor noise (0.15 RMS, 0.1 quantum) [M]; onset back-extrapolated from the slope', 'M'),
  P01_NOISE_BAND: c(0.25, 'cmH2O', 'Raw-sample band around the occlusion plateau treated as "not yet deflected" (≈ 1.7 × sensor noise RMS) [M]', 'M'),
  P01_WINDOW: c(0.1, 's', 'Brief 2 §4/§5: P0.1 = Paw drop over the first 100 ms of the occluded effort', 'V'),
  OCCLUSION_TIMEOUT: c(4, 's', 'Maximum single-breath occlusion before release [M]', 'M'),
  POCC_MIN_DIP: c(1.0, 'cmH2O', 'Minimum deflection to count an occluded effort [M]', 'M'),
  OCCLUSION_SMOOTHING: c(0.3, 's', 'Moving average applied to Paw/Pes when reading whole-effort occlusion swings; spans ~1/3 of a cardiac cycle band (0.8–4 Hz) as a clinician does by eye [M]', 'M'),
  OCCLUSION_SETTLED_FLOW: c(0.04, 'L/s', 'Expiratory flow below which an end-expiratory occlusion may start (≈3.6 L/min): late enough that the post-occlusion Paw rise toward Palv is small, early enough to precede the next effort in compliant lungs [M]', 'M'),
  OCCLUSION_BASELINE_WINDOW: c(0.1, 's', 'Quiet interval at the start of an occlusion averaged for the baseline [M]', 'M'),

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
  MAX_SERVO_FLOW: c(3.0, 'L/s', 'Peak deliverable flow of an ICU ventilator blower/valve ≈ 180 L/min [vendor-specific, M]; bounds the servo under leaks and disconnects', 'M'),
  EXH_VALVE_R: c(1.5, 'cmH2O/(L/s)', 'Spec §5 exhalation valve resistance; typical active-valve drop ≈ 1–2 cmH2O at 1 L/s', 'M'),
  BIAS_FLOW_DEFAULT: c(3 / 60, 'L/s', 'Brief 1 §2.1: bias flow 2–10 L/min [vendor-specific]', 'M'),
  FLOW_TRIGGER_DEFAULT: c(2 / 60, 'L/s', 'Brief 1 §2.1: flow trigger typically 1–5 L/min, default ≈ 2–3', 'L'),
  PRESSURE_TRIGGER_DEFAULT: c(1.0, 'cmH2O', 'Brief 1 §2.1: pressure trigger 0.5–2 cmH2O', 'L'),
  ETS_DEFAULT: c(0.25, 'fraction of peak flow', 'Brief 1 §2.4: common default 25%', 'L'),
  TI_MAX_DEFAULT: c(2.0, 's', 'Brief 1 §2.4: Ti_max ≈ 1.5–3 s adult [uncertain]', 'M'),
  PRESSURE_CYCLE_MARGIN: c(3.0, 'cmH2O', 'Spec §5: cycle if Paw > target + 3 [vendor-specific]', 'M'),
  PSV_CYCLE_MIN_TI: c(0.1, 's', 'Brief 1 §2.4: ETS is evaluated against the breath\'s own peak flow, so a short blanking interval is needed after pressurization starts [M]', 'M'),
  ETS_CONFIRM_TIME: c(0.03, 's', 'Flow-cycle criterion validated over a few device samples before cycling, so an abrupt expiratory push can pressure-cycle first [vendor-specific, M]', 'M'),
  PSV_CYCLE_MIN_PEAK_FLOW: c(0.05, 'L/s', 'ETS comparison is meaningless until inspiratory flow has developed (3 L/min) [M]', 'M'),
  DISCONNECT_SUSTAIN: c(0.5, 's', 'Brief 1 §2.6: low PEEP / disconnect when Paw < PEEP − 3 [uncertain]; sustained 0.5 s to avoid trigger dips [M]', 'M'),
  APNEA_TIME_DEFAULT: c(20, 's', 'Brief 1 §2.6: apnea alarm default 20 s', 'L'),
  RISE_TIME_DEFAULT: c(0.15, 's', 'Brief 1 §2.3: rise time ≈ 0.05–0.4 s', 'L'),
  HIGH_PPEAK_ALARM_DEFAULT: c(40, 'cmH2O', 'Brief 1 §2.6: Ppeak + 10, max 50', 'L'),
  INSP_HOLD_P1_DELAY: c(0.05, 's', 'Brief 2 §5: P1 read after the fast resistive drop (Paw → P1 "quickly"), before the slow P2 decay', 'M'),
  INSP_HOLD_MIN: c(0.3, 's', 'Brief 1 §2.7: Pplat at the end of a ≥ 0.3–0.5 s no-flow pause', 'L'),
  EXP_HOLD_DEFAULT: c(3.0, 's', 'Spec §5: expiratory hold 2–4 s', 'L'),

  // ───────────────────────── Lung-stress thresholds (Brief 2 §3, §6) ─────────────────────────
  DP_LIMIT: c(15, 'cmH2O', 'Brief 2 §3/§6 Amato 2015: ΔP ≤ 15; RR of death 1.41 per SD (~7) increase', 'V'),
  DPL_WARN: c(10, 'cmH2O', 'Brief 2 §3/§6: ΔPL < 10–12 consensus cutoff (Baedorf Kassis 2016 for the association)', 'L'),
  DPL_LIMIT: c(12, 'cmH2O', 'Brief 2 §6: ΔPL > 12 concerning', 'L'),
  DPL_DYN_LIMIT: c(15, 'cmH2O', 'Brief 2 §3 Goligher 2020: dynamic ΔPL (PL,peak − PL,ee) < 15 in assisted breathing', 'V'),
  PL_EI_WARN: c(20, 'cmH2O', 'Brief 2 §3/§6 EPVent / EPVent-2: end-inspiratory PL ceiling 20–25', 'L'),
  PL_EI_LIMIT: c(25, 'cmH2O', 'Brief 2 §6: end-inspiratory PL > 25 concerning', 'L'),
  PL_EE_MIN: c(0, 'cmH2O', 'Brief 2 §6 EPVent-2: end-expiratory PL 0 to +6; < 0 → collapse risk in the dependent lung', 'L'),
  PL_EE_MAX: c(6, 'cmH2O', 'Brief 2 §6 EPVent-2 upper target (EPVent used 0–10)', 'L'),
  STRAIN_LIMIT: c(1.5, 'ratio', 'Brief 2 §3/§6 Protti 2011: injury only above strain 1.5–2', 'V'),
  MP_LIMIT: c(17, 'J/min', 'Brief 2 §3/§6 Serpa Neto 2018: > 17 J/min associated with mortality', 'V'),
  PPLAT_LIMIT: c(30, 'cmH2O', 'Brief 2 §6 ARDSNet-era practice: Pplat ≤ 28–30', 'L'),
  P01_LOW: c(1, 'cmH2O', 'Brief 2 §4/§6: P0.1 ≤ 1 low drive', 'L'),
  P01_HIGH: c(3.5, 'cmH2O', 'Brief 2 §4/§6: P0.1 > 3.5–4 high drive (Telias 2020)', 'V'),
  PMUS_LOW: c(5, 'cmH2O', 'Brief 2 §6: Pmus 5–10 target', 'L'),
  PMUS_HIGH: c(10, 'cmH2O', 'Brief 2 §6: Pmus > 10–15 vigorous', 'L'),
  DPES_LOW: c(3, 'cmH2O', 'Brief 2 §6: ΔPes < 2–3 over-assisted', 'L'),
  DPES_HIGH: c(8, 'cmH2O', 'Brief 2 §6: ΔPes > 8–12 vigorous', 'L'),
  POCC_LIMIT: c(-15, 'cmH2O', 'Brief 2 §4/§6 Bertoni 2019: ΔPocc more negative than −15 to −20 → excessive effort', 'V'),
  PMI_LIMIT: c(6, 'cmH2O', 'Brief 2 §4/§6 Bellani 2016: PMI > 6 excessive effort', 'V'),
  PTP_LOW: c(50, 'cmH2O·s/min', 'Brief 2 §6: PTPes ≤ 50 low effort', 'L'),
  PTP_HIGH: c(200, 'cmH2O·s/min', 'Brief 2 §6: PTPes ≥ 200 high effort', 'L'),
  STRESS_INDEX_LOW: c(0.9, 'ratio', 'Brief 2 §2.3/§6 Grasso 2004: b < 0.9 tidal recruitment', 'V'),
  STRESS_INDEX_HIGH: c(1.1, 'ratio', 'Brief 2 §2.3/§6 Grasso 2004: b > 1.1 overdistension', 'V'),
  RI_THRESHOLD: c(0.5, 'ratio', 'Brief 2 §2.4/§6 Chen 2020: R/I ≥ 0.5 high recruitability', 'V'),
  VT_PBW_LOW: c(4, 'mL/kg', 'Spec §8 quiz success: Vt 4–8 mL/kg PBW (ARDSNet 2000)', 'V'),
  VT_PBW_HIGH: c(8, 'mL/kg', 'Spec §8 quiz success: Vt 4–8 mL/kg PBW (ARDSNet 2000)', 'V'),
  SPECIFIC_ELASTANCE_REF: c(13.5, 'cmH2O', 'Brief 2 §3/§6 Chiumello 2008: specific lung elastance ≈ 13.5 across groups', 'V'),

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
