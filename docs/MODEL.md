# VentSim model

Every equation the simulator solves, with symbols, units and sources. Internal units: cmH2O, L, L/s, s;
mL/min for CO2 production; mmHg for PaCO2. "Brief 1" and "Brief 2" are the research briefs in
`docs/research/`; "Spec" is the design spec; D-nnn are entries in `docs/DECISIONS.md`. Every numeric
constant lives in `src/config/constants.ts` with a citation; the table at the end is generated from it.

## 1. Simulation loop

The engine (`src/sim/engine.ts`) advances at a fixed step Δt = 1 ms (`PHYSICS_DT`). Each step: the neural
drive updates Pmus_iso(t); the CO2 loop (if present) advances and rescales the drive; the ventilator
produces the airway boundary condition from its state and the *true* pressure at the valve; the patient
model integrates one RK4 step; the sensor chain filters and samples; at every device sample (100 Hz by
default, `DEVICE_RATE_DEFAULT`) the ventilator's controller evaluates trigger, cycle, hold and alarm rules
on the *measured* signals only (D-002). The patient and the ventilator are coupled only through the airway
node.

## 2. Patient mechanics (Spec §4.2, Brief 2 §1–2)

Two compartments i ∈ {ND, D} (non-dependent, dependent), each with volume V_i above its share of FRC,
sharing one chest wall. With Ecw the chest-wall elastance, V = V_ND + V_D, Ppl0 the pleural pressure at
FRC and g_i = ±½·G·H the vertical pleural offset (gradient G cmH2O/cm over the lung height H):

```
Ppl_i  = Ppl0 + Ecw·V + g_i − α_i·Pmus_eff + Pcard + Ppl,inj_i        (pleural pressure, regional)
PL_i   = PL0_i + s_E·R_i(V_i) + Pve_i,   PL0_i = −(Ppl0 + g_i)          (transpulmonary; anchor D-003)
Palv_i = Ppl_i + PL_i
V̇_i    = (P_int − Palv_i)/R_i(direction)                               (compartment flow)
Ṗve_i  = E2·(V̇_i − Pve_i/R2)                                            (Maxwell viscoelastic element)
```

α_i is the regional transmission of muscle pressure (α_ND 0.65, α_D 1.35 in injured lungs, Yoshida 2013;
1 elsewhere), s_E the injector elastance multiplier (mainstem ×2, pneumothorax ×1.8), R_i the peripheral
resistance by flow direction (COPD R_exp = 2·R_insp) divided by the compartment fraction, R2/E2 the
viscoelastic dashpot and spring (τ_ve = R2/E2 = 0.7 s, `VISCOELASTIC_TAU`) that produce the P1 → P2 drop of
an inspiratory hold. Expiratory flow limitation (COPD, asthma) caps the compartment's expiratory flow at
Q_max = k·max(0, V_i − V_close·f_i). The static initialization solves Palv_i = PEEP with zero flow for
both compartments (damped fixed point on V), so EELV at PEEP, Ppl and PL all emerge (D-003).

**Airway node.** The shared airway carries the ETT Rohrer term and a central resistance,
P_aw − P_int = (K1 + R_central)·Q + K2·Q|Q| (`ETT_K1`, `ETT_K2`, `R_CENTRAL_DEFAULT`), with an optional
orifice leak at the Y-piece, Q_leak = k_L·√max(Paw, 0) (`LEAK_K_DEFAULT`). The node is solved in closed
form for the three ventilator boundary conditions (flow source; Thevenin pressure source with valve limits
q_min, q_max; occluded), with a bracketed fixed point for the leak (M3).

**Lung recoil R_i(V).** Two interchangeable models behind `LungRecoil`:

- *Venegas* (default, D-005): V = a + b/(1 + e^(−(P − c)/d)), with the phenotype fixing the anchor position
  s0 and width d and the code solving a, b, c so that the elastance at FRC equals the Table 1 EL and the
  curve passes through (V = 0, PL0): b = d/(EL·s0·(1 − s0)), a = −s0·b, c = PL0 + d·ln(1/s0 − 1).
- *Recruitable population* (D-013, D-014): N units per compartment (`RECRUIT_UNITS`), a fraction f
  recruitable with opening pressures TOP_j drawn as deterministic normal quantiles on the recoil axis
  (`RECRUIT_*_TOP`, `RECRUIT_*_TOP_SD`), closing pressure TCP_j = TOP_j − Δ (`RECRUIT_CLOSE_DELTA`), and a
  Bates–Irvin trajectory x_j ∈ [0, 1] moving at k_open·(P_local − TOP_j) above TOP and k_close·(TCP_j − P_local)
  below TCP (`RECRUIT_K_OPEN/CLOSE`); P_local includes the within-compartment pleural offset of the unit's
  height. With n of N units open, every open unit holds its aerated FRC, frc_u = FRC_comp/(N·f0), as real
  gas, so V = (n − N·f0)·frc_u + V_infl and
  ```
  R(V) = E_all·(N/n)·V_infl·(1 + g_od·max(0, ε_u − ε_cap)),   ε_u = V_infl/(n·frc_u),   E_all = E_comp·f0
  ```
  (`RECRUIT_STRAIN_CAP`, `RECRUIT_PULMONARY_STRAIN_CAP`, `RECRUIT_OD_GAIN`). Opening lowers the recoil at the
  current volume and the airway fills the unit; closing expels its content — the basis of the R/I release.

**Phenotype presets** (`src/sim/patient/presets.ts`, Brief 2 Table 1, Brief 1 §1.4): EL, Ecw, total
inspiratory R at 0.5 L/s split into tube + peripheral, FRC (D-004), Ppl0, gradient, α, Venegas shape,
viscoelastic R2, EFL. Specific lung elastance (PL/strain) stays at 13.5 ± 2 (Chiumello 2008).

## 3. Respiratory muscles (Spec §4.4, Brief 1 §1.3)

The neural clock spawns efforts with onset, neural Ti, isometric peak Pmax, hold fraction and relaxation
τ_r; each is an AR(1)-jittered draw (CV 12 % by default, `DRIVE_CV_DEFAULT`, φ 0.7):

```
Pmus_iso(x) = Pmax·(2u − u²),  u = x/(Ti(1 − h))   for x ≤ Ti(1 − h)      (parabolic rise, Albanese 2016)
            = Pmax                                    for Ti(1 − h) < x ≤ Ti   (hold)
            = Pmax·e^(−(x − Ti)/τ_r)                  after Ti                  (relaxation)
Pmus_eff    = Pmus_iso·(1 − k_fv·min(|Q|/Q_ref, 1))                            (force–velocity, D-007)
```

Overlapping efforts add. Expiratory muscles add a negative half-sine bump late in expiration. Sighs
(`SIGH_FACTOR`) and slow low-drive clusters (`DRIVE_CLUSTER_*`, Vaporidi IE clusters) are optional.
**Entrainment** (reverse triggering, Akoumianaki 2013): with `entrainment` on, every k-th machine breath
schedules an effort at t_vent + d·(1 + j·N(0,1)) (`ENTRAIN_DELAY_DEFAULT` 0.4 s, `ENTRAIN_JITTER_DEFAULT`
3 %). k_fv = 0.3 and Q_ref = 0.15 L/s are calibrated so the *measured* ΔPocc gives Bertoni 2019's
k1 = −0.74 (D-007).

## 4. CO2 → drive loop (Spec §4.4, Brief 1 §1.5, D-014)

```
VA        = (Vt_true − VD)·60/max(period, t − t_last)     VD = 2.2 mL/kg PBW + apparatus dead space
PaCO2_ss  = 0.863·VCO2/VA
dPaCO2/dt = (VCO2 − VA·PaCO2/0.863)/K,   K = τ·VA_ref/0.863,   VA_ref = 0.863·VCO2/PaCO2_set
PaCO2_d   = PaCO2 delayed by the chemoreceptor lag (10 s)
Pmax scale = clamp(1 + G_p·(PaCO2_d − 40), 0, D_max);  rate scale = clamp(1 + G_r·(PaCO2_d − 40), 0.5, 2)
apnea      = PaCO2_d < 40 − 4  → Pmus 0 (the ventilator's backup takes over)
```

The mass-balance form gives the brief's first-order approach with τ = 3 min at eupnea, slows at low VA
and is bounded in apnea (rise VCO2/K ≈ 13 mmHg/min). The time warp multiplies Δt for the store and the
delay line only; breathing is not warped, which is why the gains sit at the low end of the brief's range
(Q-5).

## 5. Esophageal balloon (Spec §4.5, Brief 2 §1.3)

Pes is a measurement of Ppl at the balloon's height z (0.7 of the lung height by default, `PES_Z_DEFAULT`):
```
Pes = k(fill, position)·Ppl(z) + P_offset(+3 supine) + P_ew(fill) + P_card(t)
```
k rises from 0.55 at 0.5 mL to 0.96 at the best fill (3.5 mL, Mojoli 2016) and falls when over-filled;
P_ew = E_wall·max(0, fill − V_free) (1.1 cmH2O/mL); a gastric placement returns IAP + β·Pmus + γ·Ecw·V.
P_card(t) is the cardiac artifact: one systolic bump per beat (a raised cosine over `PES_CARDIAC_WIDTH` of
the cardiac cycle, `PES_CARDIAC_PP` = 1.5 cmH2O peak-to-peak, beat-mean removed so Pes averaged over a beat
is the model value). The occlusion test (Baydur) and the ΔPes readout of the lung-stress dashboard read Pes
averaged over `OCCLUSION_SMOOTHING` (0.3 s) so the artifact does not inflate the swing (D-016).

## 5b. Schematic SpO2 (Spec §4.6 stretch goal, D-017) — display only

Not physics: a per-breath sketch on the main thread that nothing in the model reads. From FiO2, PaCO2 (CO2
loop or the 40 mmHg set point), the aerated fraction of units at end-expiration `open`, the breath's mean
airway pressure and a per-scenario base shunt `s0` (`ScenarioDef.shunt`, default 0.05):
```
PAO2   = FiO2·(760 − 47) − PaCO2/0.8
Qs/Qt  = min(0.6, s0/(1 + Pmean/20) + 0.5·(1 − open))
CaO2   = CcO2(PAO2) − (Qs/Qt)·5/(1 − Qs/Qt)        CxO2 = 1.34·12·SaO2(PxO2) + 0.003·PxO2
SpO2   = SaO2(PaO2),  SaO2(P) = 1/(23400/(P³ + 150·P) + 1)   (Severinghaus 1979), PaO2 by bisection
```
The tile is labelled "schematic"; there are no dynamics and the shunt terms are [M].

## 6. Ventilator (Spec §5, Brief 1 §2)

State machine `EXP → trigger (patient | time | backup) → INSP → cycle → [PAUSE] → EXP`, with hold and
occlusion states entered at the next eligible phase. Controller rules run at the device rate on measured
signals (D-002), actuators run at 1 ms:

- **VC**: ideal flow source, square or descending ramp, Q(t) = Q_peak·(1 − (1 − r)·t/Ti), optional pause;
  Ti from peak flow or set directly.
- **PC / PSV / CPAP**: integral servo on the airway-pressure error, dP_src/dt = (P_target − Paw)/τ_servo,
  delivered through a source resistance R_src (Thevenin), with a linear rise over the rise time; the
  inspiratory valve cannot take flow back (q_min = 0) and the blower peak flow bounds q_max (D-006).
- **Expiration**: the exhalation valve is a PEEP servo with valve resistance R_exh; the inspiratory valve
  supplies at most the bias flow, so demand pulls Paw down (pressure triggering, D-006).
- **Trigger**: flow ≥ threshold (net of the leak baseline when compensation is on) or Paw ≤ PEEP − threshold,
  after a refractory period (`TRIGGER_REFRACTORY` 0.2 s) and an actuator latency (30 ms).
- **Cycling**: VC by volume/time; PC by time; PSV by flow ≤ ETS·Q_peak held for 30 ms, by Ti max, or by
  pressure safety Paw > target + 3; any breath by the high-pressure alarm. The apnea backup delivers PC
  breaths at the backup rate until the next patient trigger.
- **SIMV** (D-022): period `60/rr` from the last mandatory breath; a patient trigger in the last
  `SIMV_SYNC_WINDOW` of the period delivers the mandatory breath (VC or PC plan per `simvBase`) early;
  earlier efforts get pressure-supported breaths (the PSV plan with `ps`, `ets`, `tiMax`). Every
  inspiration start emits a `breath` event with its kind, mandatory flag and pressure target.
- **Alarms** (Brief 1 §2.6): high Ppeak (cycles the breath), low Vte, high/low Ve and high RR on a rolling
  minute, apnea, disconnect (Paw < PEEP − 3 for 0.5 s), high leak, Ti max, high PEEPi after an expiratory hold.
- **Sensor chain**: first-order low-pass (15 ms), transport delay (20 ms), band-limited noise (Paw 0.15
  cmH2O RMS, flow 0.3 L/min RMS, 15 Hz), quantization (0.1 cmH2O, 0.1 L/min), resampling to the device
  rate; Vti/Vte integrated from the measured flow.

**Maneuvers** (measured signals): inspiratory hold (P1 after 50 ms, P2 at the end), expiratory hold
(running plateau, aborted by an effort, D-009), P0.1 (Paw drop over 100 ms from the onset of the
deflection against the pre-effort plateau, with a vendor-style at-trigger fallback), ΔPocc (whole-effort
occlusion, min Paw − plateau on a 0.3 s average), occlusion test, **R/I** (Chen 2020: one-breath release
from the set PEEP to 5; ΔV_release = Vte(release) − mean Vte(3 previous); 4 breaths at low PEEP; hold →
Crs,low = Vt/(Pplat,low − 5); V_pred = Crs,low·ΔPEEP; V_rec = ΔV_release − V_pred; R/I = V_rec/ΔPEEP/Crs,low;
airway opening pressure not modelled), **decremental PEEP trial** (from max(set, 20) by 2 every 6 breaths
to 4, a hold per step giving Pplat, ΔP, Crs, PL,ei = Pplat − Pes, power; best PEEP = argmax Crs),
**stress index** (fit Paw = a·t^b + c from 0.15 s after flow onset to cycle-off on machine-triggered
constant-flow breaths; b < 0.9 tidal recruitment, > 1.1 overdistension, Grasso 2004).

## 7. Monitor and dashboard (Spec §6)

From measured signals: Ppeak, Pplat (pause ≥ 0.3 s or the last hold), mean Paw, measured PEEP, total and
intrinsic PEEP from the expiratory hold, ΔP = Pplat − PEEP, Cstat = Vt/ΔP, Cdyn = Vt/(Ppeak − PEEP),
Raw = (Ppeak − Pplat)/Q, Vti, Vte, leak % = (Vti − Vte)/Vti, Ti, Te, I:E, RR and Ve on a rolling minute,
RSBI = RR/Vt, Vt/kg PBW (ARDSNet formula), least-squares R, C and PEEP from the equation of motion, the
stress index, PMI = Pplat(hold) − (PEEP + PS) (Foti 1997). Mechanical power: truth 0.098·RR·∫Paw·dV and
lung power 0.098·RR·∫PL·dV; bedside surrogates (Brief 2 §3): Gattinoni 2016 full VC formula
MP = 0.098·RR·{Vt²·[½·Ers + RR·(1 + I:E)/(60·I:E)·Raw] + Vt·PEEP} when Ers, Raw and I:E are measured,
Gattinoni simplified 0.098·RR·Vt·(Ppeak − ½ΔP) with a plateau, Giosa 2019 without one, Becher 2019
simplified 0.098·RR·Vt·(ΔPinsp + PEEP) in pressure modes. Dashboard bands and their sources are the
`*_LIMIT` constants below.

## 8. Ground truth (Spec §7, Brief 1 §3, D-011, D-012)

From neural timing versus ventilator events and the true channels, per breath:

| Label | Rule |
|---|---|
| ineffective effort (effort-level) | neural onset with no trigger in [onset − 0.05 s, onset + Ti + 0.4 s]; a time-triggered breath starting inside the effort assists it (Q-3) |
| delayed trigger | trigger − onset > 0.25 s |
| double trigger | a second breath uses the same effort; stacked volume recorded |
| reverse trigger | effort begins 0.05–1 s after a machine-triggered breath with a phase-locked delay (within 15 % of the running median) |
| premature / delayed cycling | cycle-off − neural end < −0.1 s / > 0.3 s (van Diepen margins) |
| flow starvation | VC, Pmus–time product during the insufflation ≥ 1 cmH2O·s, peak Pmus ≥ 3, Pmus still rising ≥ 0.5 after the breath starts |
| overshoot | Paw > target + 3 in the first 0.2 s (pressure modes) |
| auto-PEEP | relaxed end-expiratory Palv (Palv + Pmus_eff) > PEEP + 1 |
| leak | leak volume > 10 % of Vti |
| high resistance / low compliance | total inspiratory R ≥ 25; Crs < 30 or lung elastance ≥ 1.3× baseline |
| cough | expiratory Pmus < −10 during the breath |
| pendelluft | ≥ 10 mL swapped between compartments within the breath |
| overdistension | end-inspiratory PL > 20 in a region |
| tidal recruitment | ≥ 1 unit opened during the breath and closed by its end |
| high / low effort | peak Pmus > 10 / < 5 on an assisted breath (Goligher 2020) |

Asynchrony index = (double + auto + reverse triggers + premature + delayed cycling) / (cycles + ineffective
efforts) × 100 (Thille 2006); severe > 10 %; cluster flag > 30 ineffective efforts in 3 min (Vaporidi 2017).

## 9. Detector (signal-only, Spec §7, D-012)

Reads `t, paw, flow, vol, pes` and ventilator events only (`MeasuredReader`). Per breath: expiratory
notches as deviations from the extrapolated passive decay on 0.1 s-smoothed flow (Chen 2008 Fdef ≥ 5.45
L/min, threshold raised under a regular cardiac oscillation), cardiac autocorrelation, leak from ΣVte/ΣVti
over 8 breaths, Thille's Te < ½ mean Ti for double triggers, early-return ratio and Paw dip for premature
cycling, flow-decay knee, shoulder, inspiratory-tail τ and end-inspiratory Paw rise for delayed cycling,
least-squares ramp convexity and end-of-ramp steepening for flow starvation, mid-inspiratory dips/humps
with a phase-locked delay for reverse triggers, resistive step and equation-of-motion fits for resistance
and compliance. Every label carries an evidence string with the number and the threshold. Thresholds are
the `DET_*` constants; scores on the held-out grid are in `docs/VALIDATION.md`.

## 10. Constants

<!-- constants:start -->

Generated from `src/config/constants.ts` (263 constants). Confidence: V = verified against a primary source, L = literature not re-verified, M = modelling assumption.

| Key | Value | Unit | Conf. | Source |
|---|---|---|---|---|
| `PHYSICS_DT` | 0.001 | s | V | Spec §4.1; Brief 1 §0 (fixed 1 kHz step) |
| `DEVICE_RATE_DEFAULT` | 100 | Hz | V | Brief 1 §4 (ventMAP generic 100 Hz; PB840 50 Hz; Dräger V500 200 Hz) |
| `DEVICE_RATES` | 50, 100, 200 | Hz | V | Brief 1 §4 |
| `J_PER_CMH2O_L` | 0.098 | J/(cmH2O·L) | V | Brief 2 §3 mechanical power formulas |
| `ETT_K1` | 3 | cmH2O/(L/s) | M | Brief 1 §1.1: 7.5–8 mm ETT adds ~4–8 cmH2O/L/s at 1 L/s [uncertain]; split into K1+K2 |
| `ETT_K2` | 3 | cmH2O/(L/s)² | M | Brief 1 §1.1: with K1, gives 6 cmH2O/L/s at 1 L/s, 4.5 at 0.5 L/s |
| `R_CENTRAL_DEFAULT` | 1 | cmH2O/(L/s) | V | Brief 2 §1.1: Pelosi 1996 lung-only Rmin,L 1.0 (normal); shared central airway term |
| `R_REFERENCE_FLOW` | 0.5 | L/s | M | Brief 1 §1.4: Arnal resistances measured at typical VC flows (~30 L/min); used to split total R into tube + peripheral |
| `VISCOELASTIC_TAU` | 0.7 | s | M | Brief 1 §1.2 / Brief 2 §5: P1→P2 decay over 0.5–2 s [τ uncertain] |
| `PLEURAL_GRADIENT_NORMAL` | 0.25 | cmH2O/cm | V | Brief 2 §1.3: ~0.25 cmH2O/cm (0.2–0.5 by posture), Agostoni/D'Angelo |
| `PLEURAL_GRADIENT_ARDS` | 0.5 | cmH2O/cm | M | Brief 2 §1.3: steeper in ARDS (tissue weight doubles, Pelosi 1994); 0.4–0.7 suggested |
| `LUNG_HEIGHT_SUPINE` | 17 | cm | L | Brief 2 §1.3: supine anterior–posterior height 15–20 cm |
| `ALPHA_ND_INJURED` | 0.65 | fraction | M | Brief 2 §4: αND ≈ 0.7, αD ≈ 1.4 in injured lungs (Yoshida 2013), weighted mean = 1 |
| `ALPHA_D_INJURED` | 1.35 | fraction | M | Brief 2 §4: αD ≈ 1.4 in injured lungs (Yoshida 2013), weighted mean = 1 |
| `RECRUIT_UNITS` | 40 | units per compartment | L | Brief 2 §2.2: N = 20–50 units stacked vertically |
| `RECRUIT_TOP_SD` | 4 | cmH2O | M | Spread of opening pressures for non-ARDS phenotypes (Pelosi 2001: recruitment continues along the whole P–V curve) [M] |
| `RECRUIT_CLOSE_DELTA` | 4 | cmH2O | M | Brief 2 §2.2 gives closing 5–10 cmH2O below opening [M]; 4 on the recoil axis (≈ 6–8 on the airway axis through a stiff chest wall) is the largest hysteresis for which units opened by a PEEP-15 plateau still close at PEEP 5, the window the R/I single-breath method measures (D-014) |
| `RECRUIT_K_OPEN` | 5 | 1/(cmH2O·s) | M | Bates–Irvin trajectory rate: a unit 1 cmH2O above its opening pressure opens in 0.2 s, so units passed during a 1 s inflation open within the breath (tidal recruitment); a unit within 0.2 cmH2O of its TOP still needs seconds (slow recruitment during holds) [M] |
| `RECRUIT_K_CLOSE` | 5 | 1/(cmH2O·s) | M | Derecruitment trajectory rate, same order as opening [M] |
| `RECRUIT_STRAIN_CAP` | 0.72 | unit strain | M | Open units stiffen once their inflation exceeds 0.72× their aerated FRC (unit strain is now inflation over the open units' own FRC, D-014; upper inflection well below TLC ≈ 2–2.5× FRC; Protti 2011 injury above strain 1.5–2) [M]; keeps the Gattinoni 1998 extrapulmonary Ers fall at PEEP 15 with 6 mL/kg and makes PEEP 20 clearly worse than the best-compliance PEEP in a decremental trial |
| `RECRUIT_OD_GAIN` | 2.5 | per unit strain | M | Elastance multiplier slope above the strain cap [M]; with the caps here it gives Gattinoni 1998 pulmonary ARDS Ers 26 → ≈ 35 at PEEP 15 with Vt 6 mL/kg (measured 31.2) and a ≈ 13 % compliance loss at PEEP 20 in extrapulmonary ARDS |
| `RECRUIT_PULMONARY_STRAIN_CAP` | 1.38 | unit strain | M | Strain cap for the aerated units of consolidated (pulmonary) ARDS, whose baby lung (FRC 0.7 L) reaches unit strain ≈ 1.43 at PEEP 15 with 6 mL/kg; set so Ers rises 26 → ≈ 35 (Gattinoni 1998: 25.4 → 31.2) rather than doubling [M] |
| `RECRUIT_EXTRAPULMONARY_FRACTION` | 0.25 | fraction | M | Recruitable share of units in extrapulmonary ARDS [M]; with the TOP band below it recruits ≈ 0.22 L from PEEP 0 to 15 (Gattinoni 1998: 0.293 L) and Ers falls 25 → ≈ 23 |
| `RECRUIT_EXTRAPULMONARY_TOP` | 9.5 | cmH2O | M | Opening-pressure mode on the recoil axis for extrapulmonary ARDS: airway TOP ≈ 20–25 (Pelosi 2001) minus the raised pleural pressure of a stiff chest wall; placed so a PEEP-15 plateau (recoil ≈ 10–12) opens most of the band and PEEP 5 (recoil ≈ 2) closes it (D-014) [M] |
| `RECRUIT_EXTRAPULMONARY_TOP_SD` | 1.5 | cmH2O | M | Spread of the extrapulmonary opening band on the recoil axis (≈ ±3–4 cmH2O on the airway axis after the chest wall, plus the ±2 cmH2O within-compartment pleural gradient) [M]; a wider band leaves most units outside the 15 → 5 release window (D-014) |
| `RECRUIT_PULMONARY_FRACTION` | 0.3 | fraction | M | Recruitable share of units in pulmonary (consolidated) ARDS [M]; nearly none opens at protective plateau pressures (Gattinoni 1998: −0.03 L recruited) |
| `RECRUIT_PULMONARY_TOP` | 34 | cmH2O | M | Opening-pressure mode on the recoil axis for consolidated units: above the plateau of protective ventilation (PEEP 15, 6 mL/kg → recoil ≈ 27–29) so no tidal recruitment at protective settings, below the recoil at a 50 cmH2O plateau so an injurious setting makes them cycle (stress index < 0.9) [M] |
| `RECRUIT_PULMONARY_TOP_SD` | 3 | cmH2O | M | Spread of consolidated opening pressures [M] |
| `RECRUIT_DEFAULT_FRACTION` | 0.1 | fraction | M | Recruitable share for non-ARDS phenotypes (basal atelectasis in anaesthetized normals) [M] |
| `RECRUIT_DEFAULT_TOP` | 5 | cmH2O | M | Opening-pressure mode for basal atelectasis in non-ARDS lungs [M] |
| `PMUS_KFV` | 0.3 | fraction | M | Spec §4.4: k_fv ≈ 0.25–0.3 [M], calibrated so the *measured* ΔPocc → Pmus ratio on the PSV grid gives Bertoni 2019 k1 = −0.74 (the measured ΔPocc slightly under-reads Pmus_iso because Paw is still equilibrating after the occlusion) |
| `PMUS_QREF` | 0.15 | L/s | M | Flow above which the force–velocity penalty is fully applied [M]; low so that any flowing breath is penalized and an occluded (isometric) one is not, reproducing Bertoni k1 across the Pmax range |
| `PMUS_RELAX_TAU` | 0.2 | s | M | Brief 1 §1.3: relaxation exponential τ ≈ 0.1–0.3 s [uncertain] |
| `PMUS_HOLD_FRAC` | 0.05 | fraction of Ti | M | Brief 1 §1.3 ASL 5000 Hold % 0–5% [uncertain] |
| `DRIVE_CV_DEFAULT` | 0.12 | fraction | M | Brief 1 §4: AR(1) CV ≈ 10–25% on Pmax, Ti, rate [uncertain] |
| `DRIVE_AR1_PHI` | 0.7 | dimensionless | M | AR(1) autocorrelation of breath-to-breath variability [M] |
| `DRIVE_CLUSTER_PHI` | 0.97 | dimensionless | M | Slow AR(1) for clusters of low-drive breaths (Vaporidi 2017 IE clusters) [M] |
| `DRIVE_CLUSTER_CV` | 0.35 | fraction | M | Amplitude of slow drive modulation producing IE clusters [M] |
| `SIGH_FACTOR` | 2 | multiple of Pmax | M | Brief 1 §4: sighs ≈ 2× effort every 5–10 min [uncertain] |
| `ENTRAIN_DELAY_DEFAULT` | 0.4 | s | L | Brief 1 §3.5: reverse-trigger phase delay ≈ 0.39 s (phase angle ~60°) [uncertain generalizability] |
| `ENTRAIN_JITTER_DEFAULT` | 0.03 | fraction | V | Brief 1 §3.5 Akoumianaki 2013: CV of reverse-triggered breath frequency < 5% |
| `SPO2_PB` | 760 | mmHg | V | Alveolar gas equation: barometric pressure at sea level |
| `SPO2_PH2O` | 47 | mmHg | V | Alveolar gas equation: saturated water vapour pressure at 37 °C |
| `SPO2_RQ` | 0.8 | ratio | L | Alveolar gas equation: respiratory quotient |
| `SPO2_HB` | 12 | g/dL | L | Typical ICU haemoglobin; O2 content = 1.34·Hb·SaO2 + 0.003·PaO2 |
| `SPO2_AV_DIFF` | 5 | mL/dL | L | Arteriovenous O2 content difference (Fick, VO2 250 mL/min at CO 5 L/min) |
| `SPO2_SHUNT_BASE` | 0.05 | fraction | M | Physiological venous admixture of a normal lung ≈ 2–5 % [M, upper end] |
| `SPO2_SHUNT_PER_CLOSED` | 0.5 | fraction per closed fraction | M | Share of a closed (non-aerated) unit that still perfuses after hypoxic vasoconstriction [M] |
| `SPO2_MPAW_HALF` | 20 | cmH2O | M | Mean airway pressure that halves the base shunt (schematic recruitment of unmodelled atelectasis) [M] |
| `SPO2_SHUNT_MAX` | 0.6 | fraction | M | Clamp on the effective shunt [M] |
| `CO2_BTPS_FACTOR` | 0.863 | mmHg·L/mL | V | Brief 1 §1.5: PaCO2_ss = 0.863·VCO2/VA (VCO2 mL/min STPD, VA L/min BTPS) |
| `CO2_VCO2_DEFAULT` | 200 | mL/min | L | Brief 1 §1.5: VCO2 ≈ 200–250 mL/min |
| `CO2_DEAD_SPACE_ML_PER_KG` | 2.2 | mL/kg PBW | L | Brief 1 §1.5: anatomic dead space 2.2 mL/kg PBW |
| `CO2_APPARATUS_DEAD_SPACE` | 75 | mL | L | Brief 1 §1.5: apparatus dead space (HME/ETT) ≈ 50–100 mL |
| `CO2_TAU` | 180 | s | M | Brief 1 §1.5: lumped body CO2 store time constant 2–5 min [uncertain] |
| `CO2_CHEMO_DELAY` | 10 | s | M | Brief 1 §1.5: chemoreceptor transport delay 7–15 s [uncertain] |
| `CO2_SET_POINT` | 40 | mmHg | L | Brief 1 §1.5: drive D = D0 + G·(PaCO2 − 40) |
| `CO2_APNEIC_OFFSET` | 4 | mmHg | L | Brief 1 §1.5: apneic threshold ≈ 3–5 mmHg below the eupneic PaCO2 |
| `CO2_GAIN_PMAX` | 0.06 | 1/mmHg | M | Pmax scale per mmHg of delayed PaCO2 above the set point [M]: an 8 mmHg rise raises the effort by half. With the rate gain below, a Pmax of 8 and Ers 25 this is a ventilatory response of ≈ 0.5 L/min/mmHg, the low end of Brief 1 §1.5's 1–3; a larger gain makes the warped loop oscillate because the breath-by-breath ventilatory response cannot be warped (D-014) |
| `CO2_GAIN_RATE` | 0.03 | 1/mmHg | M | Neural rate scale per mmHg of delayed PaCO2 above the set point [M]; rate responds less than tidal effort (Brief 1 §1.5) |
| `CO2_DRIVE_MAX` | 3 | ratio | M | Brief 1 §1.5: D clamped to Dmax; 3× the baseline Pmax (Pmax ≤ 40 in NeuralDrive) [M] |
| `CO2_RATE_SCALE_MIN` | 0.5 | ratio | M | Lowest neural-rate scale below the set point before apnea [M] |
| `CO2_RATE_SCALE_MAX` | 2 | ratio | M | Highest neural-rate scale (rate itself is clamped to 60/min in NeuralDrive) [M] |
| `CO2_PACO2_INIT` | 40 | mmHg | M | Initial PaCO2 (eupneic) [M] |
| `CO2_WARP_MAX` | 60 | × | V | Spec §4.4: time-warp control ×10–×60 on the CO2 dynamics only |
| `CO2_DELAY_SAMPLE` | 0.05 | s (warped) | M | Sampling interval of the chemoreceptor delay line on the warped CO2 clock [M] |
| `PES_OFFSET_SUPINE` | 3 | cmH2O | V | Brief 2 §1.3: supine mediastinal offset +2 to +5 (Washko 2006), default +3 |
| `PES_Z_DEFAULT` | 0.7 | fraction of lung height | V | Brief 2 §1.3: balloon samples mid-to-dependent lung (Yoshida 2018); 0.7 of the vertical height [M within that range] |
| `PES_Z_HIGH` | 0.3 | fraction of lung height | M | Balloon positioned too high (upper esophagus) [M] |
| `BALLOON_BEST_FILL` | 3.5 | mL | V | Brief 2 §1.3 Mojoli 2016: best filling volume 3.5 ± 1.9 mL |
| `BALLOON_HIGH_POSITION_FACTOR` | 0.6 | fraction | M | Swing attenuation of a high-positioned balloon [M] |
| `ESO_WALL_ELASTANCE` | 1.1 | cmH2O/mL | V | Brief 2 §1.3 Mojoli 2016: esophageal wall elastance 1.1 ± 0.5 |
| `ESO_WALL_FREE_VOLUME` | 1.6 | mL | M | Fill below which no wall pressure develops; gives Pew ≈ 2.0 at 3.5 mL and 2.6 at 4 mL (Mojoli: 2.0, 3.0) |
| `PES_CARDIAC_PP` | 1.5 | cmH2O | M | Brief 2 §1.3: cardiac artifact on Pes ≈ 1–3 cmH2O peak-to-peak; mid-range [M] |
| `PES_CARDIAC_WIDTH` | 0.3 | fraction of the cardiac cycle | M | Duration of the systolic bump on Pes: a raised-cosine pulse over ~30 % of the beat (about a systolic ejection at 80/min), baseline for the rest [M] |
| `HEART_RATE_DEFAULT` | 80 | /min | L | Typical ICU heart rate; cardiac artifact band 0.8–4 Hz (Brief 2 §1.3) |
| `IAP_DEFAULT` | 8 | cmH2O | V | Brief 2 Table 1: normal IAP 8.5 ± 3 (Gattinoni 1998) |
| `PGA_BETA` | 0.4 | fraction | M | Brief 2 §1.2: Pga = IAP + β·Pmus, β ≈ 0.3–0.5 [M] |
| `PGA_GAMMA` | 0.3 | fraction | M | Brief 2 §1.2: γ·Ecw·V term, γ ≈ 0.3 [M] |
| `P01_ONSET_THRESHOLD` | 0.5 | cmH2O | M | Detection of the Paw deflection onset during an occlusion, above sensor noise (0.15 RMS, 0.1 quantum) [M]; onset back-extrapolated from the slope |
| `P01_NOISE_BAND` | 0.25 | cmH2O | M | Raw-sample band around the occlusion plateau treated as "not yet deflected" (≈ 1.7 × sensor noise RMS) [M] |
| `P01_WINDOW` | 0.1 | s | V | Brief 2 §4/§5: P0.1 = Paw drop over the first 100 ms of the occluded effort |
| `OCCLUSION_TIMEOUT` | 4 | s | M | Maximum single-breath occlusion before release [M] |
| `POCC_MIN_DIP` | 1 | cmH2O | M | Minimum deflection to count an occluded effort [M] |
| `OCCLUSION_SMOOTHING` | 0.3 | s | M | Moving average applied to Paw/Pes when reading whole-effort occlusion swings; spans ~1/3 of a cardiac cycle band (0.8–4 Hz) as a clinician does by eye [M] |
| `OCCLUSION_SETTLED_FLOW` | 0.04 | L/s | M | Expiratory flow below which an end-expiratory occlusion may start (≈3.6 L/min): late enough that the post-occlusion Paw rise toward Palv is small, early enough to precede the next effort in compliant lungs [M] |
| `OCCLUSION_BASELINE_WINDOW` | 0.1 | s | M | Quiet interval at the start of an occlusion averaged for the baseline [M] |
| `SENSOR_LPF_TAU` | 0.015 | s | M | Brief 1 §4: first-order low-pass τ ≈ 10–30 ms [uncertain] |
| `SENSOR_DELAY` | 0.02 | s | M | Brief 1 §4: 10–30 ms transport delay [uncertain] |
| `SENSOR_NOISE_BANDWIDTH` | 15 | Hz | V | Brief 1 §4 (van Diepen): low-pass white noise, 15 Hz bandwidth |
| `SENSOR_PAW_NOISE_RMS` | 0.15 | cmH2O | M | Brief 1 §4: pressure SNR ≈ 15 dB against a ~1 cmH2O-RMS reference swing; chosen so Chen Pdef 0.45 stays resolvable |
| `SENSOR_FLOW_NOISE_RMS` | 0.005 | L/s | M | Brief 1 §4: flow SNR ≈ 30 dB (0.3 L/min RMS) |
| `SENSOR_PAW_QUANTUM` | 0.1 | cmH2O | L | Brief 1 §4: quantization 0.1 cmH2O |
| `SENSOR_FLOW_QUANTUM` | 0.0016666666666666668 | L/s | L | Brief 1 §4: quantization 0.1 L/min |
| `TRIGGER_REFRACTORY` | 0.2 | s | M | Spec §5; Brief 1 §2.1: 150–300 ms [uncertain, vendor-specific] |
| `SIMV_SYNC_WINDOW` | 0.25 | fraction of the SIMV period | M | Brief 1 §2.5: mandatory breaths synchronize to a patient trigger "inside a window before each scheduled breath"; window length vendor-specific (Dräger 5 s, PB-840 start-of-period); the last quarter of the period chosen [M] |
| `ACTUATOR_LATENCY` | 0.03 | s | M | Brief 1 §2.1: actuator latency ≈ 20–50 ms [uncertain] |
| `SERVO_TAU` | 0.03 | s | M | Spec §5; Brief 1 §1.1: pressure servo effective lag 20–50 ms [uncertain] |
| `SERVO_SOURCE_R` | 4 | cmH2O/(L/s) | M | Spec §5 "small source resistance"; sized so a 6 L/min demand dips Paw ≈ 0.4 cmH2O before the servo recovers |
| `MAX_SERVO_FLOW` | 3 | L/s | M | Peak deliverable flow of an ICU ventilator blower/valve ≈ 180 L/min [vendor-specific, M]; bounds the servo under leaks and disconnects |
| `EXH_VALVE_R` | 1.5 | cmH2O/(L/s) | M | Spec §5 exhalation valve resistance; typical active-valve drop ≈ 1–2 cmH2O at 1 L/s |
| `BIAS_FLOW_DEFAULT` | 0.05 | L/s | M | Brief 1 §2.1: bias flow 2–10 L/min [vendor-specific] |
| `FLOW_TRIGGER_DEFAULT` | 0.03333333333333333 | L/s | L | Brief 1 §2.1: flow trigger typically 1–5 L/min, default ≈ 2–3 |
| `PRESSURE_TRIGGER_DEFAULT` | 1 | cmH2O | L | Brief 1 §2.1: pressure trigger 0.5–2 cmH2O |
| `ETS_DEFAULT` | 0.25 | fraction of peak flow | L | Brief 1 §2.4: common default 25% |
| `TI_MAX_DEFAULT` | 2 | s | M | Brief 1 §2.4: Ti_max ≈ 1.5–3 s adult [uncertain] |
| `PRESSURE_CYCLE_MARGIN` | 3 | cmH2O | M | Spec §5: cycle if Paw > target + 3 [vendor-specific] |
| `PSV_CYCLE_MIN_TI` | 0.1 | s | M | Brief 1 §2.4: ETS is evaluated against the breath's own peak flow, so a short blanking interval is needed after pressurization starts [M] |
| `ETS_CONFIRM_TIME` | 0.03 | s | M | Flow-cycle criterion validated over a few device samples before cycling, so an abrupt expiratory push can pressure-cycle first [vendor-specific, M] |
| `PSV_CYCLE_MIN_PEAK_FLOW` | 0.05 | L/s | M | ETS comparison is meaningless until inspiratory flow has developed (3 L/min) [M] |
| `DISCONNECT_SUSTAIN` | 0.5 | s | M | Brief 1 §2.6: low PEEP / disconnect when Paw < PEEP − 3 [uncertain]; sustained 0.5 s to avoid trigger dips [M] |
| `APNEA_TIME_DEFAULT` | 20 | s | L | Brief 1 §2.6: apnea alarm default 20 s |
| `RISE_TIME_DEFAULT` | 0.15 | s | L | Brief 1 §2.3: rise time ≈ 0.05–0.4 s |
| `HIGH_PPEAK_ALARM_DEFAULT` | 40 | cmH2O | L | Brief 1 §2.6: Ppeak + 10, max 50 |
| `INSP_HOLD_P1_DELAY` | 0.05 | s | M | Brief 2 §5: P1 read after the fast resistive drop (Paw → P1 "quickly"), before the slow P2 decay |
| `INSP_HOLD_MIN` | 0.3 | s | L | Brief 1 §2.7: Pplat at the end of a ≥ 0.3–0.5 s no-flow pause |
| `EXP_HOLD_DEFAULT` | 3 | s | L | Spec §5: expiratory hold 2–4 s |
| `RI_PEEP_LOW` | 5 | cmH2O | V | Brief 2 §2.4 Chen 2020: one-breath release from PEEP 15 (the set PEEP here) to 5 |
| `RI_MIN_RELEASE` | 2 | cmH2O | M | Smallest PEEP release for which R/I is reported (below this ΔVrelease is within the Vte noise) [M] |
| `RI_BASELINE_BREATHS` | 3 | breaths | M | Vte reference for ΔVrelease = mean expired volume of the breaths before the release [M] |
| `RI_LOW_BREATHS` | 4 | breaths | M | Breaths kept at the low PEEP before the inspiratory hold that gives Pplat,low and Crs,low, so the lung has settled at the new PEEP [M] |
| `PEEP_TRIAL_START` | 20 | cmH2O | M | Decremental trial starts at the higher of the set PEEP and 20 (after a recruitment step) [M; Spec §5] |
| `PEEP_TRIAL_END` | 4 | cmH2O | M | Lowest PEEP of the decremental trial [M] |
| `PEEP_TRIAL_STEP` | 2 | cmH2O | M | Decremental trial step size [M; common bedside practice] |
| `PEEP_TRIAL_BREATHS` | 6 | breaths per step | M | Breaths at each PEEP before the inspiratory hold that closes the step (derecruitment settles within a few breaths at kClose 5) [M] |
| `PEEP_TRIAL_HOLD_RETRIES` | 3 | breaths | M | An alarm-cycled breath skips its hold; after this many breaths without a hold the step (or the R/I) is recorded as invalid and the maneuver moves on rather than stalling [M] |
| `LEAK_K_DEFAULT` | 0.03 | L/s/√cmH2O | M | Brief 1 §1.4 orifice leak Q = k·√Paw; k = 0.03 gives ≈ 8 L/min at 20 cmH2O, a 15–25% cuff leak [M] |
| `CARDIAC_PPL_AMP_DEFAULT` | 0.6 | cmH2O | L | Brief 1 §3.2: cardiac pleural oscillation A = 0.2–1 cmH2O; Imanaka flow fluctuation 2–5 L/min |
| `SECRETIONS_R_MODULATION` | 0.6 | fraction (RMS) | M | Brief 1 §3.12: random band-limited modulation of R producing a sawtooth on expiratory flow [uncertain] |
| `SECRETIONS_BAND_LO` | 5 | Hz | M | Brief 1 §3.12: sawtooth band 5–20 Hz [uncertain] |
| `SECRETIONS_BAND_HI` | 20 | Hz | M | Brief 1 §3.12: sawtooth band 5–20 Hz [uncertain] |
| `WATER_R_MODULATION` | 0.4 | fraction | M | Brief 1 §3.12: water in the circuit gives a more regular oscillation than secretions [M] |
| `WATER_OSC_FREQ` | 4 | Hz | M | Regular oscillation frequency of water sloshing in the tubing [M] |
| `COUGH_INTERVAL_DEFAULT` | 8 | s | M | Mean interval between coughs in the cough injector [M] |
| `COUGH_PMUS_AMP` | 40 | cmH2O | M | Brief 1 §3.12: brief large expiratory Pmus; 40 cmH2O spikes Paw past a 40 cmH2O alarm limit [M] |
| `COUGH_DURATION` | 0.4 | s | M | Duration of one cough burst [M] |
| `COUGH_INSP_DELAY` | 0.25 | s | M | Coughs in intubated patients are provoked by inflation; an armed cough fires this long after inspiration starts [M] |
| `PNEUMOTHORAX_ESCALE` | 1.8 | × | M | Brief 1 §3.12: pneumothorax → abrupt compliance fall; lung elastance ×1.8 [M] |
| `PNEUMOTHORAX_PPL` | 6 | cmH2O | M | Pleural pressure offset from intrapleural air [M] |
| `MAINSTEM_ESCALE` | 2 | × | L | Brief 1 §3.12: mainstem intubation roughly halves compliance |
| `MAINSTEM_RSCALE` | 1.5 | × | M | Single-lung airway resistance rises (parallel path lost) [M] |
| `BRONCHOSPASM_RSCALE` | 3 | × | M | Brief 1 §3.12: high resistance, Ppeak − Pplat > 10 at 60 L/min [heuristic] |
| `BRONCHOSPASM_RAMP` | 20 | s | M | Ramp of the bronchospasm onset [M] |
| `LABEL_TRIGGER_DELAY` | 0.25 | s | V | Brief 1 §3 van Diepen / Mojoli: trigger delay > 250 ms is delayed triggering |
| `LABEL_EARLY_CYCLING` | -0.1 | s | V | Brief 1 §3 van Diepen: cycling delay < −100 ms is early (premature) cycling |
| `LABEL_LATE_CYCLING` | 0.3 | s | V | Brief 1 §3 van Diepen: cycling delay > 300 ms is late (delayed) cycling |
| `LABEL_EFFORT_LEAD` | 0.05 | s | M | A trigger this long before the recorded neural onset still counts as caused by the effort (parabolic onset is gradual) [M] |
| `LABEL_EFFORT_TAIL` | 0.4 | s | M | Relaxation window after neural Ti during which a trigger is still attributed to the same effort (τ_relax 0.2 s → 2τ) [M] |
| `LABEL_RT_MAX_DELAY` | 1 | s | M | Brief 1 §3.5: entrained onset delay d = 0.2–0.8 s after the machine breath start; onsets beyond 1 s are not reverse triggers [M] |
| `LABEL_RT_PHASE_TOL` | 0.15 | fraction | M | Brief 1 §3.5 Akoumianaki: reverse-triggered breaths have CV < 5%; a delay within 15% of the running median counts as phase-locked [M] |
| `LABEL_FLOW_STARVATION_PTP` | 1 | cmH2O·s | M | Spec §7: Pmus active during VC inspiration above a threshold pressure–time product [M] |
| `LABEL_FLOW_STARVATION_PMUS` | 3 | cmH2O | M | Minimum peak Pmus during VC inspiration for flow starvation (below this the ramp stays convex) [M] |
| `LABEL_FLOW_STARVATION_RISE` | 0.5 | cmH2O | M | Pmus must still rise by this much after the insufflation starts: demand ahead of delivered flow. A breath triggered so late that Pmus is already relaxing is a delayed trigger, not flow starvation (D-012) [M] |
| `LABEL_OVERSHOOT_MARGIN` | 3 | cmH2O | L | Spec §7 / Brief 1 §3.9: Paw > target + 3 in the first 200 ms |
| `LABEL_OVERSHOOT_WINDOW` | 0.2 | s | L | Brief 1 §3.9: overshoot judged in the first 100–200 ms |
| `LABEL_AUTO_PEEP` | 1 | cmH2O | L | Spec §7: true end-expiratory Palv > PEEP + 1 |
| `LABEL_LEAK_FRACTION` | 0.1 | fraction | L | Spec §7 / Brief 1 §3.11: leak volume > 10% of Vti |
| `LABEL_COUGH_PMUS` | 10 | cmH2O | M | Expiratory Pmus more negative than −10 during a breath marks a cough (injector bursts are 40) [M] |
| `LABEL_HIGH_R` | 25 | cmH2O/(L/s) | M | Truth high resistance: preset total R × injector scale ≥ 25 (bronchospasm, asthma) [M, matches DET_HIGH_R] |
| `LABEL_E_SCALE` | 1.3 | × | M | Lung elastance ≥ 1.3× the scenario baseline (≈ 30% Crs drop: mainstem, pneumothorax) counts as a compliance fall [M] |
| `LABEL_LOW_C` | 30 | mL/cmH2O | M | Truth low compliance: static Crs < 30 mL/cmH2O (fibrosis preset) [M, matches DET_LOW_C] |
| `LABEL_PENDELLUFT_VOL` | 0.01 | L | M | Brief 2 §4: pendelluft volume ≥ 10 mL swapped between compartments within a breath [M] |
| `LABEL_TIDAL_RECRUIT_UNITS` | 1 | units | M | Spec §7 truth-only finding: at least one recruitable unit opened during the breath and closed again by its end (Brief 2 §2.2 model B) [M] |
| `AI_SEVERE` | 10 | % | V | Brief 1 §3 Thille 2006: AI > 10% is severe |
| `IE_CLUSTER_COUNT` | 30 | events | V | Brief 1 §3 Vaporidi 2017: > 30 ineffective efforts in 3 min |
| `IE_CLUSTER_WINDOW` | 180 | s | V | Brief 1 §3 Vaporidi 2017: 3-minute window |
| `DET_IE_FDEF` | 5.45 | L/min | V | Brief 1 §3.1 Chen 2008: expiratory flow deflection ≥ 5.45 L/min (sens 91.5%, spec 96.2%) |
| `DET_IE_PDEF` | 0.45 | cmH2O | V | Brief 1 §3.1 Chen 2008: Paw deflection ≥ 0.45 cmH2O (sens 93.3%, spec 92.9%). Not used as a criterion: with an active exhalation valve (R 1.5) a 7 L/min deflection moves Paw ≈ 0.2 cmH2O (D-012) |
| `DET_IE_MIN_DURATION` | 0.15 | s | M | A flow deflection must last ≥ 150 ms to be an effort; secretion sawtooth (5–20 Hz) is shorter [M] |
| `DET_NOTCH_ONSET` | 2 | L/min | M | Expiratory flow deviation above the extrapolated passive decay that opens a candidate notch (≈ 7× sensor noise RMS on the 0.1 s-smoothed flow) [M] |
| `DET_NOTCH_REANCHOR` | 0.5 | s | M | While no deflection is under way the passive-decay prediction is re-anchored on the measured flow every 0.5 s (an effort reaches the onset threshold within its rise, ≈ ½·Ti) [M] |
| `DET_CARDIAC_NOTCH_FACTOR` | 3 | L/min per L/min | M | When a regular heart-rate oscillation is present, an effort notch must exceed the pattern threshold plus 3× the smoothed oscillation amplitude (raw peak-to-peak ≈ 3.3× the smoothed RMS·√2 amplitude) [M] |
| `DET_FS_CONVEXITY` | 0.7 | cmH2O | M | Brief 1 §3.8: scooped (convex) VC Paw ramp; mid-ramp deviation of the least-squares parabola from its chord over 20–100% of Ti. Passive ramps give −0.2…+0.2 (Venegas curvature included), a rising Pmus of 3–8 cmH2O during the breath gives ≥ 0.9 [M] |
| `DET_FS_END_STEEPENING` | 2 | ratio | M | Brief 1 §3.8: flow starvation scoops the VC Paw ramp; when Pmus relaxes before cycle-off the last 15% of the ramp is ≥ 2× steeper than the 20–85% chord (a passive ramp is linear, ≤ 1.3 with Venegas stiffening) [M] |
| `DET_IE_EXP_BLANK` | 0.35 | s | M | Deflections starting within this time after cycle-off belong to the breath's own effort (premature cycling), later ones are new efforts [M] |
| `DET_PREM_PAW_DIP` | 0.5 | cmH2O | M | Brief 1 §3.6: Paw dips below PEEP just after cycling when the effort continues [M] |
| `DET_PREM_NOTCH` | 10 | L/min | M | Brief 1 §3.6: early-expiratory flow notch or reversal (flow returns toward zero by this much); above the cardiac flow oscillation (≤ 5–7 L/min, Imanaka 2000) [M] |
| `DET_PREM_WINDOW` | 0.35 | s | M | Window after cycle-off in which the notch marks premature cycling [M] |
| `DET_AT_PAW_DIP` | 0.5 | cmH2O | L | Brief 1 §3.2: auto-trigger = triggered breath with no Paw dip ≥ 0.5 cmH2O before the trigger (read on a 0.1 s moving average, D-012) |
| `DET_AT_CARDIAC_CORR` | 0.5 | ratio | M | Auto-trigger (cardiac): autocorrelation of the pre-trigger flow residual ≥ 0.5 at a heart-rate lag (0.4–1.25 s) and ≥ 0.25 at twice that lag marks a periodic oscillation rather than a single effort deflection [M] |
| `DET_AT_DEMAND_SAG` | 0.8 | cmH2O | M | Early-inspiratory Paw sag below the servo target that indicates true demand after a pressure-targeted trigger [M] |
| `DET_AT_PRE_WINDOW` | 0.4 | s | M | Pre-trigger window for the Paw dip and flow inflection [M] |
| `DET_DELAYED_TRIGGER` | 0.25 | s | V | Brief 1 §3.3 Mojoli: dip onset to trigger > 250 ms |
| `DET_DIP_ONSET` | 0.3 | cmH2O | M | Paw below the expiratory baseline by 2× sensor noise RMS marks the dip onset [M] |
| `DET_DT_TE_FRACTION` | 0.5 | fraction | V | Brief 1 §3.4 Thille 2006: double trigger = Te shorter than half the mean Ti, first breath triggered |
| `DET_DT_VTE_RATIO` | 0.7 | fraction | M | Brief 1 §3.4: the first breath's Vte is much smaller than its Vti (stacking) [M] |
| `DET_DT_TE_MAX` | 0.6 | s | M | Absolute expiratory-time limit for stacking when the machine Ti is very short (refractory 0.2 s makes Te < ½·Ti impossible below Ti 0.4 s) [M] |
| `DET_RT_EXP_WINDOW` | 0.6 | s | M | Brief 1 §3.5: early-expiratory blunting/reversal after a machine breath marks the entrained effort [M] |
| `DET_RT_PAW_DIP` | 0.6 | cmH2O | M | Brief 1 §3.5: mid/late-inspiratory Paw dip in VC of a time-triggered breath [M] |
| `DET_RT_FLOW_HUMP` | 3 | L/min | M | Brief 1 §3.5: mid/late-inspiratory flow hump in PC [M] |
| `DET_RT_EXP_BLUNT` | 0.7 | fraction | M | Brief 1 §3.5: early-expiratory flow blunted below this fraction of the running median peak expiratory flow [M] |
| `DET_FS_CONCAVITY` | 1 | cmH2O | M | Brief 1 §3.8: scooped Paw ramp; mid-ramp Paw below the chord by ≥ 1 cmH2O [heuristic] |
| `DET_DC_PAW_RISE` | 1 | cmH2O | M | Brief 1 §3.7: end-inspiratory Paw rise above target in the last third (heuristic 2 cmH2O on raw traces); read on a 0.1 s moving average, where a Pmax 5 relaxation against a closed inspiratory valve gives 1.3–2.6 and passive breaths ≤ 0.5 (D-012) |
| `DET_DC_SHOULDER_TAIL` | 0.3 | s | M | Time from a flow "shoulder" (abrupt steepening of the decay as the effort starts to relax, i.e. the neural end) to cycle-off; equals the truth margin LABEL_LATE_CYCLING (was 0.4, D-012) [M] |
| `DET_DC_KNEE_TAU` | 0.45 | s | M | Local time constant of the inspiratory flow decay after the knee must reach the passive range (≥ 0.45 s; the relaxation phase gives 0.2–0.4 s in any lung, the passive tail ≈ 0.5 s in a normal lung and 0.9–1.6 s in COPD); the knee ratio carries the discrimination, this gate rejects noise-driven τ jumps at low flow [M] |
| `DET_DC_VC_CONCAVITY` | 0.5 | cmH2O | M | VC, patient-triggered breath with a delayed trigger: a concave-down Paw ramp (least-squares parabola ≤ −0.5 cmH2O below its chord) means Pmus was relaxing during the insufflation, so the breath came late and outlasted the effort (delayed cycling). Passive ARDS ramps stay within ±0.2; tidal recruitment in a triggering patient is a known confounder (LIMITATIONS) [M] |
| `DET_DC_KNEE_RATIO` | 1.5 | ratio | M | Local τ of the inspiratory flow decay over the 0.2 s after the knee ≥ 1.5× the 0.2 s before it (the relaxing effort accelerates the decay; a passive exponential keeps τ constant); the COPD knee is gradual, τ 0.45 → 0.7 → 1.3 s over 0.3 s [M] |
| `DET_DC_KNEE_TAIL` | 0.1 | s | M | Time from the knee of the inspiratory flow decay (local τ ≥ 1.5×: relaxation complete, ≈ 2·τ_relax = 0.4 s after the neural end) to cycle-off; any knee clear of the cycle-off transient means the ventilator cycled ≥ 0.3 s after the neural end (LABEL_LATE_CYCLING) [M] |
| `DET_HIGH_R_EEF` | 5 | L/min | M | The inspiratory resistive step is trusted for the resistance estimate when the end-expiratory flow before the breath is above −5 L/min (a 5 L/min residual flow across R 30 adds ≈ 2.5 cmH2O, ≤ 4 cmH2O/(L/s) of apparent R at 0.6 L/s) [M] |
| `DET_DC_TI_RATIO` | 2 | ratio | L | Brief 1 §3.7 Thille: prolonged cycle = Ti > 2× mean Ti |
| `DET_OVERSHOOT_MARGIN` | 3 | cmH2O | L | Brief 1 §3.9: Paw in the first 200 ms > target + 2–3 [heuristic] |
| `DET_AUTOPEEP_FLOW` | 3 | L/min | L | Brief 1 §3.10: end-expiratory flow magnitude > 2–5 L/min at the trigger point [heuristic] |
| `DET_LEAK_RATIO` | 0.85 | fraction | L | Spec §7: Vte/Vti < 0.85–0.9 [heuristic]; summed over 8 breaths so stacked pairs cancel |
| `DET_SECRETIONS_HP_RMS` | 2.2 | L/min | M | Second-difference RMS of expiratory flow at the device rate (5–20 Hz energy proxy); band-limited sensor noise alone gives ≈ 0.55 [M, tuned] |
| `DET_HIGH_R` | 25 | cmH2O/(L/s) | M | Brief 1 §3.12: Ppeak − Pplat > 10 at 60 L/min [heuristic]; measured from the inspiratory resistive step in VC, 25 keeps the COPD preset (22) below and bronchospasm (≥ 30) above [M] |
| `DET_LOW_C` | 30 | mL/cmH2O | M | Compliance below 30 mL/cmH2O or a > 30% step drop from the breath's own baseline [heuristic] |
| `DET_LOW_C_DROP` | 0.7 | fraction | M | Step drop of least-squares compliance to < 70% of the running baseline (pneumothorax onset) [M] |
| `DET_COUGH_SPIKE` | 15 | cmH2O | M | Alarm-cycled breath whose Paw exceeds the running Ppeak by this much is a cough [M] |
| `DET_RETURN_RATIO` | 0.55 | ratio | M | Expiratory flow back near zero in less than 55% of the time the breath's own fitted τ predicts (τ·ln(Qpeak/1 L/min)): the patient is pulling (premature cycling, reverse trigger) [M] |
| `DET_RETURN_MAX` | 1 | s | M | Early return counts only when expiratory flow is back near zero within 1 s of cycle-off; slower returns (COPD, non-exponential decay) are not effort signatures [M] |
| `DET_RETURN_MARGIN` | 0.3 | s | M | The early return must happen at least this long before the next trigger, otherwise it is the next breath's own inflection [M] |
| `DET_AT_FLOW_RISE` | 12 | L/min | M | Auto-trigger (cardiac): the pre-trigger flow inflection is cardiac-sized (Imanaka 2000: 4.7 ± 1.3 L/min fluctuation), well below an effort ramp (≥ 15) [M] |
| `DET_AT_FAST_LEAD` | 0.3 | s | M | Auto-trigger (cardiac): the inflection is faster than a quarter cardiac cycle plus sensor lag; slow weak efforts take longer [M] |
| `DET_AT_LEAK_FLOW` | 0.5 | L/min | M | Auto-trigger (leak): net flow before the trigger already above zero, i.e. the lung outflow has fallen below the leak; with a leak evident from ΣVte/ΣVti (DET_LEAK_RATIO) the flow crosses the trigger threshold during its own decay, so the criterion is the absence of an effort ramp (DET_AT_FLOW_RISE) rather than a settled baseline [M] |
| `DET_RT_PHASE_TOL` | 0.15 | fraction | M | Brief 1 §3.5 Akoumianaki: reverse-triggered efforts are phase-locked (CV < 5%); candidates within 15% of the running median delay count [M] |
| `DET_DC_TAU_TI` | 1.05 | s | M | PSV: τ·ln(1/ETS) above this predicts cycling well after the neural Ti in obstructive lungs (Tassaux 2005 raised ETS to 70% to fix it) [M] |
| `DET_FS_PTP` | 1 | cmH2O·s | M | VC: Paw pressure–time deficit below the passive prediction (τe from the expiratory decay, R from the resistive step) over inspiration; matches the truth PTP rule (Brief 1 §3.8 "Pmus-time product estimate") [M] |
| `DET_AT_CARDIAC_OSC` | 1 | L/min | M | Auto-trigger (cardiac): regular heart-rate-band flow oscillation before the trigger, measured on a detrended and 0.15 s-smoothed residual (≈ 40% of the raw amplitude; Imanaka 2000: 4.7 ± 1.3 L/min raw in auto-triggering patients) [L/M] |
| `DET_COUGH_SLOPE` | 150 | cmH2O/s | M | Cough: Paw spike rising faster than any ventilator ramp (VC ramps ≈ E·Q ≤ 60 cmH2O/s) [M] |
| `DET_IE_HUMP` | 5 | L/min | M | Inspiratory ineffective effort: flow hump on a decaying pressure-targeted inspiration ≥ 5 L/min [M, Brief 1 §3.1] |
| `DET_DT_RT_TE` | 1 | s | M | A patient trigger within this time after a reverse-triggered machine breath is the stacked breath of that entrained effort [M] |
| `DP_LIMIT` | 15 | cmH2O | V | Brief 2 §3/§6 Amato 2015: ΔP ≤ 15; RR of death 1.41 per SD (~7) increase |
| `DPL_WARN` | 10 | cmH2O | L | Brief 2 §3/§6: ΔPL < 10–12 consensus cutoff (Baedorf Kassis 2016 for the association) |
| `DPL_LIMIT` | 12 | cmH2O | L | Brief 2 §6: ΔPL > 12 concerning |
| `DPL_DYN_LIMIT` | 15 | cmH2O | V | Brief 2 §3 Goligher 2020: dynamic ΔPL (PL,peak − PL,ee) < 15 in assisted breathing |
| `PL_EI_WARN` | 20 | cmH2O | L | Brief 2 §3/§6 EPVent / EPVent-2: end-inspiratory PL ceiling 20–25 |
| `PL_EI_LIMIT` | 25 | cmH2O | L | Brief 2 §6: end-inspiratory PL > 25 concerning |
| `PL_EE_MIN` | 0 | cmH2O | L | Brief 2 §6 EPVent-2: end-expiratory PL 0 to +6; < 0 → collapse risk in the dependent lung |
| `PL_EE_MAX` | 6 | cmH2O | L | Brief 2 §6 EPVent-2 upper target (EPVent used 0–10) |
| `STRAIN_LIMIT` | 1.5 | ratio | V | Brief 2 §3/§6 Protti 2011: injury only above strain 1.5–2 |
| `MP_LIMIT` | 17 | J/min | V | Brief 2 §3/§6 Serpa Neto 2018: > 17 J/min associated with mortality |
| `PPLAT_LIMIT` | 30 | cmH2O | L | Brief 2 §6 ARDSNet-era practice: Pplat ≤ 28–30 |
| `P01_LOW` | 1 | cmH2O | L | Brief 2 §4/§6: P0.1 ≤ 1 low drive |
| `P01_HIGH` | 3.5 | cmH2O | V | Brief 2 §4/§6: P0.1 > 3.5–4 high drive (Telias 2020) |
| `PMUS_LOW` | 5 | cmH2O | L | Brief 2 §6: Pmus 5–10 target |
| `PMUS_HIGH` | 10 | cmH2O | L | Brief 2 §6: Pmus > 10–15 vigorous |
| `DPES_LOW` | 3 | cmH2O | L | Brief 2 §6: ΔPes < 2–3 over-assisted |
| `DPES_HIGH` | 8 | cmH2O | L | Brief 2 §6: ΔPes > 8–12 vigorous |
| `POCC_LIMIT` | -15 | cmH2O | V | Brief 2 §4/§6 Bertoni 2019: ΔPocc more negative than −15 to −20 → excessive effort |
| `PMI_LIMIT` | 6 | cmH2O | V | Brief 2 §4/§6 Bellani 2016: PMI > 6 excessive effort |
| `PTP_LOW` | 50 | cmH2O·s/min | L | Brief 2 §6: PTPes ≤ 50 low effort |
| `PTP_HIGH` | 200 | cmH2O·s/min | L | Brief 2 §6: PTPes ≥ 200 high effort |
| `STRESS_INDEX_T0` | 0.15 | s | M | Brief 2 §2.3: fit the stress index from 0.1–0.2 s after flow onset (after the resistive step) to end-inspiration [L/M] |
| `STRESS_INDEX_FLOW_CV` | 0.1 | fraction | M | Constant-flow eligibility: coefficient of variation of measured inspiratory flow over the fit window below 10 % (square flow with sensor noise ≈ 2 %) [M] |
| `STRESS_INDEX_MIN_WINDOW` | 0.3 | s | M | Minimum fit window for a stress index (≥ 30 samples at 100 Hz) [M] |
| `STRESS_INDEX_LOW` | 0.9 | ratio | V | Brief 2 §2.3/§6 Grasso 2004: b < 0.9 tidal recruitment |
| `STRESS_INDEX_HIGH` | 1.1 | ratio | V | Brief 2 §2.3/§6 Grasso 2004: b > 1.1 overdistension |
| `RI_THRESHOLD` | 0.5 | ratio | V | Brief 2 §2.4/§6 Chen 2020: R/I ≥ 0.5 high recruitability |
| `VT_PBW_LOW` | 4 | mL/kg | V | Spec §8 quiz success: Vt 4–8 mL/kg PBW (ARDSNet 2000) |
| `VT_PBW_HIGH` | 8 | mL/kg | V | Spec §8 quiz success: Vt 4–8 mL/kg PBW (ARDSNet 2000) |
| `SPECIFIC_ELASTANCE_REF` | 13.5 | cmH2O | V | Brief 2 §3/§6 Chiumello 2008: specific lung elastance ≈ 13.5 across groups |
| `QUIZ_PATTERN_MIN_FRACTION` | 0.1 | fraction | M | A pattern counts as present in a quiz window when ≥ 10 % of the breaths (efforts for ineffective effort) carry it [M]; a single labelled breath in a minute is not a teaching target |
| `QUIZ_FIX_WINDOW` | 60 | s | V | Spec §8: success = AI < 10 % over 60 s of simulated time with every safety limit met |
| `QUIZ_TIME_FREE` | 60 | s | M | Time-to-fix below which the time score is full [M] |
| `QUIZ_TIME_SPAN` | 1800 | s | M | Time over which the time score decays linearly from 1 to its floor [M] |
| `QUIZ_CHANGES_FREE` | 3 | setting changes | M | Number of setting changes with a full changes score [M] |
| `QUIZ_CHANGES_PENALTY` | 0.05 | per extra change | M | Score lost per setting change beyond the free ones [M] |
| `QUIZ_FACTOR_FLOOR` | 0.5 | fraction | M | Floor of the time and changes factors [M] |
| `QUIZ_FIX_BAND` | 0.25 | fraction of the recommended step | M | Debrief (D-019): a learner value within 25 % of the recommended step of the recommended value counts as "matched"; the same direction but further away is "partial" [M] |
| `PBW_MALE_INTERCEPT` | 50 | kg | L | Brief 1 §5 ARDSNet 2000: male PBW = 50 + 0.91·(height − 152.4) |
| `PBW_FEMALE_INTERCEPT` | 45.5 | kg | L | Brief 1 §5 ARDSNet 2000: female PBW = 45.5 + 0.91·(height − 152.4) |
| `PBW_SLOPE` | 0.91 | kg/cm | L | Brief 1 §5 ARDSNet 2000 |
| `PBW_HEIGHT_REF` | 152.4 | cm | L | Brief 1 §5 ARDSNet 2000 |
<!-- constants:end -->
