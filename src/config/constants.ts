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

  // ───────────────────────── Recruitable-population lung (Spec §4.3, Brief 2 §2.2 model B) ─────────────────────────
  RECRUIT_UNITS: c(40, 'units per compartment', 'Brief 2 §2.2: N = 20–50 units stacked vertically', 'L'),
  RECRUIT_TOP_SD: c(4, 'cmH2O', 'Spread of opening pressures for non-ARDS phenotypes (Pelosi 2001: recruitment continues along the whole P–V curve) [M]', 'M'),
  RECRUIT_CLOSE_DELTA: c(4, 'cmH2O', 'Brief 2 §2.2 gives closing 5–10 cmH2O below opening [M]; 4 on the recoil axis (≈ 6–8 on the airway axis through a stiff chest wall) is the largest hysteresis for which units opened by a PEEP-15 plateau still close at PEEP 5, the window the R/I single-breath method measures (D-014)', 'M'),
  RECRUIT_K_OPEN: c(5.0, '1/(cmH2O·s)', 'Bates–Irvin trajectory rate: a unit 1 cmH2O above its opening pressure opens in 0.2 s, so units passed during a 1 s inflation open within the breath (tidal recruitment); a unit within 0.2 cmH2O of its TOP still needs seconds (slow recruitment during holds) [M]', 'M'),
  RECRUIT_K_CLOSE: c(5.0, '1/(cmH2O·s)', 'Derecruitment trajectory rate, same order as opening [M]', 'M'),
  RECRUIT_STRAIN_CAP: c(0.72, 'unit strain', 'Open units stiffen once their inflation exceeds 0.72× their aerated FRC (unit strain is now inflation over the open units\' own FRC, D-014; upper inflection well below TLC ≈ 2–2.5× FRC; Protti 2011 injury above strain 1.5–2) [M]; keeps the Gattinoni 1998 extrapulmonary Ers fall at PEEP 15 with 6 mL/kg and makes PEEP 20 clearly worse than the best-compliance PEEP in a decremental trial', 'M'),
  RECRUIT_OD_GAIN: c(2.5, 'per unit strain', 'Elastance multiplier slope above the strain cap [M]; with the caps here it gives Gattinoni 1998 pulmonary ARDS Ers 26 → ≈ 35 at PEEP 15 with Vt 6 mL/kg (measured 31.2) and a ≈ 13 % compliance loss at PEEP 20 in extrapulmonary ARDS', 'M'),
  RECRUIT_PULMONARY_STRAIN_CAP: c(1.38, 'unit strain', 'Strain cap for the aerated units of consolidated (pulmonary) ARDS, whose baby lung (FRC 0.7 L) reaches unit strain ≈ 1.43 at PEEP 15 with 6 mL/kg; set so Ers rises 26 → ≈ 35 (Gattinoni 1998: 25.4 → 31.2) rather than doubling [M]', 'M'),
  RECRUIT_EXTRAPULMONARY_FRACTION: c(0.25, 'fraction', 'Recruitable share of units in extrapulmonary ARDS [M]; with the TOP band below it recruits ≈ 0.22 L from PEEP 0 to 15 (Gattinoni 1998: 0.293 L) and Ers falls 25 → ≈ 23', 'M'),
  RECRUIT_EXTRAPULMONARY_TOP: c(9.5, 'cmH2O', 'Opening-pressure mode on the recoil axis for extrapulmonary ARDS: airway TOP ≈ 20–25 (Pelosi 2001) minus the raised pleural pressure of a stiff chest wall; placed so a PEEP-15 plateau (recoil ≈ 10–12) opens most of the band and PEEP 5 (recoil ≈ 2) closes it (D-014) [M]', 'M'),
  RECRUIT_EXTRAPULMONARY_TOP_SD: c(1.5, 'cmH2O', 'Spread of the extrapulmonary opening band on the recoil axis (≈ ±3–4 cmH2O on the airway axis after the chest wall, plus the ±2 cmH2O within-compartment pleural gradient) [M]; a wider band leaves most units outside the 15 → 5 release window (D-014)', 'M'),
  RECRUIT_PULMONARY_FRACTION: c(0.3, 'fraction', 'Recruitable share of units in pulmonary (consolidated) ARDS [M]; nearly none opens at protective plateau pressures (Gattinoni 1998: −0.03 L recruited)', 'M'),
  RECRUIT_PULMONARY_TOP: c(34, 'cmH2O', 'Opening-pressure mode on the recoil axis for consolidated units: above the plateau of protective ventilation (PEEP 15, 6 mL/kg → recoil ≈ 27–29) so no tidal recruitment at protective settings, below the recoil at a 50 cmH2O plateau so an injurious setting makes them cycle (stress index < 0.9) [M]', 'M'),
  RECRUIT_PULMONARY_TOP_SD: c(3, 'cmH2O', 'Spread of consolidated opening pressures [M]', 'M'),
  RECRUIT_DEFAULT_FRACTION: c(0.1, 'fraction', 'Recruitable share for non-ARDS phenotypes (basal atelectasis in anaesthetized normals) [M]', 'M'),
  RECRUIT_DEFAULT_TOP: c(5, 'cmH2O', 'Opening-pressure mode for basal atelectasis in non-ARDS lungs [M]', 'M'),

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

  // ───────────────────────── CO2 → drive loop (Spec §4.4, Brief 1 §1.5) ─────────────────────────
  // ───────────────── Schematic SpO2 (Spec §4.6 stretch goal; display only, not physics) ─────────────────
  SPO2_PB: c(760, 'mmHg', 'Alveolar gas equation: barometric pressure at sea level', 'V'),
  SPO2_PH2O: c(47, 'mmHg', 'Alveolar gas equation: saturated water vapour pressure at 37 °C', 'V'),
  SPO2_RQ: c(0.8, 'ratio', 'Alveolar gas equation: respiratory quotient', 'L'),
  SPO2_HB: c(12, 'g/dL', 'Typical ICU haemoglobin; O2 content = 1.34·Hb·SaO2 + 0.003·PaO2', 'L'),
  SPO2_AV_DIFF: c(5, 'mL/dL', 'Arteriovenous O2 content difference (Fick, VO2 250 mL/min at CO 5 L/min)', 'L'),
  SPO2_SHUNT_BASE: c(0.05, 'fraction', 'Physiological venous admixture of a normal lung ≈ 2–5 % [M, upper end]', 'M'),
  SPO2_SHUNT_PER_CLOSED: c(0.5, 'fraction per closed fraction', 'Share of a closed (non-aerated) unit that still perfuses after hypoxic vasoconstriction [M]', 'M'),
  SPO2_MPAW_HALF: c(20, 'cmH2O', 'Mean airway pressure that halves the base shunt (schematic recruitment of unmodelled atelectasis) [M]', 'M'),
  SPO2_SHUNT_MAX: c(0.6, 'fraction', 'Clamp on the effective shunt [M]', 'M'),
  CO2_BTPS_FACTOR: c(0.863, 'mmHg·L/mL', 'Brief 1 §1.5: PaCO2_ss = 0.863·VCO2/VA (VCO2 mL/min STPD, VA L/min BTPS)', 'V'),
  CO2_VCO2_DEFAULT: c(200, 'mL/min', 'Brief 1 §1.5: VCO2 ≈ 200–250 mL/min', 'L'),
  CO2_DEAD_SPACE_ML_PER_KG: c(2.2, 'mL/kg PBW', 'Brief 1 §1.5: anatomic dead space 2.2 mL/kg PBW', 'L'),
  CO2_APPARATUS_DEAD_SPACE: c(75, 'mL', 'Brief 1 §1.5: apparatus dead space (HME/ETT) ≈ 50–100 mL', 'L'),
  CO2_TAU: c(180, 's', 'Brief 1 §1.5: lumped body CO2 store time constant 2–5 min [uncertain]', 'M'),
  CO2_CHEMO_DELAY: c(10, 's', 'Brief 1 §1.5: chemoreceptor transport delay 7–15 s [uncertain]', 'M'),
  CO2_SET_POINT: c(40, 'mmHg', 'Brief 1 §1.5: drive D = D0 + G·(PaCO2 − 40)', 'L'),
  CO2_APNEIC_OFFSET: c(4, 'mmHg', 'Brief 1 §1.5: apneic threshold ≈ 3–5 mmHg below the eupneic PaCO2', 'L'),
  CO2_GAIN_PMAX: c(0.06, '1/mmHg', 'Pmax scale per mmHg of delayed PaCO2 above the set point [M]: an 8 mmHg rise raises the effort by half. With the rate gain below, a Pmax of 8 and Ers 25 this is a ventilatory response of ≈ 0.5 L/min/mmHg, the low end of Brief 1 §1.5\'s 1–3; a larger gain makes the warped loop oscillate because the breath-by-breath ventilatory response cannot be warped (D-014)', 'M'),
  CO2_GAIN_RATE: c(0.03, '1/mmHg', 'Neural rate scale per mmHg of delayed PaCO2 above the set point [M]; rate responds less than tidal effort (Brief 1 §1.5)', 'M'),
  CO2_DRIVE_MAX: c(3, 'ratio', 'Brief 1 §1.5: D clamped to Dmax; 3× the baseline Pmax (Pmax ≤ 40 in NeuralDrive) [M]', 'M'),
  CO2_RATE_SCALE_MIN: c(0.5, 'ratio', 'Lowest neural-rate scale below the set point before apnea [M]', 'M'),
  CO2_RATE_SCALE_MAX: c(2.0, 'ratio', 'Highest neural-rate scale (rate itself is clamped to 60/min in NeuralDrive) [M]', 'M'),
  CO2_PACO2_INIT: c(40, 'mmHg', 'Initial PaCO2 (eupneic) [M]', 'M'),
  CO2_WARP_MAX: c(60, '×', 'Spec §4.4: time-warp control ×10–×60 on the CO2 dynamics only', 'V'),
  CO2_DELAY_SAMPLE: c(0.05, 's (warped)', 'Sampling interval of the chemoreceptor delay line on the warped CO2 clock [M]', 'M'),

  // ───────────────────────── Esophageal balloon ─────────────────────────
  PES_OFFSET_SUPINE: c(3, 'cmH2O', 'Brief 2 §1.3: supine mediastinal offset +2 to +5 (Washko 2006), default +3', 'V'),
  PES_Z_DEFAULT: c(0.7, 'fraction of lung height', 'Brief 2 §1.3: balloon samples mid-to-dependent lung (Yoshida 2018); 0.7 of the vertical height [M within that range]', 'V'),
  PES_Z_HIGH: c(0.3, 'fraction of lung height', 'Balloon positioned too high (upper esophagus) [M]', 'M'),
  BALLOON_BEST_FILL: c(3.5, 'mL', 'Brief 2 §1.3 Mojoli 2016: best filling volume 3.5 ± 1.9 mL', 'V'),
  BALLOON_HIGH_POSITION_FACTOR: c(0.6, 'fraction', 'Swing attenuation of a high-positioned balloon [M]', 'M'),
  ESO_WALL_ELASTANCE: c(1.1, 'cmH2O/mL', 'Brief 2 §1.3 Mojoli 2016: esophageal wall elastance 1.1 ± 0.5', 'V'),
  ESO_WALL_FREE_VOLUME: c(1.6, 'mL', 'Fill below which no wall pressure develops; gives Pew ≈ 2.0 at 3.5 mL and 2.6 at 4 mL (Mojoli: 2.0, 3.0)', 'M'),
  PES_CARDIAC_PP: c(1.5, 'cmH2O', 'Brief 2 §1.3: cardiac artifact on Pes ≈ 1–3 cmH2O peak-to-peak; mid-range [M]', 'M'),
  PES_CARDIAC_WIDTH: c(0.3, 'fraction of the cardiac cycle', 'Duration of the systolic bump on Pes: a raised-cosine pulse over ~30 % of the beat (about a systolic ejection at 80/min), baseline for the rest [M]', 'M'),
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
  SIMV_SYNC_WINDOW: c(0.25, 'fraction of the SIMV period', 'Brief 1 §2.5: mandatory breaths synchronize to a patient trigger "inside a window before each scheduled breath"; window length vendor-specific (Dräger 5 s, PB-840 start-of-period); the last quarter of the period chosen [M]', 'M'),
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

  // ───────────────────────── PEEP maneuvers: R/I and the decremental trial (Spec §5, Brief 2 §2.4) ─────────────────────────
  RI_PEEP_LOW: c(5, 'cmH2O', 'Brief 2 §2.4 Chen 2020: one-breath release from PEEP 15 (the set PEEP here) to 5', 'V'),
  RI_MIN_RELEASE: c(2, 'cmH2O', 'Smallest PEEP release for which R/I is reported (below this ΔVrelease is within the Vte noise) [M]', 'M'),
  RI_BASELINE_BREATHS: c(3, 'breaths', 'Vte reference for ΔVrelease = mean expired volume of the breaths before the release [M]', 'M'),
  RI_LOW_BREATHS: c(4, 'breaths', 'Breaths kept at the low PEEP before the inspiratory hold that gives Pplat,low and Crs,low, so the lung has settled at the new PEEP [M]', 'M'),
  PEEP_TRIAL_START: c(20, 'cmH2O', 'Decremental trial starts at the higher of the set PEEP and 20 (after a recruitment step) [M; Spec §5]', 'M'),
  PEEP_TRIAL_END: c(4, 'cmH2O', 'Lowest PEEP of the decremental trial [M]', 'M'),
  PEEP_TRIAL_STEP: c(2, 'cmH2O', 'Decremental trial step size [M; common bedside practice]', 'M'),
  PEEP_TRIAL_BREATHS: c(6, 'breaths per step', 'Breaths at each PEEP before the inspiratory hold that closes the step (derecruitment settles within a few breaths at kClose 5) [M]', 'M'),
  PEEP_TRIAL_HOLD_RETRIES: c(3, 'breaths', 'An alarm-cycled breath skips its hold; after this many breaths without a hold the step (or the R/I) is recorded as invalid and the maneuver moves on rather than stalling [M]', 'M'),

  // ───────────────────────── Injectors (Brief 1 §3.2, §3.11, §3.12) ─────────────────────────
  LEAK_K_DEFAULT: c(0.03, 'L/s/√cmH2O', 'Brief 1 §1.4 orifice leak Q = k·√Paw; k = 0.03 gives ≈ 8 L/min at 20 cmH2O, a 15–25% cuff leak [M]', 'M'),
  CARDIAC_PPL_AMP_DEFAULT: c(0.6, 'cmH2O', 'Brief 1 §3.2: cardiac pleural oscillation A = 0.2–1 cmH2O; Imanaka flow fluctuation 2–5 L/min', 'L'),
  SECRETIONS_R_MODULATION: c(0.6, 'fraction (RMS)', 'Brief 1 §3.12: random band-limited modulation of R producing a sawtooth on expiratory flow [uncertain]', 'M'),
  SECRETIONS_BAND_LO: c(5, 'Hz', 'Brief 1 §3.12: sawtooth band 5–20 Hz [uncertain]', 'M'),
  SECRETIONS_BAND_HI: c(20, 'Hz', 'Brief 1 §3.12: sawtooth band 5–20 Hz [uncertain]', 'M'),
  WATER_R_MODULATION: c(0.4, 'fraction', 'Brief 1 §3.12: water in the circuit gives a more regular oscillation than secretions [M]', 'M'),
  WATER_OSC_FREQ: c(4, 'Hz', 'Regular oscillation frequency of water sloshing in the tubing [M]', 'M'),
  COUGH_INTERVAL_DEFAULT: c(8, 's', 'Mean interval between coughs in the cough injector [M]', 'M'),
  COUGH_PMUS_AMP: c(40, 'cmH2O', 'Brief 1 §3.12: brief large expiratory Pmus; 40 cmH2O spikes Paw past a 40 cmH2O alarm limit [M]', 'M'),
  COUGH_DURATION: c(0.4, 's', 'Duration of one cough burst [M]', 'M'),
  COUGH_INSP_DELAY: c(0.25, 's', 'Coughs in intubated patients are provoked by inflation; an armed cough fires this long after inspiration starts [M]', 'M'),
  PNEUMOTHORAX_ESCALE: c(1.8, '×', 'Brief 1 §3.12: pneumothorax → abrupt compliance fall; lung elastance ×1.8 [M]', 'M'),
  PNEUMOTHORAX_PPL: c(6, 'cmH2O', 'Pleural pressure offset from intrapleural air [M]', 'M'),
  MAINSTEM_ESCALE: c(2, '×', 'Brief 1 §3.12: mainstem intubation roughly halves compliance', 'L'),
  MAINSTEM_RSCALE: c(1.5, '×', 'Single-lung airway resistance rises (parallel path lost) [M]', 'M'),
  BRONCHOSPASM_RSCALE: c(3, '×', 'Brief 1 §3.12: high resistance, Ppeak − Pplat > 10 at 60 L/min [heuristic]', 'M'),
  BRONCHOSPASM_RAMP: c(20, 's', 'Ramp of the bronchospasm onset [M]', 'M'),

  // ───────────────────────── Ground-truth labeler (Spec §7, Brief 1 §3) ─────────────────────────
  LABEL_TRIGGER_DELAY: c(0.25, 's', 'Brief 1 §3 van Diepen / Mojoli: trigger delay > 250 ms is delayed triggering', 'V'),
  LABEL_EARLY_CYCLING: c(-0.1, 's', 'Brief 1 §3 van Diepen: cycling delay < −100 ms is early (premature) cycling', 'V'),
  LABEL_LATE_CYCLING: c(0.3, 's', 'Brief 1 §3 van Diepen: cycling delay > 300 ms is late (delayed) cycling', 'V'),
  LABEL_EFFORT_LEAD: c(0.05, 's', 'A trigger this long before the recorded neural onset still counts as caused by the effort (parabolic onset is gradual) [M]', 'M'),
  LABEL_EFFORT_TAIL: c(0.4, 's', 'Relaxation window after neural Ti during which a trigger is still attributed to the same effort (τ_relax 0.2 s → 2τ) [M]', 'M'),
  LABEL_RT_MAX_DELAY: c(1.0, 's', 'Brief 1 §3.5: entrained onset delay d = 0.2–0.8 s after the machine breath start; onsets beyond 1 s are not reverse triggers [M]', 'M'),
  LABEL_RT_PHASE_TOL: c(0.15, 'fraction', 'Brief 1 §3.5 Akoumianaki: reverse-triggered breaths have CV < 5%; a delay within 15% of the running median counts as phase-locked [M]', 'M'),
  LABEL_FLOW_STARVATION_PTP: c(1.0, 'cmH2O·s', 'Spec §7: Pmus active during VC inspiration above a threshold pressure–time product [M]', 'M'),
  LABEL_FLOW_STARVATION_PMUS: c(3, 'cmH2O', 'Minimum peak Pmus during VC inspiration for flow starvation (below this the ramp stays convex) [M]', 'M'),
  LABEL_FLOW_STARVATION_RISE: c(0.5, 'cmH2O', 'Pmus must still rise by this much after the insufflation starts: demand ahead of delivered flow. A breath triggered so late that Pmus is already relaxing is a delayed trigger, not flow starvation (D-012) [M]', 'M'),
  LABEL_OVERSHOOT_MARGIN: c(3, 'cmH2O', 'Spec §7 / Brief 1 §3.9: Paw > target + 3 in the first 200 ms', 'L'),
  LABEL_OVERSHOOT_WINDOW: c(0.2, 's', 'Brief 1 §3.9: overshoot judged in the first 100–200 ms', 'L'),
  LABEL_AUTO_PEEP: c(1.0, 'cmH2O', 'Spec §7: true end-expiratory Palv > PEEP + 1', 'L'),
  LABEL_LEAK_FRACTION: c(0.10, 'fraction', 'Spec §7 / Brief 1 §3.11: leak volume > 10% of Vti', 'L'),
  LABEL_COUGH_PMUS: c(10, 'cmH2O', 'Expiratory Pmus more negative than −10 during a breath marks a cough (injector bursts are 40) [M]', 'M'),
  LABEL_HIGH_R: c(25, 'cmH2O/(L/s)', 'Truth high resistance: preset total R × injector scale ≥ 25 (bronchospasm, asthma) [M, matches DET_HIGH_R]', 'M'),
  LABEL_E_SCALE: c(1.3, '×', 'Lung elastance ≥ 1.3× the scenario baseline (≈ 30% Crs drop: mainstem, pneumothorax) counts as a compliance fall [M]', 'M'),
  LABEL_LOW_C: c(30, 'mL/cmH2O', 'Truth low compliance: static Crs < 30 mL/cmH2O (fibrosis preset) [M, matches DET_LOW_C]', 'M'),
  LABEL_PENDELLUFT_VOL: c(0.01, 'L', 'Brief 2 §4: pendelluft volume ≥ 10 mL swapped between compartments within a breath [M]', 'M'),
  LABEL_TIDAL_RECRUIT_UNITS: c(1, 'units', 'Spec §7 truth-only finding: at least one recruitable unit opened during the breath and closed again by its end (Brief 2 §2.2 model B) [M]', 'M'),
  AI_SEVERE: c(10, '%', 'Brief 1 §3 Thille 2006: AI > 10% is severe', 'V'),
  IE_CLUSTER_COUNT: c(30, 'events', 'Brief 1 §3 Vaporidi 2017: > 30 ineffective efforts in 3 min', 'V'),
  IE_CLUSTER_WINDOW: c(180, 's', 'Brief 1 §3 Vaporidi 2017: 3-minute window', 'V'),

  // ───────────────────────── Detector (signal-only rules; Spec §7, Brief 1 §3) ─────────────────────────
  DET_IE_FDEF: c(5.45, 'L/min', 'Brief 1 §3.1 Chen 2008: expiratory flow deflection ≥ 5.45 L/min (sens 91.5%, spec 96.2%)', 'V'),
  DET_IE_PDEF: c(0.45, 'cmH2O', 'Brief 1 §3.1 Chen 2008: Paw deflection ≥ 0.45 cmH2O (sens 93.3%, spec 92.9%). Not used as a criterion: with an active exhalation valve (R 1.5) a 7 L/min deflection moves Paw ≈ 0.2 cmH2O (D-012)', 'V'),
  DET_IE_MIN_DURATION: c(0.15, 's', 'A flow deflection must last ≥ 150 ms to be an effort; secretion sawtooth (5–20 Hz) is shorter [M]', 'M'),
  DET_NOTCH_ONSET: c(2.0, 'L/min', 'Expiratory flow deviation above the extrapolated passive decay that opens a candidate notch (≈ 7× sensor noise RMS on the 0.1 s-smoothed flow) [M]', 'M'),
  DET_NOTCH_REANCHOR: c(0.5, 's', 'While no deflection is under way the passive-decay prediction is re-anchored on the measured flow every 0.5 s (an effort reaches the onset threshold within its rise, ≈ ½·Ti) [M]', 'M'),
  DET_CARDIAC_NOTCH_FACTOR: c(3.0, 'L/min per L/min', 'When a regular heart-rate oscillation is present, an effort notch must exceed the pattern threshold plus 3× the smoothed oscillation amplitude (raw peak-to-peak ≈ 3.3× the smoothed RMS·√2 amplitude) [M]', 'M'),
  DET_FS_CONVEXITY: c(0.7, 'cmH2O', 'Brief 1 §3.8: scooped (convex) VC Paw ramp; mid-ramp deviation of the least-squares parabola from its chord over 20–100% of Ti. Passive ramps give −0.2…+0.2 (Venegas curvature included), a rising Pmus of 3–8 cmH2O during the breath gives ≥ 0.9 [M]', 'M'),
  DET_FS_END_STEEPENING: c(2.0, 'ratio', 'Brief 1 §3.8: flow starvation scoops the VC Paw ramp; when Pmus relaxes before cycle-off the last 15% of the ramp is ≥ 2× steeper than the 20–85% chord (a passive ramp is linear, ≤ 1.3 with Venegas stiffening) [M]', 'M'),
  DET_IE_EXP_BLANK: c(0.35, 's', 'Deflections starting within this time after cycle-off belong to the breath\'s own effort (premature cycling), later ones are new efforts [M]', 'M'),
  DET_PREM_PAW_DIP: c(0.5, 'cmH2O', 'Brief 1 §3.6: Paw dips below PEEP just after cycling when the effort continues [M]', 'M'),
  DET_PREM_NOTCH: c(10.0, 'L/min', 'Brief 1 §3.6: early-expiratory flow notch or reversal (flow returns toward zero by this much); above the cardiac flow oscillation (≤ 5–7 L/min, Imanaka 2000) [M]', 'M'),
  DET_PREM_WINDOW: c(0.35, 's', 'Window after cycle-off in which the notch marks premature cycling [M]', 'M'),
  DET_AT_PAW_DIP: c(0.5, 'cmH2O', 'Brief 1 §3.2: auto-trigger = triggered breath with no Paw dip ≥ 0.5 cmH2O before the trigger (read on a 0.1 s moving average, D-012)', 'L'),
  DET_AT_CARDIAC_CORR: c(0.5, 'ratio', 'Auto-trigger (cardiac): autocorrelation of the pre-trigger flow residual ≥ 0.5 at a heart-rate lag (0.4–1.25 s) and ≥ 0.25 at twice that lag marks a periodic oscillation rather than a single effort deflection [M]', 'M'),
  DET_AT_DEMAND_SAG: c(0.8, 'cmH2O', 'Early-inspiratory Paw sag below the servo target that indicates true demand after a pressure-targeted trigger [M]', 'M'),
  DET_AT_PRE_WINDOW: c(0.4, 's', 'Pre-trigger window for the Paw dip and flow inflection [M]', 'M'),
  DET_DELAYED_TRIGGER: c(0.25, 's', 'Brief 1 §3.3 Mojoli: dip onset to trigger > 250 ms', 'V'),
  DET_DIP_ONSET: c(0.3, 'cmH2O', 'Paw below the expiratory baseline by 2× sensor noise RMS marks the dip onset [M]', 'M'),
  DET_DT_TE_FRACTION: c(0.5, 'fraction', 'Brief 1 §3.4 Thille 2006: double trigger = Te shorter than half the mean Ti, first breath triggered', 'V'),
  DET_DT_VTE_RATIO: c(0.7, 'fraction', 'Brief 1 §3.4: the first breath\'s Vte is much smaller than its Vti (stacking) [M]', 'M'),
  DET_DT_TE_MAX: c(0.6, 's', 'Absolute expiratory-time limit for stacking when the machine Ti is very short (refractory 0.2 s makes Te < ½·Ti impossible below Ti 0.4 s) [M]', 'M'),
  DET_RT_EXP_WINDOW: c(0.6, 's', 'Brief 1 §3.5: early-expiratory blunting/reversal after a machine breath marks the entrained effort [M]', 'M'),
  DET_RT_PAW_DIP: c(0.6, 'cmH2O', 'Brief 1 §3.5: mid/late-inspiratory Paw dip in VC of a time-triggered breath [M]', 'M'),
  DET_RT_FLOW_HUMP: c(3.0, 'L/min', 'Brief 1 §3.5: mid/late-inspiratory flow hump in PC [M]', 'M'),
  DET_RT_EXP_BLUNT: c(0.7, 'fraction', 'Brief 1 §3.5: early-expiratory flow blunted below this fraction of the running median peak expiratory flow [M]', 'M'),
  DET_FS_CONCAVITY: c(1.0, 'cmH2O', 'Brief 1 §3.8: scooped Paw ramp; mid-ramp Paw below the chord by ≥ 1 cmH2O [heuristic]', 'M'),
  DET_DC_PAW_RISE: c(1.0, 'cmH2O', 'Brief 1 §3.7: end-inspiratory Paw rise above target in the last third (heuristic 2 cmH2O on raw traces); read on a 0.1 s moving average, where a Pmax 5 relaxation against a closed inspiratory valve gives 1.3–2.6 and passive breaths ≤ 0.5 (D-012)', 'M'),
  DET_DC_SHOULDER_TAIL: c(0.3, 's', 'Time from a flow "shoulder" (abrupt steepening of the decay as the effort starts to relax, i.e. the neural end) to cycle-off; equals the truth margin LABEL_LATE_CYCLING (was 0.4, D-012) [M]', 'M'),
  DET_DC_KNEE_TAU: c(0.45, 's', 'Local time constant of the inspiratory flow decay after the knee must reach the passive range (≥ 0.45 s; the relaxation phase gives 0.2–0.4 s in any lung, the passive tail ≈ 0.5 s in a normal lung and 0.9–1.6 s in COPD); the knee ratio carries the discrimination, this gate rejects noise-driven τ jumps at low flow [M]', 'M'),
  DET_DC_VC_CONCAVITY: c(0.5, 'cmH2O', 'VC, patient-triggered breath with a delayed trigger: a concave-down Paw ramp (least-squares parabola ≤ −0.5 cmH2O below its chord) means Pmus was relaxing during the insufflation, so the breath came late and outlasted the effort (delayed cycling). Passive ARDS ramps stay within ±0.2; tidal recruitment in a triggering patient is a known confounder (LIMITATIONS) [M]', 'M'),
  DET_DC_KNEE_RATIO: c(1.5, 'ratio', 'Local τ of the inspiratory flow decay over the 0.2 s after the knee ≥ 1.5× the 0.2 s before it (the relaxing effort accelerates the decay; a passive exponential keeps τ constant); the COPD knee is gradual, τ 0.45 → 0.7 → 1.3 s over 0.3 s [M]', 'M'),
  DET_DC_KNEE_TAIL: c(0.1, 's', 'Time from the knee of the inspiratory flow decay (local τ ≥ 1.5×: relaxation complete, ≈ 2·τ_relax = 0.4 s after the neural end) to cycle-off; any knee clear of the cycle-off transient means the ventilator cycled ≥ 0.3 s after the neural end (LABEL_LATE_CYCLING) [M]', 'M'),
  DET_HIGH_R_EEF: c(5, 'L/min', 'The inspiratory resistive step is trusted for the resistance estimate when the end-expiratory flow before the breath is above −5 L/min (a 5 L/min residual flow across R 30 adds ≈ 2.5 cmH2O, ≤ 4 cmH2O/(L/s) of apparent R at 0.6 L/s) [M]', 'M'),
  DET_DC_TI_RATIO: c(2.0, 'ratio', 'Brief 1 §3.7 Thille: prolonged cycle = Ti > 2× mean Ti', 'L'),
  DET_OVERSHOOT_MARGIN: c(3.0, 'cmH2O', 'Brief 1 §3.9: Paw in the first 200 ms > target + 2–3 [heuristic]', 'L'),
  DET_AUTOPEEP_FLOW: c(3.0, 'L/min', 'Brief 1 §3.10: end-expiratory flow magnitude > 2–5 L/min at the trigger point [heuristic]', 'L'),
  DET_LEAK_RATIO: c(0.85, 'fraction', 'Spec §7: Vte/Vti < 0.85–0.9 [heuristic]; summed over 8 breaths so stacked pairs cancel', 'L'),
  DET_SECRETIONS_HP_RMS: c(2.2, 'L/min', 'Second-difference RMS of expiratory flow at the device rate (5–20 Hz energy proxy); band-limited sensor noise alone gives ≈ 0.55 [M, tuned]', 'M'),
  DET_HIGH_R: c(25, 'cmH2O/(L/s)', 'Brief 1 §3.12: Ppeak − Pplat > 10 at 60 L/min [heuristic]; measured from the inspiratory resistive step in VC, 25 keeps the COPD preset (22) below and bronchospasm (≥ 30) above [M]', 'M'),
  DET_LOW_C: c(30, 'mL/cmH2O', 'Compliance below 30 mL/cmH2O or a > 30% step drop from the breath\'s own baseline [heuristic]', 'M'),
  DET_LOW_C_DROP: c(0.7, 'fraction', 'Step drop of least-squares compliance to < 70% of the running baseline (pneumothorax onset) [M]', 'M'),
  DET_COUGH_SPIKE: c(15, 'cmH2O', 'Alarm-cycled breath whose Paw exceeds the running Ppeak by this much is a cough [M]', 'M'),
  DET_RETURN_RATIO: c(0.55, 'ratio', 'Expiratory flow back near zero in less than 55% of the time the breath\'s own fitted τ predicts (τ·ln(Qpeak/1 L/min)): the patient is pulling (premature cycling, reverse trigger) [M]', 'M'),
  DET_RETURN_MAX: c(1.0, 's', 'Early return counts only when expiratory flow is back near zero within 1 s of cycle-off; slower returns (COPD, non-exponential decay) are not effort signatures [M]', 'M'),
  DET_RETURN_MARGIN: c(0.3, 's', 'The early return must happen at least this long before the next trigger, otherwise it is the next breath\'s own inflection [M]', 'M'),
  DET_AT_FLOW_RISE: c(12, 'L/min', 'Auto-trigger (cardiac): the pre-trigger flow inflection is cardiac-sized (Imanaka 2000: 4.7 ± 1.3 L/min fluctuation), well below an effort ramp (≥ 15) [M]', 'M'),
  DET_AT_FAST_LEAD: c(0.3, 's', 'Auto-trigger (cardiac): the inflection is faster than a quarter cardiac cycle plus sensor lag; slow weak efforts take longer [M]', 'M'),
  DET_AT_LEAK_FLOW: c(0.5, 'L/min', 'Auto-trigger (leak): net flow before the trigger already above zero, i.e. the lung outflow has fallen below the leak; with a leak evident from ΣVte/ΣVti (DET_LEAK_RATIO) the flow crosses the trigger threshold during its own decay, so the criterion is the absence of an effort ramp (DET_AT_FLOW_RISE) rather than a settled baseline [M]', 'M'),
  DET_RT_PHASE_TOL: c(0.15, 'fraction', 'Brief 1 §3.5 Akoumianaki: reverse-triggered efforts are phase-locked (CV < 5%); candidates within 15% of the running median delay count [M]', 'M'),
  DET_DC_TAU_TI: c(1.05, 's', 'PSV: τ·ln(1/ETS) above this predicts cycling well after the neural Ti in obstructive lungs (Tassaux 2005 raised ETS to 70% to fix it) [M]', 'M'),
  DET_FS_PTP: c(1.0, 'cmH2O·s', 'VC: Paw pressure–time deficit below the passive prediction (τe from the expiratory decay, R from the resistive step) over inspiration; matches the truth PTP rule (Brief 1 §3.8 "Pmus-time product estimate") [M]', 'M'),
  DET_AT_CARDIAC_OSC: c(1.0, 'L/min', 'Auto-trigger (cardiac): regular heart-rate-band flow oscillation before the trigger, measured on a detrended and 0.15 s-smoothed residual (≈ 40% of the raw amplitude; Imanaka 2000: 4.7 ± 1.3 L/min raw in auto-triggering patients) [L/M]', 'M'),
  DET_COUGH_SLOPE: c(150, 'cmH2O/s', 'Cough: Paw spike rising faster than any ventilator ramp (VC ramps ≈ E·Q ≤ 60 cmH2O/s) [M]', 'M'),
  DET_IE_HUMP: c(5, 'L/min', 'Inspiratory ineffective effort: flow hump on a decaying pressure-targeted inspiration ≥ 5 L/min [M, Brief 1 §3.1]', 'M'),
  DET_DT_RT_TE: c(1.0, 's', 'A patient trigger within this time after a reverse-triggered machine breath is the stacked breath of that entrained effort [M]', 'M'),

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
  STRESS_INDEX_T0: c(0.15, 's', 'Brief 2 §2.3: fit the stress index from 0.1–0.2 s after flow onset (after the resistive step) to end-inspiration [L/M]', 'M'),
  STRESS_INDEX_FLOW_CV: c(0.1, 'fraction', 'Constant-flow eligibility: coefficient of variation of measured inspiratory flow over the fit window below 10 % (square flow with sensor noise ≈ 2 %) [M]', 'M'),
  STRESS_INDEX_MIN_WINDOW: c(0.3, 's', 'Minimum fit window for a stress index (≥ 30 samples at 100 Hz) [M]', 'M'),
  STRESS_INDEX_LOW: c(0.9, 'ratio', 'Brief 2 §2.3/§6 Grasso 2004: b < 0.9 tidal recruitment', 'V'),
  STRESS_INDEX_HIGH: c(1.1, 'ratio', 'Brief 2 §2.3/§6 Grasso 2004: b > 1.1 overdistension', 'V'),
  RI_THRESHOLD: c(0.5, 'ratio', 'Brief 2 §2.4/§6 Chen 2020: R/I ≥ 0.5 high recruitability', 'V'),
  VT_PBW_LOW: c(4, 'mL/kg', 'Spec §8 quiz success: Vt 4–8 mL/kg PBW (ARDSNet 2000)', 'V'),
  VT_PBW_HIGH: c(8, 'mL/kg', 'Spec §8 quiz success: Vt 4–8 mL/kg PBW (ARDSNet 2000)', 'V'),
  SPECIFIC_ELASTANCE_REF: c(13.5, 'cmH2O', 'Brief 2 §3/§6 Chiumello 2008: specific lung elastance ≈ 13.5 across groups', 'V'),

  // ───────────────────────── Quiz (Spec §8) ─────────────────────────
  QUIZ_PATTERN_MIN_FRACTION: c(0.1, 'fraction', 'A pattern counts as present in a quiz window when ≥ 10 % of the breaths (efforts for ineffective effort) carry it [M]; a single labelled breath in a minute is not a teaching target', 'M'),
  QUIZ_FIX_WINDOW: c(60, 's', 'Spec §8: success = AI < 10 % over 60 s of simulated time with every safety limit met', 'V'),
  QUIZ_TIME_FREE: c(60, 's', 'Time-to-fix below which the time score is full [M]', 'M'),
  QUIZ_TIME_SPAN: c(1800, 's', 'Time over which the time score decays linearly from 1 to its floor [M]', 'M'),
  QUIZ_CHANGES_FREE: c(3, 'setting changes', 'Number of setting changes with a full changes score [M]', 'M'),
  QUIZ_CHANGES_PENALTY: c(0.05, 'per extra change', 'Score lost per setting change beyond the free ones [M]', 'M'),
  QUIZ_FACTOR_FLOOR: c(0.5, 'fraction', 'Floor of the time and changes factors [M]', 'M'),
  QUIZ_FIX_BAND: c(0.25, 'fraction of the recommended step', 'Debrief (D-019): a learner value within 25 % of the recommended step of the recommended value counts as "matched"; the same direction but further away is "partial" [M]', 'M'),

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
