# Research Brief 1 — Dyssynchrony, Ventilator Logic, Synthetic Realism (compiled 2026-09-10)

# Research Brief: Physiology-Driven Browser Ventilator Simulator with Emergent Dyssynchrony

*Scope: model equations, ventilator logic, dyssynchrony signatures and detection criteria, realism parameters, datasets, reference implementations, guardrails. Most citations come from PubMed (metadata and abstracts pulled this session) and are linked by DOI. Anything marked **[unverified]** comes from background knowledge and was not re-checked this session. Anything marked **[uncertain]** is an estimate or depends on the vendor.*

---

## 0. Architecture recommendation (TL;DR for the spec)

1. **Two separate processes, coupled only through physics.**
   - A *patient* process: lung mechanics plus a neural Pmus generator with its own clock, drive and jitter.
   - A *ventilator* process: a state machine that sees only **measured** Paw and flow (after noise, filtering, delay and cardiogenic artifact), never the true Pmus.
   
   Dyssynchrony then *emerges* from mismatched timing and thresholds. Ground-truth labels come from comparing neural timing to ventilator timing, which is the approach van Diepen et al. used to generate annotated PSV waveforms ([DOI](https://doi.org/10.1007/s10877-022-00822-4)).
2. **Integrate at a fixed 1 kHz (dt = 1 ms)** with a fixed-step accumulator decoupled from `requestAnimationFrame`. Downsample to the "device" rate (50/100/200 Hz, selectable) for display, detection and export.
3. **Track volume relative to the relaxation volume (Vr), not EELV.** Intrinsic PEEP, trapped volume and the effort needed to trigger then fall out of the physics instead of being parameters.
4. **Two detection layers:**
   - a ground-truth labeler that knows the neural timing;
   - a waveform-only detector implementing published rules (Thille, Chen, BetterCare-like, BREATHE, Mojoli).
   
   Scoring layer 2 against layer 1 gives you a built-in validation harness.

---

## 1. Physiologic model

### 1.1 Single-compartment equation of motion

Sign convention: Pmus ≥ 0 means inspiratory muscle pressure (it lowers pleural pressure). Pmus < 0 means expiratory muscle activity.

```
Paw(t) + Pmus(t) = E·V(t) + R·V'(t)          (V measured from relaxation volume Vr; E = 1/C)
Palv(t) = E·V(t) − Pmus(t)
V'(t)   = (Paw(t) − Palv(t)) / Rtot
```

This matches your form, `Paw + Pmus = V/C + R·V' + PEEPtot`. The only difference is that V there is measured from EELV. At end-expiration, `Palv_ee = E·V_ee` equals total PEEP, and `PEEPi = PEEPtot − PEEPset`. This is exactly what an end-expiratory hold measures.

**Resistance terms (Rtot):**
- **Patient airway R:** linear, or Rohrer form `R = K1 + K2·|V'|`.
- **Endotracheal tube (ETT):** Rohrer, `ΔP_ETT = K1·Q + K2·Q·|Q|`. Flow has a closed-form solution for a given ΔP:
  `Q = sign(ΔP)·(−K1 + √(K1² + 4·K2·|ΔP|)) / (2·K2)`.
  Pressure drop across small ETTs is strongly flow-dependent and nonlinear; Rohrer approximation predicts tracheal pressure well, and adding inertance improves it for small tubes ([Spaeth 2015](https://doi.org/10.1111/pan.12595); [Hentschel 2011](https://doi.org/10.1088/0967-3334/32/9/007)). Adult K1/K2 constants for 7–8 mm tubes should be taken from Guttmann's tables **[uncertain: no verified values]**. As a rough target, a 7.5–8 mm ETT should add about 4–8 cmH2O/L/s at 1 L/s **[uncertain]**.
  - Note: Arnal's intubated patient resistances (below) already **include** the ETT. Do not add the ETT on top of those values.
- **Circuit compliance:** about 1–3 mL/cmH2O **[uncertain, circuit-dependent]**. Include it if you want Vt compensation to matter.

**Discrete-time integration:**
- **Pressure-source phases** (PC, PS, CPAP, expiration): Paw is known, so solve for V'.
  - For linear R and piecewise-constant inputs, the exact update is:
    `V_{n+1} = V_ss + (V_n − V_ss)·e^{−dt/τ}`, with `V_ss = C·(Paw + Pmus)` and `τ = R·C`.
  - With nonlinear Rohrer terms, use RK4 or semi-implicit Euler at dt = 1 ms.
  - Forward Euler is stable for dt < 2τ. For accuracy, keep dt ≤ τ/20. The smallest realistic τ (ARDS, about 0.3–0.46 s) gives a limit of about 15–20 ms, so 1 ms leaves a large margin, and 17 steps per 60 fps frame is trivial.
- **Flow-source phases** (VC): V' = Qset(t) is imposed, and Paw is algebraic:
  `Paw = E·V − Pmus + R·Q (+ ΔP_ETT(Q))`.
  This single line is where flow starvation ("scooping") comes from: patient effort subtracts directly from Paw.
- **Ventilator pressure servo realism:** model the pressure generator as a target plus a finite-bandwidth controller, e.g. PI with a 20–50 ms effective lag **[uncertain]**, or as a source with a small internal resistance. Paw then droops when patient demand is high and overshoots with fast rise settings.

### 1.2 Two-compartment and viscoelastic options — when they are worth it

| Add-on | What it produces | Worth it when |
|---|---|---|
| **Viscoelastic (Kelvin) element**: Rve–Cve in series, parallel to the elastic element | P1→P2 pressure decay during an inspiratory hold, i.e. a realistic plateau "sag" over 0.5–2 s **[τ uncertain]** | You want realistic Pplat and hold-maneuver teaching. Recommended; van Diepen's model includes it. |
| **Two parallel compartments** (R1C1, R2C2; Otis-style) | Time-constant inhomogeneity, frequency dependence of compliance, biphasic expiratory flow, pendelluft | COPD (fast and slow units), asymmetric disease, pendelluft from spontaneous effort in ARDS (Yoshida AJRCCM 2013 **[unverified]**) |
| **Nonlinear P–V** (sigmoid, Venegas) | Upper and lower inflection points, overdistension "beaking" | Teaching recruitment and overdistension, PEEP titration |
| **Collapsible-airway / expiratory flow limitation** | Flow waterfall: PEEPe below a critical value does not raise EELV | COPD/asthma with PEEPi and the "add PEEPe to overcome ineffective efforts" lesson |

van Diepen's lung (adapted from Athanasiades) is a good template. It combines a Rohrer upper airway, collapsible-airway R and C as sigmoids of transmural pressure, small-airway R, an exponential alveolar P–V curve, and a Kelvin viscoelastic body, with the ETT modeled by Rohrer (9 mm) ([DOI](https://doi.org/10.1007/s10877-022-00822-4)).

**Simple expiratory flow limitation (EFL) implementation:**
```
Q_exp = min( (Palv − Paw)/R ,  Qmax(V) ),   Qmax(V) = k_EFL · max(0, V − V_close)
```
This reproduces the flat, "scooped" expiratory flow-volume loop and PEEPi that does not respond to PEEPe until PEEPe exceeds the critical value.

### 1.3 Respiratory muscle pressure (Pmus) generator

Implement one "neural breath" object per effort:
`{t_onset, Ti_neural, Pmax, riseShape, relaxTau, expiratoryActivity}`

These run on the patient's own clock (neural RR plus jitter), independent of the ventilator, unless entrainment is enabled (see §3.5).

**Published waveform families:**

1. **ASL 5000 (IngMar) modified sinusoid.** Parameters: frequency, Pmax, *Increase %* (time to Pmax as a percentage of the total cycle), *Hold %*, and *Release %* (time back to zero) ([Liu & Chatburn 2022](https://doi.org/10.4187/respcare.09729); [ASL 5000 manual](https://www.ingmarmed.com/wp-content/uploads/2020/04/80-31-760-Rev.-2-ASL-5000-User%E2%80%99s-Manual.pdf)). This is the de facto bench standard, so exposing these four parameters makes your scenarios comparable to bench literature. Plausible defaults at RR 20: Increase 20–25%, Hold 0–5%, Release 10–15% **[uncertain; not sourced]**.
2. **Albanese 2016, parabolic inspiration plus exponential relaxation** ([Albanese, AJP Heart 2016, PMID 26683899](https://pubmed.ncbi.nlm.nih.gov/26683899/); reused by [Jin 2025](https://doi.org/10.3389/fphys.2025.1699315), which confirms Ti = 0.375·T):
   ```
   0 ≤ t ≤ TI:    Pmus(t) = −(Pmin/(TI·TE))·t² + (Pmin·T/(TI·TE))·t
   TI < t ≤ T:    Pmus(t) = Pmin/(1−e^{−TE/τ}) · (e^{−(t−TI)/τ} − e^{−TE/τ})
   T = 60/RR, TI = 0.375·T, TE = T − TI, τ = TE/5
   ```
   The functional form is from my recollection of Albanese. It is continuous at TI and T, which is consistent. **Verify against the original [unverified exact form and τ].**
3. **van Diepen rounded trapezoid** (different rise and fall slopes), with parameter sets per class ([DOI](https://doi.org/10.1007/s10877-022-00822-4)):

   | Class | Amplitude (cmH2O) | Rise (s) | Fall (s) |
   |---|---|---|---|
   | Normal | 5–10 | 0.5–0.7 | 0.25–0.35 |
   | Early (premature) cycling | 5–10 | 0.7–0.9 | 0.25–0.35 |
   | Late (delayed) cycling | 5–10 | 0.5–0.7 | 0.25–0.35 (with a high cycle-off threshold setting) |
   | Delayed triggering | 3.5–4.5 | 0.7–0.9 | 0.25–0.35 |
   | Ineffective effort | 1.7–2.2 | 0.4–0.6 | 0.4–0.6 |

   They superimpose a 0.25–1 cmH2O sine at 1–2 Hz to mimic cardiac oscillation.
4. **Yamada & Du 2000**: Pmus with a relaxation time constant. Its key analytic result is the basis for the cycling physics (see §3.6–3.7): the ratio of flow at the end of neural inspiration to peak flow, V'(TI)/V'peak, is governed mainly by **τ_rs/TI** (sigmoidal) and secondarily by **Pps/Pmus_max**, and ranges from 1% to 85% in adult mechanics. So any fixed cycle-off threshold will be early in some patients and late in others ([DOI](https://doi.org/10.1152/jappl.2000.88.6.2143)).

**Recommended parameter ranges for your generator:**
- **Pmax:**
  - quiet or appropriately assisted: 5–10 cmH2O
  - distressed or high drive: 15–25 cmH2O
  - extreme: up to about 30–40 **[upper bound uncertain]**
  - weak or over-assisted: 1–4
- **Neural Ti:** 0.6–1.5 s (a high-drive ARDS patient on 6 mL/kg often has neural Ti longer than the ventilator Ti). Neural RR: 10–40.
- **Relaxation:** exponential, τ ≈ 0.1–0.3 s **[uncertain]**.
- **Expiratory muscles:** optional negative Pmus (expiratory) of 2–10 cmH2O late in expiration, for active expiration, COPD and delayed-cycling "fighting" **[amplitude uncertain]**.
- **Drive index:** P0.1 is Pmus at 100 ms after onset, so it can be computed directly from your waveform. Telias 2020: P0.1 > 3.5 cmH2O detected high effort (PTP ≥ 200 cmH2O·s/min) with 80% sensitivity and 77% specificity; P0.1 ≤ 1.0 detected low effort with 100% sensitivity and 92% specificity ([DOI](https://doi.org/10.1164/rccm.201907-1425OC)). Show P0.1 as a monitored value.

### 1.4 Lung mechanics presets

**Arnal 2018** (passive, intubated adults, n = 359; R includes the ETT) ([DOI](https://doi.org/10.4187/respcare.05775)):

| Condition | Cstat (mL/cmH2O), median [IQR] | Rinsp (cmH2O/L/s) | τE (s) |
|---|---|---|---|
| Normal lungs | 54 [44–64] | 13 [10–15] | 0.60 [0.51–0.71] |
| ARDS | 39 [32–50] | 12 [9–14] | 0.46 [0.40–0.55] |
| COPD | 59 [43–75] | 22 [16–33] | 1.07 [0.68–2.14] |

ARDS severity (mild, moderate, severe) did not change the mechanics significantly.

**van Diepen 2022** (lung only; ETT modeled separately, so R values are lower):

| Condition | Rinsp | Rexp | Ctot (mL/cmH2O) |
|---|---|---|---|
| Healthy | 3±1 | 3±1 | 150±50 |
| Obese | 7±1 | 7±1 | 60±10 |
| ARDS | 6.3±1 | 6.3±1 | 44±4 |
| COPD | 6.5±2.5 | **14±6** | 165±30 |
| Fibrosis | 2.1 | 2.1 | 29 |

COPD is the one preset with **Rexp > Rinsp** ([DOI](https://doi.org/10.1007/s10877-022-00822-4)).

**Extra presets [uncertain, clinical convention]:**
- Severe ARDS: C 15–30.
- Status asthmaticus: R 30–60 plus EFL, with PEEPi 10–20 at inappropriate settings.
- Obesity: reduced chest-wall compliance. Consider a separate chest-wall elastance with a positive pleural-pressure offset, so that Pplat is high but transpulmonary pressure is not.
- Kaggle/Google Brain bench grid (for sanity checks): R ∈ {5, 20, 50}, C ∈ {10, 20, 50} **[values from memory, verify]**.

**Leak:** use an orifice model, `Q_leak = k_L·√max(Paw, 0)`, or a linear model. It is active in both phases.
- Leak% = (Vti − Vte)/Vti.
- Leak during expiration shifts baseline flow and can mimic a flow trigger (auto-triggering, §3.2).

### 1.5 Neural timing and an optional CO2 → drive loop

- **Neural vs ventilator timing.** The patient's neural Ti and onset are independent of the ventilator. Every trigger or cycle mismatch is the difference between the two clocks, filtered through mechanics and thresholds. That is the whole trick for emergence.
- **Minimal CO2 loop** [structure standard; constants **uncertain**]:
  ```
  VA = RR_total·(Vt − VD),  VD = 2.2 mL/kg PBW anatomic + apparatus (HME/ETT ~ 50–100 mL); in ARDS use VD/VT 0.5–0.7
  PaCO2_ss = 0.863·VCO2 / VA        (VCO2 ≈ 200–250 mL/min STPD, VA in L/min BTPS)
  dPaCO2/dt = (PaCO2_ss − PaCO2)/τ_CO2,  τ_CO2 ≈ 2–5 min (lumped body stores; true system is multi-compartment)
  Chemoreceptor delay: 7–15 s transport lag
  Drive D = clamp(D0 + G·(PaCO2_delayed − 40), 0, Dmax) → Pmax = f(D), neural RR = g(D)
  Apneic threshold ≈ 3–5 mmHg below eupneic PaCO2 → central apnea → backup ventilation
  ```
  Using a normal CO2 response of about 1–3 L/min/mmHg to set G gives realistic loop gain. Khoo-type loop-gain models explain periodic breathing (Khoo, J Appl Physiol 1982 **[unverified DOI]**).
- **What this loop produces:**
  - over-assist (high PS or Vt) → low PaCO2 → low drive → ineffective efforts and apneas;
  - under-assist → high drive → double triggering and flow starvation.
  
  Add a time-warp control (×10–×60) so students can see the minutes-scale CO2 response.
- **Optional Hering-Breuer term:** shorten neural Ti when V exceeds a threshold. This models volume feedback and the reduced drive seen at high Vt.

---

## 2. Ventilator modes and machine logic

Taxonomy reference: Chatburn's 10 maxims (control variable, breath sequence, targeting scheme) ([DOI](https://doi.org/10.4187/respcare.03057)). Pulse Engine's generalized ventilator data model is a good software pattern: one parameterized ventilator whose modes are presets ([methodology](https://pulse.kitware.com/_mechanical_ventilator_methodology.html)).

### 2.1 Core state machine

```
EXPIRATION → (trigger window open after refractory) → [patient trigger | time trigger] → INSPIRATION(rise → target)
INSPIRATION → [cycle: time | volume | flow% | pressure-safety | Ti_max] → [PAUSE if set] → EXPIRATION
```

**Trigger:**
- *Flow trigger:* (inspiratory-limb flow − expiratory-limb flow) > threshold, typically 1–5 L/min (default about 2–3). Bias flow is 2–10 L/min **[vendor-specific]**.
- *Pressure trigger:* Paw < PEEP − threshold, typically 0.5–2 cmH2O.
- Evaluate on the **measured** signals.
- Add a **refractory/lockout period** after cycling (about 150–300 ms **[uncertain, vendor-specific]**). This one parameter decides whether persistent effort shows up as a double trigger or as an ineffective effort in early expiration.

**Trigger delay:** effort onset to pressurization was 42–88 ms on modern ICU ventilators on the bench, and above 100 ms (with poor unloading) for several ventilators at PSV 5–10 ([Thille 2009](https://doi.org/10.1007/s00134-009-1467-7)). Model it as detection time (reaching threshold) plus an actuator latency of about 20–50 ms **[uncertain]**.

**Time trigger:** fires if no patient trigger occurs within 60/RR_set seconds of the last breath start.

### 2.2 Volume control (VC-AC)

- **Settings:** Vt, flow pattern (square or descending ramp to X% of peak), peak flow (40–80+ L/min) **or** Ti, RR, PEEP, FiO2, trigger type and sensitivity, inspiratory pause (0–0.5 s, or 2 s for a manual hold).
- **Timing:**
  - square: Ti = Vt/Qpeak
  - linear ramp to 0: Ti = 2·Vt/Qpeak
  - ramp to fraction f: Ti = 2·Vt/(Qpeak·(1+f))
- **Cycling:** volume delivered, then pause, then exhalation valve opens.
- **Pressure is the dependent variable.** A strong Pmus lowers Paw.
- **Circuit compensation:** optional.
- **High-pressure limit:** when Paw exceeds the alarm threshold, cycle to expiration immediately and raise an alarm.

### 2.3 Pressure control (PC-AC)

- **Settings:** Pinsp above PEEP (ΔP), Ti, RR, PEEP, rise time (about 0.05–0.4 s, or %).
- **Target:** `Ptarget(t) = PEEP + ΔP·ramp(t/rise)`. Time cycled.
- **Passive analytic check:** `V'(t) = (ΔP/R)·e^{−t/τ}` and `Vt = C·ΔP·(1 − e^{−Ti/τ})`. Use these as unit tests.
- Flow and volume are dependent. Patient effort increases flow and Vt, and Vt rises with effort.

### 2.4 Pressure support (PSV) and CPAP

- **Settings:** PS level, PEEP, rise time, trigger, **expiratory trigger sensitivity (ETS)**, apnea time and backup settings.
- **ETS:** cycle when inspiratory flow falls to X% of that breath's peak flow. Typical range 5–80%; common default 25%.
- **Safety cycle criteria:**
  - Ti_max (about 1.5–3 s, adult, vendor-specific **[uncertain]**);
  - pressure cycling if Paw > target + about 2–3 cmH2O (patient "pushing") **[vendor-specific]**.
- **Apnea backup:** apnea time commonly 15–20 s, then a backup PC or VC rate.
- **CPAP:** target Paw = PEEP. The servo supplies whatever flow the patient demands.

### 2.5 SIMV and PRVC/VC+ (optional)

- **SIMV:** mandatory breaths (VC or PC) are synchronized to a patient trigger inside a window before each scheduled breath. Spontaneous efforts between them get PS.
- **PRVC/VC+:** starts with a test breath (e.g., low pressure with a pause) to estimate C. After that:
  `Pinsp_next = Pinsp + clamp(k·(Vt_target − Vte_meas)/C_est, ±ΔPmax)`,
  with ΔPmax about 3 cmH2O per breath and a ceiling of Pmax_alarm − 5 **[vendor-specific, uncertain]**.
  Teaching pitfall that emerges naturally: when the patient pulls hard, Vt rises, so the machine *reduces* support, and drive rises further.

### 2.6 Alarms (defaults to expose)

| Alarm | Suggested default | Notes |
|---|---|---|
| High Ppeak | Ppeak + 10 cmH2O, max 50 | Also cycles the breath off |
| Low Vte | < 70–80% of set, or absolute | |
| High / low Ve | | |
| Apnea | 20 s | |
| High RR | > 35 | |
| Low PEEP / disconnect | | Paw < PEEP − 3 **[uncertain]** |
| High leak | > 15–20% **[heuristic]** | |
| Ti_max reached | | |
| High PEEPi | | |

### 2.7 Derived monitoring (compute from the same measured signals)

| Value | Definition |
|---|---|
| Ppeak | max Paw during inspiration |
| Pplat | Paw at the end of a ≥ 0.3–0.5 s no-flow inspiratory pause (use P2, after viscoelastic decay, if modeled) |
| Mean Paw | ∫Paw dt / Ttot |
| PEEPtot | Paw at the end of a 0.5–2 s expiratory hold; PEEPi = PEEPtot − PEEPset |
| Driving pressure | ΔP = Pplat − PEEPtot |
| Cstat | Vt / (Pplat − PEEPtot) (Arnal's definition) |
| Cdyn | Vt / (Ppeak − PEEP) |
| Raw | (Ppeak − Pplat) / Q, with square flow in L/s |
| Least-squares R, C | Fit of the equation of motion per breath (for display, and as the "passive reference" in flow-starvation detection) |
| Vti, Vte, Ve, I:E | standard |
| RSBI | f / Vt(L); < 105 favors weaning (Yang & Tobin, NEJM 1991 **[unverified DOI]**) |
| P0.1 | pressure at 100 ms of an end-expiratory occlusion |

---

## 3. Dyssynchronies

**Asynchrony Index (AI):**
```
AI = (asynchronous events) / (ventilator cycles + ineffective efforts) × 100
```
**AI > 10% = high/severe** (Thille 2006). Clinically:
- In Thille 2006, 24% of patients had AI > 10%, mostly ineffective triggering and double triggering. High AI was associated with longer ventilation (25.5 vs 7.5 days) ([DOI](https://doi.org/10.1007/s00134-006-0301-8)).
- In Blanch 2015 (8.7M breaths, BetterCare), median AI was 3.41%. Ineffective efforts during expiration (IEE) were the most common type (2.38%), and AI > 10% was associated with higher ICU and hospital mortality ([DOI](https://doi.org/10.1007/s00134-015-3692-6)).
- Vaporidi's "IE event" (> 30 ineffective efforts in 3 min) predicted mortality even when the overall IE index did not ([DOI](https://doi.org/10.1007/s00134-016-4593-z)).
- Clinicians detect asynchrony poorly by eye: 22% sensitivity breath-by-breath ([Colombo 2011](https://doi.org/10.1097/CCM.0b013e318225753c)). This is a strong argument for a labeled simulator.

**Reviews:** [Georgopoulos 2006](https://doi.org/10.1007/s00134-005-2828-5), [Gilstrap & MacIntyre 2013](https://doi.org/10.1164/rccm.201212-2214CI), [de Haro 2019](https://doi.org/10.1186/s40635-019-0234-5). Minor-asynchrony timing method: [Mojoli 2022](https://doi.org/10.1186/s13054-022-03895-4).

**Ground-truth timing labels** (van Diepen's margins, which you can adopt directly):
- Normal: trigger delay < 250 ms and cycling delay from −100 to +300 ms.
- Delayed trigger: > 250 ms.
- Early cycling: < −100 ms.
- Late cycling: > 300 ms.

### 3.1 Ineffective triggering / ineffective efforts (IE)

- **Definition:** an inspiratory effort that does not trigger a breath.
  - Thille: a simultaneous Paw drop and flow increase (toward inspiration) without an assisted cycle.
  - Most occur during expiration (IEE). Some occur during inspiration.
- **Mechanism:**
  1. PEEPi: Pmus must first cancel E·V_ee − PEEPset before airway flow can reverse.
  2. Low drive or weak muscles.
  3. Insensitive trigger.
  4. Effort falls inside the refractory period.
  5. Over-assist: high PS, high Vt, long Ti. Thille found IEs associated with higher PS (17.5 vs 15), higher Vt and higher pH.
- **Signature:**
  - Expiratory flow shows a transient deflection toward zero (a "bump") with a small Paw dip, and no breath follows.
  - During inspiration: a flow hump on the decaying PSV flow.
  - Volume: a small inflection in expiration.
- **Emergent simulation:** a high-τ COPD preset plus a high RR or long Ti (short Te) produces PEEPi. With Pmax at 2–6 cmH2O, IEs appear by themselves. Over-assist through the CO2 loop also lowers Pmax.
- **Fixes:**
  - reduce PS or Vt;
  - shorten ventilator Ti or raise ETS (PSV);
  - increase trigger sensitivity;
  - reduce sedation;
  - in flow-limited COPD, add PEEPe up to about 70–85% of PEEPi **[clinical convention]**;
  - lower RR or Vt to reduce PEEPi.
  
  Tassaux: ETS 70% vs 10% reduced non-triggered breaths from 9 to 2 per minute ([DOI](https://doi.org/10.1164/rccm.200407-880OC)).
- **Detection criteria:**
  - **Chen 2008:** in true IEEs, mean flow deflection (Fdef) was 13.9 ± 8.0 L/min and mean pressure deflection (Pdef) 1.91 ± 0.97 cmH2O. Cutoffs: **Fdef ≥ 5.45 L/min** (sensitivity 91.5%, specificity 96.2%) or **Pdef ≥ 0.45 cmH2O** (93.3%/92.9%) ([DOI](https://doi.org/10.1097/01.CCM.0000299734.34469.D9)).
  - **Mulqueeny 2007:** IE and DT detection with 91% sensitivity and 97% specificity vs transdiaphragmatic pressure ([DOI](https://doi.org/10.1007/s00134-007-0767-z)).
  - **Blanch 2012 BetterCare:** an IEE score from expiratory flow deviation, cutoff > 42%. 91.5%/91.7% vs experts; 65.2%/99.3% vs EAdi ([DOI](https://doi.org/10.1007/s00134-012-2493-4)).

### 3.2 Auto-triggering

- **Definition:** a triggered breath with no patient effort.
- **Causes:**
  - leak (baseline flow deficit looks like inspiratory demand);
  - cardiogenic oscillations;
  - water in the circuit;
  - an overly sensitive trigger;
  - low R, which transmits cardiac pulsations better.
- **Evidence (Imanaka 2000, flow trigger 1 L/min, after cardiac surgery):**
  - 22% of patients auto-triggered (> 5 breaths/min).
  - Cardiogenic flow fluctuation was **4.67 ± 1.26 vs 2.03 ± 0.86 L/min** (auto-triggering vs not).
  - Auto-triggering patients had larger cardiac output, larger hearts and **lower R**.
  - Consequences: RR 19.9 vs 10 breaths/min, PaCO2 30.8 vs 37.6 mmHg, hyperinflation ([DOI](https://doi.org/10.1097/00003246-200002000-00019)).
- **Signature:**
  - Breaths with no preceding Paw dip or flow reversal.
  - Timing often locked to the heart rate, or occurring when end-expiratory flow reaches zero.
  - RR above the set rate. Respiratory alkalosis via the CO2 loop.
- **Emergent simulation:** inject a cardiac pressure term into Palv, `Pcard = A·sin(2π·HR/60·t)` with A = 0.2–1 cmH2O. Flow oscillation ≈ A/R then appears, naturally larger at low R, which matches Imanaka. Pair it with trigger thresholds of about 0.5–1 L/min, or with an expiratory leak.
- **Fixes:** raise the flow-trigger threshold (or switch to pressure triggering), fix the leak or enable leak compensation, drain the circuit.
- **Detection:** a triggered breath with no negative Paw deflection (e.g., no dip ≥ 0.5 cmH2O relative to PEEP) and no preceding flow inflection, in the setting of high heart-rate-band power in the end-expiratory flow **[heuristic]**. Mojoli found auto-triggering rare in PSV (median 0.0%).

### 3.3 Delayed triggering

- **Definition:** trigger delay (neural onset to pressurization) longer than normal. The bench norm is about 40–90 ms. The van Diepen and Mojoli frameworks call > 250 ms delayed.
- **Causes:** PEEPi, an insensitive trigger, weak effort, slow valve response.
- **Signature:** a deeper and longer negative Paw dip (a larger trigger pressure-time product) before the rise, and a slow initial flow. A Pes or Pmus overlay shows the effort starting much earlier.
- **Fixes:** the same as for IE.
- **Detection:** Mojoli's waveform method detects trigger delay from Paw and flow alone (AUC 0.865 vs the esophageal reference). Cycling delay AUC was 0.903 and early cycling AUC 0.983 ([DOI](https://doi.org/10.1186/s13054-022-03895-4)).

### 3.4 Double triggering and breath stacking

- **Definition (Thille):** two cycles separated by an expiratory time shorter than half the mean inspiratory time, with the first one patient-triggered. **Breath stacking:** the second breath is delivered before the first is exhaled, so volumes add.
- **Mechanism:** neural Ti > ventilator Ti. Pmus is still active after cycling and pulls Paw or flow past the trigger threshold. Typical settings: VC with a short Ti or high flow, 6 mL/kg with high drive, or premature cycling in PSV.
- **Signature:**
  - two back-to-back inspirations;
  - expiratory flow of the first breath truncated, never reaching baseline;
  - a stepped, "staircase" volume trace;
  - Vte of the first breath much smaller than Vti;
  - Ppeak of the second breath often higher.
- **Magnitude:**
  - Pohlman: stacked breaths at 2.3 ± 3.5/min despite deep sedation (RASS −4), with volumes of 10.1 mL/kg PBW, **1.62× set Vt**. Higher set Vt reduced them (RR 0.4 per +1 mL/kg) ([DOI](https://doi.org/10.1097/CCM.0b013e31818b308b)).
  - BREATHE criteria (five domains: ventilator cycling, interval expiratory volume, cumulative inspiratory volume, Te, Ti): stacked Vt 11.3 vs set 6.3 mL/kg. Neuromuscular blockade eliminated stacking ([DOI](https://doi.org/10.1007/s00134-016-4423-3)).
  - Sottile: 40% of double-triggered breaths exceeded 10 mL/kg, vs 0.2% of synchronous breaths ([DOI](https://doi.org/10.1097/CCM.0000000000002849)).
- **Emergent simulation:** VC Ti of 0.6–0.8 s with neural Ti of 1.1–1.5 s and Pmax ≥ 8–10, and a refractory period shorter than the residual effort.
- **Fixes:**
  - lengthen ventilator Ti (lower flow, add pause);
  - raise Vt if Pplat and ΔP allow;
  - switch to PC or PSV, lowering ETS in PSV;
  - treat the drive (analgesia, sedation);
  - neuromuscular blockade in severe ARDS.
- **Detection:**
  - Thille's Te < ½ mean Ti rule;
  - Rehm 2018 ensemble classifier: double trigger 0.960/0.975, breath stacking 0.944/0.987 sensitivity/specificity ([DOI](https://doi.org/10.3414/ME17-02-0012));
  - ventMAP rules ([DOI](https://doi.org/10.1038/s41598-017-15052-x));
  - Liao 2011 double-trigger subtypes from Paw and flow deflection ([DOI](https://doi.org/10.4187/respcare.00731));
  - BREATHE: stacked volume ≥ 2 mL/kg above intended.

### 3.5 Reverse triggering (entrainment)

- **Definition:** a ventilator-initiated passive insufflation that elicits diaphragm contraction, with a stable phase relationship.
- **Akoumianaki 2013** (sedated ARDS on assist-control):
  - present during 12–100% of recording time;
  - entrainment ratios **1:1**, and also 1:2 and 1:3;
  - coefficient of variation of reverse-triggered breath frequency < 5%, i.e. as regular as the ventilator ([DOI](https://doi.org/10.1378/chest.12-1817)).
  - Reported phase delay is about 0.39 s (phase angle about 60°) ([Frontiers 2021](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8359823/); **[uncertain generalizability]**).
- **Phenotypes (Baedorf-Kassis 2023):**
  - early reverse trigger with early relaxation;
  - early reverse trigger with delayed relaxation;
  - mid-cycle (37.8%);
  - late;
  - reverse trigger with breath stacking or double trigger (24.4%) ([DOI](https://doi.org/10.1016/j.jcrc.2023.154256)).
- **Signature:**
  - VC: Paw dips in mid-to-late inspiration or during the pause (lower apparent Pplat, a false low ΔP). Early-expiratory flow is blunted or reversed. If the effort is strong and persists past cycling, a second breath is triggered (stacking).
  - PC: a mid-to-late inspiratory flow hump, and Vt above the passive value.
- **Emergent simulation:** a phase-locked neural oscillator. When `entrainment=on` (deep sedation, controlled mode, set RR near the intrinsic rate):
  `t_onset = t_vent_start + d`, with d = 0.2–0.8 s, a ratio of 1:1, 1:2 or 1:3, and < 5% jitter.
  Pmax 3–15 selects the phenotype. A more physiologic alternative is a phase-resetting oscillator driven by lung inflation.
- **Fixes:** change RR up or down to break the lock, lighten sedation (so efforts become triggered), switch to PSV, neuromuscular blockade as a last resort.
- **Detection (Baedorf-Kassis):**
  - Rules without esophageal pressure: sensitivity 74.6%, specificity 96.6%.
  - With esophageal pressure: 81.7%/95.3%.
  - Reverse trigger with breath stacking: 81.9%/99.7%.
  - Effort must be ≥ 2× the amplitude of the cardiac artifact.

### 3.6 Premature (short) cycling

- **Definition:** the ventilator cycles off before neural inspiration ends (van Diepen: cycling delay < −100 ms). Thille's short-cycle criterion is Ti below half the mean Ti, as commonly cited from Thille 2006 **[threshold wording from the paper's methods, not re-verified]**.
- **Mechanism:** in PSV, a low τ (ARDS, fibrosis) makes flow decay quickly to ETS (Yamada & Du: V'(TI)/V'peak is low when τ/TI is small), or ETS is set too high. In VC or PC, the set Ti is shorter than neural Ti.
- **Signature:**
  - early-expiratory flow abruptly attenuated or notched, sometimes returning toward zero or positive (continuing effort);
  - Paw dips below PEEP just after cycling;
  - often followed by a double trigger;
  - short ventilator Ti, small Vt.
- **Fixes:** lower ETS (e.g., 25% → 10–15%), increase PS or Ti, lengthen rise time in some cases.
- **Detection:** Gholami 2018 ML detected premature termination with 94% sensitivity and 98% specificity ([DOI](https://doi.org/10.1016/j.compbiomed.2018.04.016)). BetterCare flags short cycling.

### 3.7 Delayed (prolonged) cycling, including expiratory muscle recruitment

- **Definition:** ventilator inspiration continues after neural Ti ends (> 300 ms, van Diepen; Thille's prolonged cycle is Ti > 2× mean Ti).
- **Mechanism:**
  - high τ (COPD) makes flow decay slowly, so it takes a long time to reach ETS;
  - high PS;
  - low ETS;
  - leak (flow never falls to ETS, so the breath ends on Ti_max);
  - long set Ti.
  
  The patient relaxes or actively exhales against a closed circuit.
- **Signature (PSV):**
  - **end-inspiratory Paw spike** above the set level as the patient pushes;
  - flow shows a rapid decline then an abrupt change in slope (a "shoulder") before cycling;
  - negative Pmus if expiratory muscles are recruited;
  - prolonged Ti;
  - PEEPi rises, which leads to IEs.
- **Magnitude (Tassaux, COPD):** raising ETS from 10% to 70% cut delayed cycling from 1.26 ± 0.72 s to 0.25 ± 0.18 s, PEEPi from 6.5 to 4.8 cmH2O, non-triggering breaths from 9 to 2 per minute, and trigger PTP from 2.1 to 0.9 cmH2O·s ([DOI](https://doi.org/10.1164/rccm.200407-880OC)).
- **Fixes:** ETS 40–70% in obstructive disease, lower PS, shorter Ti or Ti_max, fix the leak.
- **Detection:** Gholami (delayed termination: 89% sensitivity, 99% specificity); Mojoli cycling-delay AUC 0.903. Heuristic: Paw overshoot > 2 cmH2O above target in the last third of inspiration **[heuristic]**.

### 3.8 Flow starvation (flow asynchrony in VC)

- **Definition:** fixed ventilator flow is lower than patient demand.
- **Mechanism:** `Paw = E·V + R·Q − Pmus` with Q fixed, so every cmH2O of effort comes straight out of Paw.
- **Signature:**
  - a concave, "scooped" Paw ramp instead of the passive linear/convex rise;
  - Paw may fall below PEEP;
  - Ppeak falls and the displayed Cdyn looks falsely good.
  
  Sottile's "flow-limited" breaths gave > 10 mL/kg in 11% of cases.
- **Emergent simulation:** VC, peak flow 30–45 L/min, Pmax 10–20. It appears automatically.
- **Fixes:** raise peak flow (60–80+ L/min), shorten Ti, switch to PC/PSV or VC+ (variable flow), treat the drive. Some ventilators have flow-adaptive VC **[vendor-specific]**.
- **Detection:** compare measured Paw with a *passive-predicted* Paw from R and C fitted on passive breaths. The deficit area (a "Pmus-time product" estimate) above a threshold, or a concavity index on the inspiratory Paw ramp **[heuristic; Sottile's exact features not published in the abstract]**.

### 3.9 Excess flow and pressure overshoot

- **Signature:**
  - PC/PSV with a too-short rise time: an initial Paw overshoot or ringing above target and a flow spike.
  - VC with excessive flow: a very short Ti, so neural Ti exceeds ventilator Ti and double triggering becomes more likely.
- **Fixes:** lengthen rise time, reduce peak flow.
- **Detection:** Paw in the first 100–200 ms > target + 2–3 cmH2O **[heuristic]**.

### 3.10 Auto-PEEP / dynamic hyperinflation

- **Condition:** Te < ~3–5·τE.
- **Signature:**
  - expiratory flow does not return to zero before the next breath;
  - Vte < Vti transiently while EELV climbs over breaths to a new steady state (trapped volume = C·PEEPi);
  - rising Ppeak and Pplat;
  - IEs in spontaneously breathing patients.
- **Measurement:** end-expiratory hold, PEEPi = Ptot,ee − PEEPset.
- **Fixes:** lower RR, lower Vt, raise inspiratory flow (shorter Ti), lower R (bronchodilator); in spontaneous COPD, PEEPe to counterbalance.
- **Detection:** end-expiratory flow magnitude > about 2–5 L/min at the trigger point **[heuristic]**, or an extrapolated non-zero expiratory flow.

### 3.11 Leak

- **Signature:**
  - Vte < Vti;
  - the volume trace never returns to zero, and many ventilators reset it, so it looks like a "step-down";
  - the P–V and F–V loops do not close;
  - in PSV, prolonged inspiration (flow never reaches ETS);
  - expiratory baseline flow offset, which leads to auto-triggering.
- **Detection:** leak% > 10–20% **[heuristic threshold]**.

### 3.12 Non-dyssynchrony patterns worth recognizing

| Pattern | Model injection | Signature |
|---|---|---|
| Secretions | Add noise to R (random, band-limited 5–20 Hz **[uncertain]**) | Irregular "sawtooth" oscillations on expiratory flow and on the F–V loop. The sawtooth pattern predicts need for suctioning (Guglielminotti, Chest 2000 **[unverified DOI]**). |
| Water in circuit | | More regular oscillation; can auto-trigger |
| High resistance (bronchospasm, kink, biting) | | Ppeak↑, Pplat unchanged, Ppeak−Pplat↑ (e.g., > 10 cmH2O at 60 L/min square flow **[heuristic]**), prolonged expiratory flow, PEEPi↑ |
| ↓Compliance (pneumothorax, mainstem intubation, abdominal hypertension) | | Ppeak and Pplat both↑, ΔP↑, Cstat↓. In PC, Vt↓ at the same ΔP. Pneumothorax is abrupt; mainstem intubation roughly halves C. |
| Cough | Brief large negative (expiratory) Pmus | Paw spike → high-pressure alarm → breath aborted. ventMAP has artifact-correction logic for cough and suction that improved specificity. |

### 3.13 Automated-detection algorithms (summary)

| Algorithm | Inputs | Targets | Key rule / performance |
|---|---|---|---|
| Mulqueeny 2007 (ResMed) [DOI](https://doi.org/10.1007/s00134-007-0767-z) | Paw, flow | IE, DT (PSV, including NIV) | Sensitivity 91%, specificity 97% vs Pdi; lower specificity in NIV |
| Chen 2008 [DOI](https://doi.org/10.1097/01.CCM.0000299734.34469.D9) | Paw, flow | IE during expiration | Fdef ≥ 5.45 L/min; Pdef ≥ 0.45 cmH2O |
| Blanch/BetterCare 2012 & 2015 | Flow, Paw (multi-vendor) | IEE, DT, aborted inspirations, short and prolonged cycling | IEE score > 42% |
| Gutierrez 2011 (spectral analysis of airflow) **[unverified]** | Flow | Global asynchrony | Spectral features |
| ventMAP (Adams 2017) [DOI](https://doi.org/10.1038/s41598-017-15052-x); [code](https://github.com/hahnicity/ventMAP), GPL-3.0 | PB840 at 50 Hz or generic 100 Hz | DT, breath stacking, excess Vt, artifacts | Rule-based per-breath metadata (I:E, Ti, Vti/Vte, PIP, PEEP, mean Paw) |
| Rehm 2018 [DOI](https://doi.org/10.3414/ME17-02-0012) | Per-breath features | DT, breath stacking | Ensemble + SMOTE; 0.960/0.975 and 0.944/0.987 |
| Sottile 2018 [DOI](https://doi.org/10.1097/CCM.0000000000002849) | P, F, V (4.26M breaths) | Three types (DT, flow-limited, plus a third **[verify in full text]**) | ML, AUC > 0.89; dyssynchrony in 34.4% of breaths |
| Gholami 2018 [DOI](https://doi.org/10.1016/j.compbiomed.2018.04.016) | Waveforms | Premature and delayed cycling | κ ≈ 0.90 vs experts |
| BREATHE (Beitler 2016) | Integrated flow | Breath stacking | Five-domain rule |
| Baedorf-Kassis 2023 | P, F, V ± Pes | Reverse trigger phenotypes | Rules + deep neural network |
| Mojoli 2022 waveform method | Paw, flow | All major and minor asynchronies, timing | Explicit visual rules, agreement 0.99; good template for a rule engine |

---

## 4. Synthetic-data realism

- **Sampling rates:**
  - PB840 serial output: 50 Hz, ASCII (used by ventMAP);
  - ventMAP's generic format: 100 Hz;
  - Dräger Babylog VN500 exports: 100 Hz (per a search result, not verified in the paper itself);
  - Dräger V500 research capture, including Pes: **200 Hz** ([Liu 2025](https://doi.org/10.1038/s41597-025-06364-z)).
  
  Recommendation: physics at 1 kHz, a "device" output selectable at 50/100/200 Hz, and detectors run at the device rate.
- **Noise (van Diepen):**
  - pressure: low-pass white noise, 15 Hz bandwidth, SNR ≈ 15–16 dB;
  - flow: SNR ≈ 30–31 dB;
  - cardiac: 0.25–1 cmH2O at 1–2 Hz.
  
  Imanaka's in-vivo cardiogenic flow fluctuation of about 2–5 L/min is a good target amplitude.
- **Sensor chain [uncertain]:** first-order low-pass (τ ≈ 10–30 ms), 10–30 ms transport delay, quantization (e.g., 0.1 cmH2O and 0.1 L/min), occasional dropouts. Vte is integrated from the measured signal, so drift and leak behave realistically.
- **Variability:**
  - spontaneous breathing: AR(1) processes on Pmax, neural Ti and neural RR, each with CV about 10–25% **[uncertain; human breath-to-breath CV of Vt and Ti is roughly in this range]**;
  - reverse-triggered breaths: CV < 5% (Akoumianaki), a useful discriminating feature;
  - sighs: about 2× effort every 5–10 min **[uncertain]**;
  - cough, suction and disconnect artifacts.
  
  Include IE clusters, i.e. drive fluctuations that are not uniformly random, so Vaporidi-style events can occur.
- **Validation datasets:**
  - **CCVW-ICU** (Liu et al., Sci Data 2025): 7 PSV patients, Dräger V500, **200 Hz Flow/Paw/Pes**, 1 h/day. CC BY-NC-ND 4.0, Science Data Bank 10.57760/sciencedb.26222. No asynchrony labels, but Pes lets you derive true Pmus. This is the best available reference for real Pmus shapes and noise ([DOI](https://doi.org/10.1038/s41597-025-06364-z)).
  - **Google Brain / Kaggle Ventilator Pressure Prediction (2021):** a modified open-source ventilator on a bellows test lung, about 3 s breaths, R and C grid, u_in 0–100% and u_out 0/1 valve controls. Useful for PID and pressure-controller realism, not for patient effort. License: competition rules **[uncertain]**.
  - **ventMAP repo test samples** (PB840 format).
  - The van Diepen supplement (model parameters; code not released).
  - MIMIC waveform databases: largely monitor signals; ventilator waveforms are not a reliable component **[uncertain]**.
  - I could not confirm a PhysioNet-hosted, labeled asynchrony waveform dataset.
- **Reference simulators and models:**

| Project | License | What to learn |
|---|---|---|
| **Pulse Physiology Engine** (Kitware) ([methodology](https://pulse.kitware.com/_mechanical_ventilator_methodology.html), [paper](https://pubmed.ncbi.nlm.nih.gov/37250852/)) | Apache-2.0 | Circuit-based lung plus generalized ventilator (PC-CMV, PC-AC, VC-CMV, VC-AC, CPAP), unified settings model, muscle-pressure driver, published validation pages for healthy, COPD and ARDS. Its architecture and validation tables are worth reusing. |
| **open-vent-sim** ([GitHub](https://github.com/fedebarra/open-vent-sim)) | MIT | Browser React/TS ICU plus anesthesia simulator (VCV, PCV, SIMV, PSV, CPAP; Normal/COPD/ARDS/Obesity presets). The closest JS analog. Review how it generates waveforms; its asynchrony physics is not documented. |
| **MakAir simulator-web** ([GitHub](https://github.com/makers-for-life)) | **[verify]** | Real ventilator firmware running in the browser; control-loop realism |
| **RespiraWorks**, People's Ventilator Project | **[verify]** | Real controller code (PID pressure servo) |
| **van Diepen 2022** LTSpice model | Code not released | Closest published design to your goal: model-generated, auto-annotated PSV waveforms, > 60,000 breaths |
| **ASL 5000** (IngMar) | Proprietary hardware | The Pmus parameterization convention |
| **xlung** ([site](https://xlung.net/en/simulators/xlung)) | Commercial; Java | UX reference: configurable effort pattern and drive, gas exchange (shunt, dead space) |
| Review of virtual simulators ([PMC5041346](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5041346/)) | — | Landscape |

  I could not identify any projects called "Mirador" or "OpenVent sim" (open-vent-sim above may be what you meant). I did not verify Hamilton's online simulator or "Harvard xlung" (xlung appears to be a Brazilian commercial platform).

---

## 5. Clinical sanity guardrails

- **Predicted body weight (ARDSNet 2000):**
  - male: 50 + 0.91·(height cm − 152.4)
  - female: 45.5 + 0.91·(height cm − 152.4)
- **Lung-protective targets:**
  - Vt 4–8 mL/kg PBW, starting at 6;
  - Pplat ≤ 30 cmH2O;
  - driving pressure ≤ 15 cmH2O (Amato, NEJM 2015 **[unverified DOI]**);
  - RR up to 35;
  - pH 7.30–7.45 (permissive hypercapnia);
  - SpO2 88–95%;
  - PEEP/FiO2 tables.
- **Effort targets:** P0.1 roughly 1–3.5 cmH2O (Telias); Pmus of about 5–10 cmH2O is often cited as "diaphragm-protective" **[consensus opinion, uncertain]**.
- **Flags to show in the UI:**
  - stacked Vt ≥ 2 mL/kg above set (BREATHE);
  - Vt > 10 mL/kg (Sottile/Pohlman harm threshold);
  - AI > 10%;
  - more than 30 IEs in 3 min;
  - PEEPi > 5 **[heuristic]**;
  - leak > 20%.
- **Model bounds (clamp inputs):**
  - C 10–200 mL/cmH2O;
  - R 2–60 cmH2O/L/s;
  - Pmax 0–40 cmH2O;
  - neural RR 4–60;
  - neural Ti 0.4–2.5 s;
  - PEEP 0–25;
  - PS/ΔP 0–40;
  - peak flow 10–120 L/min.
- **Built-in unit tests:**
  - passive PC Vt = C·ΔP·(1 − e^{−Ti/τ});
  - passive VC Ppeak − Pplat = R·Q;
  - mass balance ∫Q_insp − ∫Q_exp = ΔEELV + leak volume;
  - PEEPi steady state matches e^{−Te/τ} predictions;
  - with Pmus = 0 and no noise, AI = 0 and no triggers fire.

---

## References

**From PubMed** (metadata and abstracts retrieved this session; DOIs verified):
1. Thille AW et al. Patient-ventilator asynchrony during assisted MV. *Intensive Care Med* 2006;32:1515–22. [10.1007/s00134-006-0301-8](https://doi.org/10.1007/s00134-006-0301-8)
2. Blanch L et al. Asynchronies during MV are associated with mortality. *Intensive Care Med* 2015;41:633–41. [10.1007/s00134-015-3692-6](https://doi.org/10.1007/s00134-015-3692-6)
3. Blanch L et al. Validation of the Better Care system to detect IEE. *Intensive Care Med* 2012;38:772–80. [10.1007/s00134-012-2493-4](https://doi.org/10.1007/s00134-012-2493-4)
4. Gilstrap D, MacIntyre N. Patient-ventilator interactions. *AJRCCM* 2013;188:1058–68. [10.1164/rccm.201212-2214CI](https://doi.org/10.1164/rccm.201212-2214CI)
5. Georgopoulos D et al. Bedside waveforms interpretation… *Intensive Care Med* 2006;32:34–47. [10.1007/s00134-005-2828-5](https://doi.org/10.1007/s00134-005-2828-5)
6. Mojoli F et al. The waveform method. *Crit Care* 2022;26:32. [10.1186/s13054-022-03895-4](https://doi.org/10.1186/s13054-022-03895-4)
7. Arnal JM et al. Parameters for simulation of adult subjects during MV. *Respir Care* 2018;63:158–68. [10.4187/respcare.05775](https://doi.org/10.4187/respcare.05775)
8. Yamada Y, Du HL. Expiratory asynchrony in PSV: a mathematical approach. *J Appl Physiol* 2000;88:2143–50. [10.1152/jappl.2000.88.6.2143](https://doi.org/10.1152/jappl.2000.88.6.2143)
9. Akoumianaki E et al. Reverse-triggered breaths. *Chest* 2013;143:927–38. [10.1378/chest.12-1817](https://doi.org/10.1378/chest.12-1817)
10. Sottile PD et al. Automated ventilator dyssynchrony detection. *Crit Care Med* 2018;46:e151–7. [10.1097/CCM.0000000000002849](https://doi.org/10.1097/CCM.0000000000002849)
11. Adams JY et al. ventMAP. *Sci Rep* 2017;7:14980. [10.1038/s41598-017-15052-x](https://doi.org/10.1038/s41598-017-15052-x)
12. Rehm GB et al. ML classifier for PVA. *Methods Inf Med* 2018;57:208–19. [10.3414/ME17-02-0012](https://doi.org/10.3414/ME17-02-0012)
13. Mulqueeny Q et al. Automatic detection of IT and DT. *Intensive Care Med* 2007;33:2014–8. [10.1007/s00134-007-0767-z](https://doi.org/10.1007/s00134-007-0767-z)
14. Chen CW et al. Detecting IT in expiration via flow/pressure deflection. *Crit Care Med* 2008;36:455–61. [10.1097/01.CCM.0000299734.34469.D9](https://doi.org/10.1097/01.CCM.0000299734.34469.D9)
15. Beitler JR et al. BREATHE criteria. *Intensive Care Med* 2016;42:1427–36. [10.1007/s00134-016-4423-3](https://doi.org/10.1007/s00134-016-4423-3)
16. Pohlman MC et al. Breath stacking during LPV. *Crit Care Med* 2008;36:3019–23. [10.1097/CCM.0b013e31818b308b](https://doi.org/10.1097/CCM.0b013e31818b308b)
17. Imanaka H et al. Autotriggering by cardiogenic oscillation. *Crit Care Med* 2000;28:402–7. [10.1097/00003246-200002000-00019](https://doi.org/10.1097/00003246-200002000-00019)
18. Tassaux D et al. Expiratory trigger setting and delayed cycling. *AJRCCM* 2005;172:1283–9. [10.1164/rccm.200407-880OC](https://doi.org/10.1164/rccm.200407-880OC)
19. Colombo D et al. Efficacy of waveform observation. *Crit Care Med* 2011;39:2452–7. [10.1097/CCM.0b013e318225753c](https://doi.org/10.1097/CCM.0b013e318225753c)
20. de Haro C et al. PVA: current knowledge and research priorities. *ICMx* 2019;7(S1):43. [10.1186/s40635-019-0234-5](https://doi.org/10.1186/s40635-019-0234-5)
21. Vaporidi K et al. Clusters of ineffective efforts. *Intensive Care Med* 2017;43:184–91. [10.1007/s00134-016-4593-z](https://doi.org/10.1007/s00134-016-4593-z)
22. Gholami B et al. ML for cycling asynchrony. *Comput Biol Med* 2018;97:137–44. [10.1016/j.compbiomed.2018.04.016](https://doi.org/10.1016/j.compbiomed.2018.04.016)
23. Thille AW et al. Bench study of ICU ventilators. *Intensive Care Med* 2009;35:1368–76. [10.1007/s00134-009-1467-7](https://doi.org/10.1007/s00134-009-1467-7)
24. Telias I et al. P0.1 as estimate of drive and effort. *AJRCCM* 2020;201:1086–98. [10.1164/rccm.201907-1425OC](https://doi.org/10.1164/rccm.201907-1425OC)
25. Chatburn RL et al. Taxonomy for MV: 10 maxims. *Respir Care* 2014;59:1747–63. [10.4187/respcare.03057](https://doi.org/10.4187/respcare.03057)
26. Liu X et al. Clinical and ventilator waveforms during PSV (CCVW-ICU). *Sci Data* 2025. [10.1038/s41597-025-06364-z](https://doi.org/10.1038/s41597-025-06364-z)
27. Spaeth J et al. Pressure drop across ETT. *Paediatr Anaesth* 2015;25:413–20. [10.1111/pan.12595](https://doi.org/10.1111/pan.12595)
28. Hentschel R et al. ETT resistance and inertance. *Physiol Meas* 2011;32:1439–51. [10.1088/0967-3334/32/9/007](https://doi.org/10.1088/0967-3334/32/9/007)

**Other sources verified via web this session:**
29. van Diepen A et al. Model-based approach to generating annotated PSV waveforms. *J Clin Monit Comput* 2022. [10.1007/s10877-022-00822-4](https://doi.org/10.1007/s10877-022-00822-4) · [PMC9637593](https://pmc.ncbi.nlm.nih.gov/articles/PMC9637593/)
30. Baedorf-Kassis EN et al. Reverse triggering detection. *J Crit Care* 2023;75:154256. [10.1016/j.jcrc.2023.154256](https://doi.org/10.1016/j.jcrc.2023.154256)
31. Jin X et al. Cardio-respiratory model (Albanese Pmus). *Front Physiol* 2025. [10.3389/fphys.2025.1699315](https://doi.org/10.3389/fphys.2025.1699315); Albanese A et al. *AJP Heart* 2016 ([PMID 26683899](https://pubmed.ncbi.nlm.nih.gov/26683899/))
32. Liao KM et al. Classifying double triggering. *Respir Care* 2011. [10.4187/respcare.00731](https://doi.org/10.4187/respcare.00731)
33. Liu PH, Chatburn RL. Inspiratory effort and circuit compensation (ASL Pmus parameters). *Respir Care* 2022. [10.4187/respcare.09729](https://doi.org/10.4187/respcare.09729)
34. Pulse Physiology Engine, mechanical ventilator methodology (Apache-2.0): https://pulse.kitware.com/_mechanical_ventilator_methodology.html
35. ventMAP (GPL-3.0): https://github.com/hahnicity/ventMAP · open-vent-sim (MIT): https://github.com/fedebarra/open-vent-sim · xlung: https://xlung.net/en/simulators/xlung · ASL 5000 manual: https://www.ingmarmed.com/wp-content/uploads/2020/04/80-31-760-Rev.-2-ASL-5000-User%E2%80%99s-Manual.pdf · Kaggle: https://www.kaggle.com/competitions/ventilator-pressure-prediction · Reverse trigger in non-ARDS: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8359823/

**From background knowledge, not verified this session (check before citing in the spec):** ARDSNet NEJM 2000; Amato NEJM 2015 (driving pressure); Yang & Tobin NEJM 1991 (RSBI); Yoshida AJRCCM 2013 (pendelluft); Otis 1956 (time constants); Khoo J Appl Physiol 1982 (loop gain); Guglielminotti Chest 2000 (sawtooth); Gutierrez Crit Care 2011 (spectral asynchrony); Thille 2008 (reducing Vt/PS to reduce asynchrony); Goligher 2020 (lung- and diaphragm-protective ventilation); Guttmann 1993 (ETT Rohrer constants).

**Main open items:**
- Adult ETT Rohrer constants.
- Vendor refractory periods, Ti_max and PRVC step limits.
- Viscoelastic time constants.
- τ_CO2 and chemoreflex gains.
- The exact Albanese equation constants.
- The third dyssynchrony class in Sottile 2018.
- The Kaggle R/C grid and license.

All of these are flagged inline.
