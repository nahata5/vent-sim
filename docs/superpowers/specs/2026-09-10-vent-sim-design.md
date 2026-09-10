# VentSim — Design Spec

**Date:** 2026-09-10 · **Status:** Draft for review · **Audience:** the implementing agent (Fable) and the clinical owner

**Companion research (read these; they are the source of every number in this spec):**
- `docs/research/01-dyssynchrony-vent-logic-realism.md` (Brief 1): lung/Pmus model, ventilator logic, the dyssynchrony catalog, detection algorithms, realism and datasets
- `docs/research/02-pressure-partitioning-lung-stress.md` (Brief 2): partitioned elastance, Ppl/Pes/PL, nonlinear mechanics and recruitment, stress/strain, mechanical power, effort metrics, pendelluft, maneuvers

Confidence tags carried over from the briefs: **[V]** verified against a primary source, **[L]** from the literature but not re-verified, **[M]** a modeling assumption to be tuned.

---

## 1. Purpose and scope

VentSim is a browser-hosted **clinical-education simulator** for mechanical ventilation. It runs a physiologic patient model against a realistic ventilator in real time. Every waveform comes from physics, so changing a setting changes the waveforms the same way it would at the bedside.

Learners should be able to:
1. **See** live pressure, flow and volume waveforms, loops, and monitored values the way a real ventilator shows them.
2. **Look under the hood** at the pressures a bedside clinician can't see directly: alveolar, pleural (by region), esophageal, transpulmonary, muscle, recruitment and strain.
3. **Recognize** dyssynchrony and other waveform patterns. The app auto-labels each breath live, and a quiz mode hides the labels.
4. **Understand** why a pattern is happening: a case-specific mechanism explanation drawn from the simulator's ground truth.
5. **Fix** it by adjusting settings, and see the pattern resolve without breaking lung-protective limits.
6. **Export** labeled waveform data (CSV/JSON), for a single session or a batch.

**v1 modes:** VC-AC, PC-AC, PSV, CPAP. SIMV and PRVC/VC+ are designed for in the interfaces but not built.

**Out of scope for v1:** SIMV and PRVC; real device integration; LLM-generated explanations (all text is templated from ground truth); multi-user or back-end features; pediatric and neonatal patients; NIV masks (except as a leak scenario).

**Disclaimer:** shown in the footer and on first run. VentSim is for education only and is not a medical device or a clinical decision aid.

---

## 2. Core principles (non-negotiable)

1. **Physics first; patterns emerge.** Dyssynchrony comes from the mismatch between an independent patient neural clock and the ventilator's trigger, limit and cycle logic acting on *measured* signals. Draw nothing by hand. Only non-timing phenomena (leak, secretions, water in the circuit, cardiac oscillation, cough, pneumothorax and similar) come from **injector** modules, and injectors still act through the physics: they are terms in the equations, not overlays on the display.
2. **The bedside view is separate from the truth.** The ventilator and detector see only what a real device sees: Paw, flow and volume, sampled at 50/100/200 Hz, with noise, filtering, delay and quantization. They also see its own phase and event markers, and Pes when the "esophageal balloon" option is on. The truth layer (Pmus, Ppl by region, Palv, PL, neural timing, recruitment) is available for teaching and for scoring, but **the detector must never read it**.
3. **Ground truth comes for free.** Every breath gets true labels computed from neural timing against ventilator timing plus the true physiology. These labels grade the quiz, score the detector, and populate exports.
4. **Every constant is cited.** All physiologic constants live in a typed config module. Each has a value, a unit, a source (DOI or brief section), and a confidence tag. Uncertain values stay tunable instead of being chased forever.
5. **Deterministic and reproducible.** A seeded pseudo-random generator (PRNG) drives all stochastic elements. The same seed, scenario and sequence of setting changes must produce identical sample streams. This underpins the tests, the quiz, and exports.
6. **Static hosting.** No back end. Everything runs client-side and deploys to GitHub Pages, Netlify or Cloudflare Pages. Do not rely on SharedArrayBuffer, because static hosts may not allow the COOP/COEP headers it needs.

---

## 3. Architecture

```
┌──────────────────────────── Web Worker: SimEngine ─────────────────────────────┐
│  fixed-step loop, dt = 1 ms physics; runs ahead of wall-clock by a small buffer│
│                                                                                │
│  PatientModel                    Ventilator                  Injectors          │
│  ├─ NeuralDrive (clock, jitter,  ├─ ModeFSM (VC/PC/PSV/CPAP) ├─ Leak            │
│  │   entrainment, CO2 loop)      ├─ Trigger (flow/pressure,  ├─ CardiacOsc      │
│  ├─ Pmus generator (iso + F-V)   │   refractory)             ├─ Secretions      │
│  ├─ ChestWall (Ecw, offset, Pga) ├─ Controllers (flow src,   ├─ CircuitWater    │
│  ├─ Lung: 2 compartments ND/D    │   pressure servo w/ lag)  ├─ Cough           │
│  │   (Venegas or recruitable     ├─ Cycling (time/vol/flow%, ├─ Pneumothorax /   │
│  │   population), viscoelastic   │   Ti_max, P-safety)       │   mainstem / bron-│
│  ├─ Airways: shared ETT (Rohrer) ├─ Maneuvers (holds, P0.1,  │   chospasm       │
│  │   + per-compartment R, EFL    │   Pocc, R/I, PEEP trial)  └─────────────────  │
│  └─ GasExchange (CO2; opt. SpO2) ├─ Alarms                                      │
│                                  └─ SensorChain (filter, delay, noise, quant.)  │
│  TruthRecorder: per-sample truth channels + per-breath ground-truth labels     │
└──────── postMessage: transferable Float32Array batches (~every 16–33 ms) ──────┘
┌──────────────────────────────── Main thread ───────────────────────────────────┐
│  StreamStore (ring buffers, 60–120 s scrollback, breath table)                 │
│  Monitor (per-breath derived values from MEASURED signals, like a real vent)   │
│  Detector (signal-only rule engine → per-breath labels, evidence, AI%)         │
│  Scorer (detector labels vs truth labels → confusion matrices)                 │
│  UI: WaveformCanvas · Loops · SettingsPanel (confirm-to-apply) · MonitorPanel  │
│      LungStressDashboard · TruthLayer toggle · Alarms · TimeControls           │
│  Education: Scenarios · ExplainCards · Quiz · Progress (localStorage)          │
│  Export: session CSV/JSON · BatchGenerator (headless worker, faster than real time) │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Stack:**
- Vite + TypeScript (strict).
- UI: vanilla TS or Preact. No heavy framework.
- Custom Canvas2D rendering for waveforms. Charting libraries can't handle a 60 fps sweep well.
- Tests: Vitest for units, physics and scenarios; Playwright for smoke end-to-end tests.
- CI: GitHub Actions for lint, tests and build, then deploy to Pages.
- Dependencies should be minimal and justified (e.g., a zip library for batch export).

**Messages:**
- **Main → Worker:** `init(scenario, seed)`, `applySettings(partial)` (the ventilator's own state machine decides when changes take effect, as real ventilators do), `setPatient(partial)` (instructor controls), `maneuver(kind)`, `inject(kind, params)`, `setSpeed(x)`, `pause`/`resume`, `runHeadless(spec)`.
- **Worker → Main:** `samples` (device-rate measured channels plus truth channels, as transferable buffers), `breath` (per-breath record with vent events and truth labels), `alarm`, `maneuverResult`.

**Suggested layout:** `src/sim/{patient,vent,injectors,truth,math}`, `src/monitor`, `src/detector`, `src/ui`, `src/edu/{scenarios,cards,quiz}`, `src/export`, `src/config/constants.ts`, `tests/{unit,physics,scenarios,detector}`.

---

## 4. Physiology model (worker)

### 4.1 State and units
- **Internal units:** cmH2O, L, L/s, s. Display units: mL, L/min, and mL/kg PBW.
- **State:**
  - compartment volumes `V_ND`, `V_D`
  - viscoelastic element volume/pressure
  - recruitment unit states (if enabled)
  - neural state
  - ventilator state
  - CO2 state and its delay line
  - injector states
- **Time step:** dt = 1 ms. Use an exact exponential update or RK4 where the equations are stiff or nonlinear (Brief 1 §1.1). The display is decoupled from physics through a fixed-step accumulator.

### 4.2 Partitioned mechanics (Brief 2 §1–2)

**Chest wall, shared:**
`Pcw_rec(Vtot) = Pcw_offset + Ecw·(Vtot − Vref)`
`Pcw_offset` carries the obesity and intra-abdominal-hypertension offset (+5 to +10) [M].

**Pleural pressure per compartment i ∈ {ND, D}:**
`Ppl_i = Pcw_rec(Vtot) + G_i − α_i·Pmus_eff(t) + Pcard(t)`
- `G_i` is the vertical-gradient offset: G_D − G_ND = gradient × height, and the mean is zero.
- `α` is the regional transmission of muscle pressure: 1.0/1.0 in normal lungs; α_D ≈ 1.4 and α_ND ≈ 0.7 in injured lungs [M, Yoshida 2013].

**Lung recoil per compartment:** `PL_i = f_i(V_i)`. Three implementations, all behind one interface:
1. linear `EL_i·V_i` (for tests)
2. Venegas sigmoid inverse
3. recruitable population (§4.3)

**Pressures:**
- Alveolar: `Palv_i = Ppl_i + PL_i`
- Airway: `Paw = P_int + ΔP_ETT(Q_total)` (Rohrer), where `P_int` is the central airway node.

**Compartment flows:**
`V̇_i = (P_int − Palv_i)/R_i`

In expiration, apply the flow-limitation option: `V̇_exp ≤ Qmax(V)` (Brief 1 §1.2).

**Closed-form node solves** (use these; 2–3 Newton iterations handle the Rohrer term):
- **Flow source** (VC, with total airway flow Q imposed):
  `P_int = (Q + Σ Palv_i/R_i) / Σ(1/R_i)`, then `Paw = P_int + ΔP_ETT(Q)`.
- **Pressure source** (PC, PSV, CPAP, expiration): the ventilator imposes `Paw`; solve for Q and P_int together.
- **Holds and occlusion:** Q = 0 at the Y-piece. Compartments can still exchange gas through P_int (pendelluft), and Paw = P_int.

**Viscoelastic (Kelvin) element in series with the lung:** produces the P1→P2 drop during an inspiratory hold (Brief 2 §5) [M τ].

**Functional residual capacity and baseline pressures:** FRC is the volume at which Palv = 0 at zero PEEP. Solve for it at initialization. Ppl0, PL0 and the change in end-expiratory lung volume with PEEP then *emerge* from the model instead of being set.

**Phenotype presets** (Brief 2 Table 1 plus Brief 1 §1.4): normal, pulmonary ARDS, extrapulmonary ARDS, obesity, abdominal hypertension, COPD (Rexp > Rinsp plus flow limitation), asthma, fibrosis.
- Each preset defines EL and Ecw, R, FRC, Pcw_offset, gradient, α, and Venegas or recruitment parameters.
- Presets must reproduce the Table 1 values within tolerance (see §9).

### 4.3 Recruitment and overdistension (Brief 2 §2.2, Model B)

Each compartment holds N = 20–50 units at vertical heights z.
- Each unit sees its own `PL_i(z) = Palv − Ppl(z)`.
- Opening pressure is normally distributed (mode about 20–25 cmH2O in recruitable ARDS); closing pressure is 5–10 cmH2O lower.
- Opening is time-dependent through a Bates–Irvin virtual-trajectory variable.
- Open units stiffen past a strain cap.

What this must produce:
- a best-compliance curve during a decremental PEEP trial;
- tidal recruitment counts;
- a stress index below 0.9 with tidal recruitment and above 1.1 with overdistension;
- R/I from a one-breath PEEP release, with an optional airway opening pressure;
- the Gattinoni 1998 direction of change with PEEP (Ers rises in pulmonary ARDS and falls in extrapulmonary ARDS).

Treat this as a milestone. The Venegas-only mode is the fallback.

### 4.4 Patient effort (Brief 1 §1.3, Brief 2 §4)

**NeuralDrive** runs its own clock. Each breath has an onset, a neural Ti (0.4–2.5 s), an isometric peak Pmus (0–40), a shape (ASL-5000 increase/hold/release percentages or a rounded trapezoid), a relaxation time constant (0.1–0.3 s) and optional expiratory activity (negative Pmus, 2–10).
- **Variability:** AR(1) jitter on Pmax, Ti and rate, each with a coefficient of variation of 10–25%. Occasional sighs and clusters of low-drive breaths.
- **Force–velocity:** `Pmus_eff = Pmus_iso · (1 − k_fv · clamp(V̇_insp/V̇_ref, 0, 1))`, with k_fv ≈ 0.25–0.3 [M]. Calibrate it so that simulated ΔPocc gives the Bertoni k1 of about −0.74 and k2 of about 0.66.
- **Entrainment (reverse triggering):** when enabled (deep sedation, controlled mode, set rate near the intrinsic rate), effort onsets phase-lock to ventilator breath starts plus a delay of 0.2–0.8 s. Ratios are 1:1, 1:2 or 1:3, with less than 5% jitter.
- **Drive inputs:**
  - a sedation/drive slider;
  - an optional CO2 loop (Brief 1 §1.5): `PaCO2_ss = 0.863·VCO2/VA`, first-order with τ of 2–5 min, a 7–15 s chemoreceptor delay, and an apneic threshold. PaCO2 then maps to Pmax and neural rate.
  - an optional Hering–Breuer term.
  - a **time-warp** control (×10–×60) that affects only the CO2 dynamics.
- **Measured effort metrics:** P0.1 and ΔPocc come from maneuvers; ΔPes, PTPes/min and PMI come from Pes and holds. True Pmus, true work, and patient power ∫Pmus·dV are also available.

### 4.5 Esophageal balloon (Brief 2 §1.3)

Pes is a **measurement** of pleural pressure at the balloon's height:
`Pes = k·Ppl(z_eso) + P_offset(+3 supine) + P_ew(fill volume) + Pcard_eso(t)`
- The balloon's fill volume and position are instructor-adjustable, so a badly placed balloon fails the occlusion test (ΔPes/ΔPaw outside 0.8–1.2) naturally.
- Show direct PL (Paw − Pes) and elastance-derived PL (Pplat × EL/Ers) side by side. Direct PL maps to the dependent compartment and elastance-derived PL to the non-dependent compartment (Yoshida 2018).

### 4.6 Gas exchange
- **v1:** the CO2 model only.
- **Stretch goal:** SpO2 from FiO2, the fraction of open units (shunt) and mean Paw, using a simple monotone mapping [M]. Clearly label it as schematic.

---

## 5. Ventilator (worker; Brief 1 §2)

**Mode state machine:**
- `EXP → (after refractory) → trigger (patient | time) → INSP (rise → target) → cycle → [PAUSE] → EXP`
- Hold and occlusion states can be entered at the next eligible phase.

**Settings:**

| Group | Settings |
|---|---|
| Common | PEEP, FiO2, trigger type (flow 0.5–10 L/min or pressure 0.5–5 cmH2O), bias flow, alarm limits, apnea time and backup |
| VC | Vt, RR, peak flow or Ti, flow pattern (square or descending ramp to X%), inspiratory pause |
| PC | ΔPinsp, Ti, RR, rise time |
| PSV | PS, rise time, ETS 5–80%, Ti_max |
| CPAP | PEEP, with optional PS 0 |

**Behavior:**
- **Trigger:** evaluated on **measured** signals, with a refractory period of 150–300 ms [M; vendor-specific; exposed as an advanced setting]. Actuator latency 20–50 ms.
- **Flow control:** VC is an ideal flow source, optionally with circuit compliance.
- **Pressure control:** PC, PSV and CPAP use a pressure servo with a first-order lag (20–50 ms) and a small source resistance. Paw therefore sags when demand is high and overshoots when the rise time is short.
- **Exhalation valve:** a PEEP threshold plus valve resistance.
- **Cycling:** by time, by volume plus pause, by flow percentage (ETS), by Ti_max, or by a pressure safety limit (Paw above target + 3). A high-pressure alarm also cycles the breath off.
- **Leak compensation:** optional, off by default.
- **Settings UX:** as on real ventilators, a changed setting is "pending" until the user confirms it. Rate, volume and pressure changes take effect from the next breath.
- **Alarms (Brief 1 §2.6):** high Ppeak, low Vte, high and low Ve, apnea, high RR, disconnect or low PEEP, high leak, Ti_max reached, high intrinsic PEEP. Alarms are audible (mutable) and visual, with a silence button.
- **Sensor chain:**
  - physics at 1 kHz;
  - first-order low-pass filter (10–30 ms), 10–30 ms delay, band-limited noise (pressure SNR about 15 dB, flow about 30 dB), quantization;
  - resample to the device rate (50/100/200 Hz, default 100).
  - Vte and Vti are integrated from the measured flow, so leak and drift behave realistically.
- **Maneuvers:**
  - inspiratory hold (0.3–2 s; P1 and P2)
  - expiratory hold (2–4 s; total PEEP and intrinsic PEEP)
  - P0.1 occlusion
  - ΔPocc (a whole-breath occlusion, which uses the isometric Pmus)
  - occlusion test (only when the balloon is on)
  - R/I (one-breath PEEP release, 15 → 5)
  - decremental PEEP trial (automated steps; records Crs, ΔP, PL and power at each PEEP)
  - stress index (automatic fit on passive, constant-flow VC breaths)

---

## 6. Monitoring, lung-stress dashboard, and truth layer

**Monitor panel** (from measured signals only, like a real ventilator): Ppeak, Pplat (after a hold), mean Paw, total PEEP and intrinsic PEEP, ΔP, Cstat, Cdyn, Raw, Vti, Vte, Ve, total RR, I:E, Ti, leak %, RSBI, P0.1, and a rolling asynchrony index (AI%).

**Lung-stress dashboard.** Each value sits on a color band from the Brief 2 §6 threshold table and has a tooltip citing its source.

| Metric | Thresholds |
|---|---|
| Driving pressure | ≤ 15 |
| Transpulmonary driving pressure (ΔPL) | < 10–12 |
| End-inspiratory PL | < 20–25 |
| End-expiratory PL | 0–6 |
| Strain (Vt/EELV) | < 1.5 |
| Mechanical power | < 17 J/min; show the truth value (∫Paw·dV) and a bedside surrogate (Gattinoni simplified / Giosa / Becher) |
| Stress index | 0.9–1.1 |
| R/I | reported value |
| ΔPes | 3–8 |
| Pmus | 5–10 |
| P0.1 | 1–3.5 |
| ΔPocc | above −15 |
| PMI | ≤ 6 |
| PTPes | 50–200 /min |
| Vt | in mL/kg PBW (ARDSNet PBW formula) |

**Truth layer** (a toggle labeled "What the bedside sees ↔ what's really happening"):
- **Extra waveform channels:** Pmus (true), Palv, Ppl_ND and Ppl_D, Pes (as measured), PL_ND and PL_D, and compartment flows. Pendelluft is highlighted when V̇_ND < 0 < V̇_D.
- **Extra loops:** a PL–V loop per compartment and a Campbell diagram.
- **Readouts:** true strain, lung power, recruited and tidally recruited volume, and neural-versus-ventilator timing bars drawn on the waveform (neural Ti shown as a shaded band).

---

## 7. Dyssynchrony and pattern catalog

For every pattern the spec needs:
- **how it emerges:** scenario conditions;
- **truth rule:** the ground-truth labeler;
- **detector rule:** signal-only;
- **fixes:** what the explain card and quiz accept.

Full signatures and citations are in Brief 1 §3.

| Pattern | Emerges when | Truth rule (labeler) | Detector rule (signal-only; starting thresholds) | Fixes |
|---|---|---|---|---|
| Ineffective effort, expiratory or inspiratory | Weak Pmax (2–6) + intrinsic PEEP (COPD τ, short Te), over-assist, insensitive trigger, effort in the refractory period | Neural onset with no trigger within the effort | Expiratory flow deflection toward zero ≥ 5.45 L/min, or Paw dip ≥ 0.45 cmH2O, with no breath (Chen 2008); BetterCare-style score | ↓PS or Vt, ↓Ti or ↑ETS, ↑trigger sensitivity, ↓sedation, PEEPe to 70–85% of intrinsic PEEP in flow limitation |
| Auto-trigger | Cardiac oscillation with low R and a sensitive flow trigger; expiratory leak; water in circuit | Trigger with no neural effort | Trigger with no preceding Paw dip ≥ 0.5 or flow inflection; power in the heart-rate band; rate above set | ↑trigger threshold or pressure trigger, fix the leak or leak compensation, drain the circuit |
| Delayed trigger | Intrinsic PEEP, weak effort, insensitive trigger | Neural onset to trigger > 250 ms | Deep or long pre-trigger Paw dip; Mojoli timing method | As for ineffective effort |
| Double trigger / breath stacking | Neural Ti > vent Ti (VC with short Ti or high flow, low Vt with high drive), premature cycling | Two vent cycles within one neural effort | Te < ½ mean Ti with the first breath triggered (Thille); stacked volume ≥ 2 mL/kg above set (BREATHE) | ↑Ti or pause, ↓flow, ↑Vt if ΔP allows, switch to PC/PSV, ↓ETS, treat the drive |
| Reverse trigger (± stacking) | Entrainment in deep sedation with a controlled mode | Neural onset after a machine-triggered breath with a stable phase | Mid- or late-inspiratory Paw dip in VC, or a flow hump in PC, in a time-triggered breath; low phase CV; Baedorf-Kassis rules | Change RR, lighten sedation, PSV, neuromuscular blockade as a last resort |
| Premature cycling | Low τ (ARDS or fibrosis) with high ETS; set Ti below neural Ti | Cycle more than 100 ms before neural offset | Early-expiratory flow notch or reversal; Paw below PEEP after cycling; short Ti | ↓ETS, ↑PS or Ti |
| Delayed cycling | High τ (COPD), high PS, low ETS, leak | Cycle more than 300 ms after neural offset | End-inspiratory Paw rise > 2 above target; flow "shoulder"; long Ti | ↑ETS (40–70% in COPD), ↓PS, ↓Ti_max, fix the leak |
| Flow starvation | VC with peak flow 30–45 L/min and Pmax 10–20 | Pmus active during VC inspiration above a threshold PTP | Concave ("scooped") Paw ramp; deficit area against passive Paw predicted from fitted R and C | ↑flow, ↓Ti, PC/PSV, treat the drive |
| Overshoot / excess flow | Short rise time or very high flow | Paw > target + 3 in the first 200 ms | Same, from measured Paw | ↑rise time, ↓flow |
| Auto-PEEP / dynamic hyperinflation | Te < 3–5 τE | True end-expiratory Palv > PEEP + 1 | End-expiratory flow ≠ 0 (above 2–5 L/min at trigger) | ↓RR, ↓Vt, ↑flow, bronchodilator |
| Leak | Leak injector | Leak volume > 10% | Vte/Vti < 0.85 to 0.9; volume doesn't return to zero; loops don't close | Fix the leak or leak compensation |
| Secretions / water | Injector | Injector active | Sawtooth or oscillation energy in 5–20 Hz on expiratory flow | Suction or drain |
| ↑Resistance (bronchospasm, kink) | Injector or preset | R above baseline | Ppeak − Pplat ↑ (> 10 at 60 L/min square flow) | Bronchodilator, check the tube |
| ↓Compliance (pneumothorax, mainstem, abdominal hypertension) | Injector | C_rs drop | Ppeak and Pplat both ↑, ΔP ↑; in PC, Vt ↓ | Clinical fix (the card explains) |
| Cough | Injector | Injector active | Paw spike with a high-pressure alarm and an aborted breath | None needed |

**Additional truth-only teaching findings:** pendelluft, tidal recruitment, overdistension, high ΔPL,dyn/P-SILI risk, and high or low effort (from Goligher 2020 targets).

**Asynchrony index:** AI = asynchronous events / (ventilator cycles + ineffective efforts) × 100. AI > 10% is severe. Also show a "cluster" flag for more than 30 ineffective efforts in 3 minutes.

---

## 8. Education layer

**Scenarios** are JSON: patient phenotype, settings, drive, injectors, seed, learning objectives, target patterns, and success criteria. Launch library (at least 18):
1. Healthy post-op, passive VC (baseline)
2. ARDS on 6 mL/kg VC with high drive → double trigger and flow starvation
3. ARDS deep sedation → reverse trigger (1:1, then 1:2)
4. COPD on PSV with high PS and low ETS → delayed cycling, intrinsic PEEP, ineffective efforts
5. COPD, high RR in VC → dynamic hyperinflation
6. Fibrosis on PSV with high ETS → premature cycling → double trigger
7. Post-cardiac-surgery sensitive flow trigger with low R → auto-trigger
8. Leak (cuff) on PSV → delayed cycling and auto-trigger
9. Secretions (sawtooth)
10. Bronchospasm (↑R) vs pneumothorax (↓C): peak vs plateau reasoning
11. Mainstem intubation
12. Obese patient: high Pplat but safe PL (esophageal balloon on)
13. Pulmonary vs extrapulmonary ARDS PEEP trial (recruiter vs non-recruiter; R/I)
14. Strong effort in ARDS on PSV → P-SILI risk: normal ΔP but high ΔPL,dyn and pendelluft (truth layer)
15. Over-assist → low PaCO2 → ineffective efforts and apnea (CO2 loop with time warp)
16. Under-assist → rising drive (CO2 loop)
17. Esophageal balloon underfilled or misplaced → failed occlusion test
18. Mixed: a "find all the problems" capstone

**Explain cards** (one per pattern) cover definition, mechanism, signature (annotated mini-waveform), causes, ranked fixes, pitfalls and citations. When a card opens during a session, it adds **case-specific evidence from the truth layer**, e.g., "Neural Ti 1.32 s vs ventilator Ti 0.70 s; effort still at 6.1 cmH2O at cycle-off." The text is templated with no LLM.

**Quiz mode:**
1. Labels are hidden. The learner identifies the patterns, either by tagging breaths or picking from a list, and is graded against truth.
2. The learner then fixes the problem by changing settings. **Success** means AI < 10% over 60 s of simulated time **and** all of: ΔP ≤ 15, Pplat ≤ 30, Vt 4–8 mL/kg PBW, and no new severe alarms. Scenario-specific extras are allowed (e.g., PL,ee ≥ 0).
3. Scoring counts accuracy, time and number of setting changes.
4. Progress and history are stored in localStorage, wrapped in try/catch.

**Instructor mode:** exposes the patient controls (R, C, EL/Ecw, drive, Pmax, neural Ti and rate, sedation, entrainment, injectors) and a scenario editor with JSON export and import.

---

## 9. Validation and testing (required; this is how "done" is judged)

1. **Analytic physics tests** (Brief 1 §5, Brief 2):
   - passive PC Vt = C·ΔP·(1 − e^(−Ti/τ)) within 2%;
   - passive VC Ppeak − Pplat = R·Q;
   - mass balance: ∫insp − ∫exp = ΔEELV + leak;
   - steady-state intrinsic PEEP matches the e^(−Te/τ) prediction;
   - with no Pmus and no noise, no triggers fire and AI = 0.
2. **Partition tests:**
   - with passive preset Table 1 values, ΔPL/ΔPaw = EL/Ers;
   - obesity preset gives a high Ppl0 and negative PL,ee at PEEP 5;
   - specific lung elastance (PL/strain) is about 13.5 ± 2 across presets (Chiumello 2008);
   - Gattinoni 1998 PEEP direction: pulmonary ARDS Ers ↑, extrapulmonary ARDS Ers ↓;
   - the hold shows a P1 − P2 drop.
3. **Effort calibration:**
   - simulated ΔPocc → Pmus gives k1 = −0.74 ± 0.05 and k2 = 0.66 ± 0.05 (Bertoni 2019);
   - P0.1 equals true Pmus at 100 ms under occlusion;
   - a well-placed balloon passes the occlusion test (0.8–1.2) and a misplaced or underfilled one fails.
4. **Emergence matrix (scenario tests):** for each scenario, a headless run for N breaths must give:
   - (a) the target truth pattern in at least the specified fraction of breaths;
   - (b) after the scripted "fix", AI < 10% within 60 s;
   - (c) no pattern appears in the passive baseline scenario.
5. **Detector scoring** against truth, on a held-out batch grid (seeds, phenotypes, settings) the detector was **not** tuned on:
   - sensitivity ≥ 0.85 and specificity ≥ 0.90 for ineffective effort, double trigger, auto-trigger, premature and delayed cycling, and flow starvation;
   - ≥ 0.75 / 0.90 for reverse trigger.
   
   Publish a confusion matrix per pattern in a **Validation page** in the app, alongside the analytic-test results.
6. **Determinism:** the same seed and inputs give byte-identical sample streams.
7. **Performance:** at 1× speed, the worker uses less than 25% of one core on a mid-range laptop. The UI holds 60 fps with 6 waveform channels and 2 loops. Headless batch runs at least 50× real time.
8. **End-to-end smoke tests (Playwright):** the app loads; a scenario starts; a setting is changed and confirmed, and the waveform changes; a quiz completes; an export downloads.

---

## 10. Export

- **Session CSV:** time, measured Paw/flow/volume (device rate), breath_id and phase, plus optional truth channels (Pmus, Palv, Ppl_ND and Ppl_D, Pes, PL_ND and PL_D).
- **Session JSON:** scenario, seed, settings timeline, per-breath monitored values, truth labels, detector labels with evidence, and maneuver results.
- **BatchGenerator:** define a grid (scenarios × seeds × setting perturbations), run it headless in a worker, and download a zip. It is a direct source of labeled synthetic datasets.
- **Browser sandbox:** downloads use Blob plus an anchor. If the host sandbox blocks downloads, fall back to copy-to-clipboard.

---

## 11. UI

- **Look:** a generic ICU-ventilator style with a dark waveform screen. It must not imitate any vendor's branding or layout.
- **Layout, desktop/tablet first:**
  - left: mode and settings (pending → confirm);
  - center: 3–6 sweep waveforms with the truth channels optional, plus event markers and breath labels as small badges above each breath;
  - right: monitor values, lung-stress dashboard, alarms;
  - bottom drawer: loops, explain card, quiz controls.
- **Time controls:** pause, freeze and scroll back 60–120 s with a cursor readout of all channels at time t, and a speed control (0.25–4×).
- **Accessibility:**
  - color is never the only encoding; badges carry text;
  - keyboard operable;
  - light and dark themes are optional, but the waveform screen stays dark.

---

## 12. Milestones (build order; each ends with green tests, a short demo note in `PROGRESS.md`, and a deploy)

| # | Milestone | Exit criteria |
|---|---|---|
| M0 | Scaffold: Vite/TS strict, lint, Vitest, Playwright, CI + Pages deploy, seeded PRNG, `constants.ts` with a citation schema | CI green; a blank app deploys |
| M1 | Passive single-compartment core; VC/PC fixed timing; headless runner | §9.1 analytic tests pass |
| M2 | Partitioned 2-compartment lung + chest wall + Ppl/Palv/PL + viscoelastic + Venegas; presets; insp/exp holds; truth channels | §9.2 partition tests pass |
| M3 | Full ventilator state machine: triggers, refractory, PSV/CPAP, servo lag, rise, cycling, alarms, apnea backup, sensor chain, monitor values | Trigger/cycle unit tests; monitor values match analytic expectations |
| M4 | Neural drive + Pmus (iso + F–V), jitter, entrainment, expiratory muscles; P0.1, ΔPocc, PMI, balloon model + occlusion test | §9.3 calibration tests pass; first emergent patterns seen in headless runs |
| M5 | Live UI v1: worker streaming, sweep waveforms, loops, settings confirm, monitor, lung-stress dashboard, truth-layer toggle, time controls | Playwright smoke passes; 60 fps budget met |
| M6 | Ground-truth labeler, injectors, detector, AI, scorer + Validation page | §9.4 emergence matrix and §9.5 detector targets met |
| M7 | Recruitable-population lung, PEEP trial, stress index, R/I, mechanical power; CO2 loop + time warp | Gattinoni/stress-index/R/I tests pass; CO2 over/under-assist scenarios behave as expected |
| M8 | Education: scenario library (≥18), explain cards, quiz, instructor mode, progress; session + batch export | All scenarios pass the emergence matrix; quiz end-to-end test passes |
| M9 | Hardening: performance, accessibility, docs (README, MODEL.md with equations and citations, VALIDATION.md), known-limitations list | Every §9 item green; deployed URL |

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Numerical stiffness** from low-R compartments or Rohrer terms | 1 ms step, closed-form node solves, Newton on the Rohrer term, and tests that sweep extreme presets. |
| **Uncertain constants** (refractory period, ETT K1/K2, viscoelastic τ, CO2 gains) | Keep them in config with confidence tags; calibrate to the published anchors in §9. Do not block on precision. |
| **A detector that overfits synthetic data** | Tune on one seed and phenotype grid and score on a disjoint one. Evidence must be shown per label. |
| **Scope creep** | The milestones are ordered so that M1–M6 alone is already a useful teaching tool. Recruitment, CO2 and quiz sit on top. |
| **Clinical accuracy** | Every explain card and threshold cites its source; the clinical owner reviews the card text before the M8 exit. |
