# Research Brief 2 — Pressure Partitioning, Lung Stress & Effort Metrics (compiled 2026-09-10)

# Pressure partitioning and lung stress in the ventilator simulator: research brief

**Scope:** how to compute and display pressures in each part of the respiratory system at every time step, plus the stress and effort metrics derived from them and the bedside maneuvers that reveal them. Dyssynchrony, mode logic and noise are left out, as you asked.

**How sure each claim is:** **[V]** means I checked it against the primary abstract or full text during this research. **[L]** means it comes from the literature but I didn't re-check it this session. **[M]** means it's my own modeling assumption or heuristic, with no single source; use it as a default you can tune.

---

## 0. The most important modeling choices

1. **Keep one volume state per compartment and derive every pressure from it.** Each pressure is a simple algebraic function of volume V, flow V′ and muscle pressure Pmus(t). Only V has to be integrated at 100–200 Hz; everything else is computed from it.
2. **Keep absolute pleural pressure (Ppl0), not just its swings.** The two ways of estimating transpulmonary pressure (direct PL = Paw − Pes versus the elastance-ratio estimate) only give different answers because of the absolute pleural pressure, and that difference is a core teaching point.
3. **Keep the true pleural pressure (Ppl) separate from the displayed esophageal pressure (Pes).** Pes should be a corrupted measurement of Ppl at one height: offset, attenuated, and carrying a cardiac artifact.
4. **Scale muscle pressure up during full-breath occlusions (about 1/0.75).** Otherwise the simulator won't reproduce Bertoni's conversion factors. Muscles generate more pressure isometrically than while shortening. **[M]**, derived from Bertoni 2019's k1 = −0.74.
5. **Use two compartments, non-dependent and dependent, with their own pleural pressures.** Pendelluft, P-SILI, the drop from P1 to P2 during a hold, and the regional differences in PL (Yoshida 2018) cannot be produced by a single compartment.

---

## 1. The partitioned model

### 1.1 Splitting elastance

Ers = EL + Ecw (the two act in series; compliances add as reciprocals). The fraction of any airway pressure change that reaches the lung is EL/Ers:

- ΔPL = ΔPaw,static × EL/Ers
- ΔPpl = ΔPaw,static × Ecw/Ers

**Table 1: Starting partition values (static, supine, sedated or paralyzed, measured at the airway including the tube)**

| Phenotype | EL (cmH2O/L) | Ecw (cmH2O/L) | Ers | EL/Ers | EELV/FRC (L) | Pes at end-expiration (cmH2O) | Source / confidence |
|---|---|---|---|---|---|---|---|
| Normal, anesthetized | 9.4 (CL 107 mL/cmH2O) | 5.2 (Ccw 191) | ~14.6 | ~0.64 | 1.69 | ~3–7 at relaxation volume | Pelosi 1996 **[V]**; Behazin 2010: 6.9 ± 3.1 **[V]** |
| Pulmonary ARDS | 20.2 ± 5.4 | 5.2 ± 1.9 | 25.4 | ~0.80 | ~0.7–1.3 | 10–20 | Gattinoni 1998 at zero PEEP **[V]**; EELV **[L]** |
| Extrapulmonary ARDS | 13.8 ± 5.0 | 12.1 ± 3.8 | 25.9 | ~0.53 | ~0.7–1.3 | 15–25 | Gattinoni 1998 **[V]**; IAP 22 ± 6 vs 8.5 ± 3 |
| ARDS / ALI, mixed cohort | — | — | — | range 0.33–0.95, mean ~0.7 | — | 17.5 ± 5.7; 18.6 ± 4.7 | Chiumello 2008 **[V]**; Talmor 2006 **[V]**; Loring 2010 **[V]** |
| Morbid obesity (Pelosi) | 18.1 (CL 55) | 8.9 (Ccw 112) | ~27 | ~0.67 | 0.665 | 12.5 ± 3.9 at relaxation volume | Pelosi 1996 **[V]**; Behazin 2010 **[V]** |
| Morbid obesity (Behazin) | 23 (CL 43) | 5.1 (Ccw 195) | ~31 | ~0.8 | low | 12.5 | Behazin 2010 **[V]**; the chest wall itself was near normal |
| Intra-abdominal hypertension | normal to high | 10–20+ | high | 0.4–0.6 | reduced | high; IAP transmitted at roughly 20–80% | **[L/M]**; Gattinoni 1998 found IAP correlates with Ecw |
| COPD, passive | 4–8 (high compliance) | ~5 | 10–14 | ~0.5 | high (hyperinflated) | ~5 plus intrinsic PEEP | **[L/M]**; standard physiology, no single source checked |

**Two points to get right:**

- **The obesity data disagree.** Pelosi found both the lung and the chest wall stiffened. Behazin found the lung stiffened mostly because it is breathing at low volume, with near-normal chest wall compliance and a high absolute Ppl. Model obesity as a **high Ppl0 plus low EELV plus high EL**, with Ecw moderately raised (about 7–10).
- **Airway resistance R.** With an endotracheal tube, use about 10–15 cmH2O/L/s for normal and ARDS lungs and 20–35 for COPD **[L]**. Pelosi 1996 measured lung-only Rmin,L of 1.0 (normal) versus 4.7 cmH2O/L/s (obese), which shows most of the total is tube and circuit.

### 1.2 Time-domain equations (single compartment)

Definitions:
- V(t) = volume above end-expiratory lung volume (EELV) at the current PEEP.
- Ppl0 and PL0 = end-expiratory pleural and transpulmonary pressure.
- Static equilibrium at end-expiration: Ppl0 + PL0 = PEEPtot (set PEEP + intrinsic PEEP).

| Pressure | Equation |
|---|---|
| Airway, at the Y-piece | Paw = Palv + R·V′ (R includes the tube; optionally add Rcw·V′ for chest wall resistance) |
| Alveolar | Palv = Ppl + PL |
| Pleural (true) | Ppl(t) = Ppl0 + Ecw·V − Pmus(t) (optionally + Rcw·V′) |
| Transpulmonary | PL(t) = Palv − Ppl = PL0 + EL·V (nonlinear version in §2) |
| Chest wall recoil | Pcw,rec(t) = Ppl0 + Ecw·V, i.e. the pleural pressure a relaxed chest wall would have at this volume |
| Muscle | Pmus = Pcw,rec − Ppl ≥ 0 during inspiration |
| Combined equation of motion | Paw = R·V′ + (EL + Ecw)·V + PEEPtot − Pmus |

**Setting the baseline pleural pressure.** Pick Ppl0 from the phenotype (Table 1). Ppl0 then moves with PEEP along the chest wall curve: ΔPpl0 = Ecw × ΔVPEEP, where ΔVPEEP = ΔPEEP/Ers plus any recruited volume. Example: with Ecw/Ers = 0.3, raising PEEP by 10 cmH2O raises end-expiratory Ppl by about 3. In obesity and abdominal hypertension, add a volume-independent offset (+5 to +10 cmH2O **[M]**, anchored to Behazin's 12.5 vs 6.9 cmH2O). This is why PL at end-expiration can be negative at PEEP 10 in an obese patient.

**Optional abdominal (gastric) pressure [M]:**
- Pga = IAP0 + β·Pmus(t) + γ·Ecw·V, with β ≈ 0.3–0.5 and γ ≈ 0.3.
- Transdiaphragmatic pressure Pdi = Pga − Pes.
- These coefficients are illustrative only.

### 1.3 Making the esophageal signal realistic

Displayed Pes(t) = Ppl(z_eso, t)·k + Poffset + Pew + Pcardiac(t)

| Term | Value | Source / confidence |
|---|---|---|
| Height of the pleural pressure sampled (z_eso) | Mid-to-dependent lung | Yoshida 2018 **[V]** |
| Vertical pleural gradient, normal | ~0.25 cmH2O per cm of height (0.2–0.5 depending on posture). Supine anterior–posterior height of 15–20 cm gives a non-dependent-to-dependent difference of about 4–5 cmH2O. | Agostoni and D'Angelo line of work **[V]** (search summary) |
| Vertical pleural gradient, ARDS | Steeper, because lung tissue weight roughly doubles (tissue volume 31.6 vs 16.7 mL/m²). Suggest 0.4–0.7 cmH2O/cm. | Pelosi 1994 **[V]** for tissue volume; gradient value **[M]** |
| Supine mediastinal offset | +2 to +5 cmH2O. Healthy subjects had PL at relaxation volume of +3.7 upright versus −3.3 supine (Washko 2006). Default +3. | **[V]**; default **[M]** |
| Esophageal wall pressure from balloon filling (Pew) | 0.0 at 0.5 mL, 2.0 ± 1.9 at the best volume, 3.0 ± 1.7 cmH2O at 4 mL. Best volume 3.5 ± 1.9 mL (range 0.5–6); esophageal wall elastance 1.1 ± 0.5 cmH2O/mL. | Mojoli 2016 **[V]** |
| Swing transmission (k) | Under-filling damps the swing (k < 1): the occlusion test passed in only 22% at 0.5 mL, versus 98% at the best volume. Default 0.95 **[M]**. | Mojoli 2016 **[V]** |
| Cardiac artifact | Oscillation at heart rate, in the 0.8–4 Hz band (breathing is about 0.17–0.67 Hz). Amplitude about 1–3 cmH2O, larger when the balloon sits low behind the heart. | Band **[V]**; amplitude **[M]** |

**Occlusion test (Baydur 1982) [V].**
- Occlude the airway at end-expiration and compare ΔPes to ΔPaw during the patient's efforts. A ratio of 0.8–1.2 is accepted, and 0.9–1.1 per Mojoli's review.
- In passive patients, use gentle chest compressions during the occlusion instead.
- **Simulator behavior:** during the occlusion V is fixed, so ΔPaw = ΔPalv = ΔPpl (mean). The displayed ratio is then ≈ k × (ΔPpl at the balloon height / mean ΔPpl), so badly placed or badly filled balloons fail the test naturally.

### 1.4 Direct PL versus elastance-derived PL

| | Direct (absolute) PL = Paw − Pes | Elastance-derived PL,ei = Pplat × EL/Ers |
|---|---|---|
| Needs | Absolute Pes | Only the swings in Pes (to get EL/Ers) |
| Assumes | Pes ≈ local Ppl | Ppl = 0 at zero PEEP / atmospheric (ignores Ppl0) |
| Represents | Middle-to-dependent lung, next to the esophagus | Non-dependent "baby lung", where stress is highest |
| Typical ARDS values | End-expiration −2.8 ± 4.9; end-inflation 8.3 ± 6.2 (Loring 2010) | Higher than direct (Loring 2010) |

Both regional mappings come from Yoshida 2018 (pigs and human cadavers) **[V]**.

**What the simulator should do:** with a two-compartment gradient, both appear on their own.
- Direct PL at end-expiration ≈ PL in the dependent compartment.
- The elastance-derived value ≈ end-inspiratory PL in the non-dependent compartment.

**PEEP titration trials:**
- **EPVent (Talmor 2008) [V]:** PEEP set to keep end-expiratory PL at 0–10 cmH2O on a sliding scale with FiO2, with end-inspiratory PL < 25 **[L]**. PaO2/FiO2 was 88 mmHg better at 72 h.
- **EPVent-2 (Beitler 2019) [V]:** Pes-guided PEEP (end-expiratory PL about 0–6, end-inspiratory PL ≤ 20 **[L]**) versus empirical high PEEP–FiO2. No difference in death or ventilator-free days; less rescue therapy (3.9% vs 12.2%).

---

## 2. Nonlinear mechanics and recruitment

### 2.1 Venegas sigmoid (Venegas 1998) [V]

V = a + b / (1 + exp(−(P − c)/d))

- a = volume of the lower asymptote
- b = difference between the upper and lower asymptotes (roughly inspiratory capacity)
- c = pressure at the true inflection point (maximum compliance)
- d = width parameter
- It fit inflation and deflation limbs of normal and ARDS curves with R² ≈ 0.997.

For simulation, invert it to get elastic recoil from volume:
- P(V) = c − d·ln(b/(V − a) − 1)
- Compliance C(P) = (b/d)·s·(1 − s), where s = 1/(1 + e^−(P−c)/d)
- Maximum compliance is b/(4d), at P = c.

Corner points: the points of maximum curvature fall near c ± 1.317·d; c ± 2d is a more conservative "lower/upper inflection" convention **[L]** (check against the original before quoting).

**Illustrative parameters (lung PL–V, volume above relaxation volume) [M]:**

| Parameter | Normal | ARDS, recruitable | ARDS, consolidated (pulmonary) |
|---|---|---|---|
| a (L) | −0.2 | −0.1 | 0 |
| b (L) | 4.5 | 1.8 | 1.2 |
| c (cmH2O) | 6 | 18 | 12 |
| d (cmH2O) | 5 | 5 | 6 |

Tune b and d so the slope at the operating point matches Table 1 EL. In the pulmonary-ARDS row, a smaller b with no steep limb means little recruitable lung.

Apply the same idea to the chest wall only if needed. The chest wall is nearly linear across the tidal range but stiffens near residual volume and above about 80% of TLC.

### 2.2 Recruitment and overdistension models (simplest first)

**A. Volume-dependent elastance, single compartment.**
- E(V) = E1·(1 + E2·V), the classic E1/E2 model **[L]**. E2 > 0 means overdistension; E2 < 0 means intratidal recruitment.
- Or use the Venegas inverse above.
- This gives stress index and best-compliance behavior cheaply, but not a PEEP-dependent recruited volume.

**B. Recruitable population (simplified Hickling 1998 / Bates–Irvin 2002)**, recommended for teaching:
1. Use N = 20–50 units stacked vertically.
2. Each unit sees a local PL,i = Palv − Ppl(z_i), with Ppl(z) = Ppl_top + G·z (the superimposed-pressure gradient).
3. Opening pressures (TOP_i) follow a normal distribution; Pelosi 2001 **[V]** found a mode of 20–25 cmH2O in oleic-acid dogs, with recruitment continuing along the whole P-V curve. Closing pressures sit 5–10 cmH2O lower **[M]**.
4. A unit opens when PL,i > TOP_i and closes when PL,i < TCP_i.
5. For the time-dependence in Bates and Irvin, move a "virtual trajectory" variable x_i at a rate proportional to (PL,i − TOP_i) and open the unit at x_i = 1. That gives slow recruitment during holds and recruitment maneuvers.
6. Open units add volume with their own (linear or Venegas) elastance; open-unit volume beyond a strain cap stiffens (overdistension).
7. Hickling's emergent behaviors come for free: recruitment keeps going on the linear part of the curve, the lower inflection point does not predict the PEEP needed to prevent collapse, and an upper inflection point at 20–30 cmH2O can reflect waning recruitment rather than overdistension.

**C. Tidal recruitment.** Units that open during inspiration and close during expiration each breath. Count them per breath: this is the "hidden truth" behind a stress index below 1.

**Best-compliance PEEP.** In a decremental PEEP trial with fixed VT, Crs = VT/(Pplat − PEEPtot) traces an inverted U: it rises as PEEP recruits (or keeps open) units and falls as open units overdistend. Model B reproduces this. In pulmonary ARDS (little recruitment), Ers rose from 25.4 to 31.2 at PEEP 15; in extrapulmonary ARDS it fell from 25.9 to 21.4, with 0.293 L recruited versus −0.031 L (Gattinoni 1998 **[V]**). Use these as validation targets.

### 2.3 Stress index [V]

- During constant-flow, passive volume control, fit Paw = a·t^b + c.
- b = 1 (0.9–1.1) was non-injurious in isolated rat lungs (Ranieri 2000). In CT-validated pigs (Grasso 2004), b < 1 tracked tidal recruitment and b > 1 tracked hyperinflation, with r ≈ 0.91–0.92.
- **Simulator:** fit only after the initial resistive step, from about 0.1–0.2 s after flow onset to end-inspiration **[L/M]**. Because flow is constant, R·V′ adds only a constant, so b reflects dE/dV alone.
- It is invalid with active effort, decelerating flow, or a nonlinear chest wall (Ppl nonlinearity contaminates Paw). A transpulmonary stress index can be computed from PL instead.

### 2.4 Recruitment-to-inflation ratio (Chen 2020) [V]

Procedure (single breath):
1. At PEEP 15, release abruptly to PEEP 5 for one breath and measure the extra expired volume ΔVrelease.
2. Predicted volume without recruitment: Vpred = Crs,low × (PEEPhigh − max(PEEPlow, AOP)), where AOP is the airway opening pressure and Crs,low is compliance at low PEEP.
3. Recruited volume: Vrec = ΔVrelease − Vpred.
4. Compliance of the recruited lung: Crec = Vrec / (PEEPhigh − max(PEEPlow, AOP)).
5. **R/I = Crec / Crs,low.**

In the cohort, R/I had a median of 0.5 (range 0–2.0); patients were split around 0.5, with R/I ≥ 0.5 high recruiters **[L]** for the exact operational cutoff. Four of 45 patients had airway closure above high PEEP, so recruitment could not be assessed.

**Simulating it:** run the one-breath release in Model B. Vrec emerges from units that close between PEEP 15 and 5. Also model **complete airway closure**: no flow into a compartment until Paw > AOP (about 5–20 cmH2O when present **[L]**). Otherwise R/I is overestimated and driving pressure misread.

---

## 3. Lung stress and injury metrics

| Metric | Formula | Threshold / anchor | Source |
|---|---|---|---|
| Driving pressure | ΔP = Pplat − PEEPtot = VT/Crs | ≤ 15 cmH2O; each 1-SD increase (~7 cmH2O) → RR of death 1.41 | Amato 2015 **[V]** |
| ΔP versus lung stress | ΔP 15 ↔ lung stress 24 cmH2O (AUC 0.85) | — | Chiumello 2016 **[V]** |
| Transpulmonary driving pressure | ΔPL = ΔP × EL/Ers, or Pes-based | < 10–12 cmH2O. Survivors had lower ΔPL at 24 h; the numeric cutoff is consensus, not from this paper. | Baedorf Kassis 2016 **[V]** for the association; cutoff **[L]** |
| Dynamic ΔPL in assisted breathing | PL,peak − PL,EE | < 15 cmH2O | Goligher 2020 **[V]** |
| Stress | σ = PL,ei ≈ specific lung elastance × strain | Specific elastance 13.4 / 12.6 / 14.4 / 13.5 cmH2O across groups, constant with PEEP and VT | Chiumello 2008 **[V]** |
| Strain | ε = VT/EELV (dynamic); (VPEEP + VT)/FRC (global) | Injury only above 1.5–2: 2.16 ± 0.58 (stress 13 ± 5) injured vs 1.29 ± 0.57 (stress 8 ± 3) not | Protti 2011 **[V]**, healthy pigs, 54 h |
| End-inspiratory PL | Paw,plat − Pes, or elastance-derived | Ceiling 20–25 cmH2O | EPVent / EPVent-2 **[L]** |
| Mechanical power | See below | > 17 J/min associated with mortality; about 12 J/min lethal threshold in piglets | Serpa Neto 2018 **[V]**; Cressoni 2016 **[V]** |

**Strain accounting.** Keep FRC (the relaxation volume at zero PEEP) as a parameter: normal about 1.7 L anesthetized, ARDS about 0.5–1.3 L, obese about 0.67 L. Then:
- PEEP volume VPEEP = ∫ over PEEP of Crs(P) dP, plus recruited volume.
- EELV = FRC + VPEEP.

Note that recruited units add to both "baby lung" volume and FRC. Treat strain as calculated on aerated lung volume only **[M]**.

### Mechanical power formulas

Units: J/min. VT in L. 0.098 converts cmH2O·L to J.

- **Gattinoni 2016, full, volume control [V; formula L]:**
  MP = 0.098·RR·{VT²·[½·Ers + RR·(1 + I:E)/(60·I:E)·Raw] + VT·PEEP}
  Power rises with the square of VT, ΔP and flow, with RR to the 1.4, and linearly with PEEP.
- **Simplified, volume control [L]:** MP = 0.098·RR·VT·(Ppeak − ½·ΔP)
- **Giosa 2019, volume control [V]:** MP = VE·(Ppeak + PEEP + F/6)/20, with VE and flow F in L/min. R² 0.97–0.99 against the reference formula.
- **Becher 2019, pressure control, simplified [V]:** MP = 0.098·RR·VT·(ΔPinsp + PEEP), which is ≈ 0.098·RR·VT·Pplat when flow decays to zero. Mean error 19% versus loop integration (Trinkle 2022 **[V]**).
- **Becher comprehensive and van der Meijden [L]:** these add a rise-time term and an exponential term, ΔPinsp·(1 − e^(−Ti/(R·C))). I could not verify the exact algebra; don't hard-code it from this brief.
- **Recommended for the simulator:** compute the truth by integration, MP = 0.098 × RR × ∫ over inspiration of Paw·dV. Show the bedside surrogate next to it. You can also compute a "lung" power, ∫PL·dV, and a "patient" power, ∫Pmus·dV.

---

## 4. Patient effort metrics

**Muscle pressure and effort integrals:**
- Pmus(t) = Pcw,rec(t) − Pes(t) = Ecw·ΔV(t) − ΔPes(t), referenced to end-expiration.
  - At the bedside, Ecw is assumed (about 4% of predicted vital capacity per cmH2O) or measured passively **[L]**.
  - In the simulator the true Pmus is known. Display the bedside estimate using the corrupted Pes and an assumed Ecw.
- ΔPes = Pes,EE − Pes,min, the inspiratory swing.
- PTPes per breath = ∫ over inspiration of (Pcw,rec − Pes) dt, in cmH2O·s. Per minute = per-breath value × RR.
  - High effort ≥ 200 and low ≤ 50 cmH2O·s/min (Telias 2020 **[V]**).
  - Foti 1997 **[V]** used < 125 as the acceptable band.
- **Work of breathing (Campbell diagram):**
  - Wmus = ∫Pmus·dV, the area between the chest-wall relaxation line and the Pes–V loop plus the elastic and resistive lung area.
  - Add intrinsic PEEP work: the Pes drop needed before flow starts.
  - Passive inflation work, for scale: normal lung 0.34 plus chest wall 0.18 J/L; obese 0.91 plus 0.39 J/L (Pelosi 1996 **[V]**).

**P0.1 (Telias 2020) [V]:**
- The reference P0.1 was measured from airway pressure during a true occlusion.
- P0.1 > 3.5 cmH2O detected high effort (80% sensitive, 77% specific).
- P0.1 ≤ 1.0 cmH2O detected low effort (100% sensitive, 92% specific).
- Ventilator-displayed P0.1 correlates well (within-subject R² 0.8), but ventilators that estimate it **without an occlusion can underestimate** it.
- Normal resting value is about 0.5–1.5 **[L]**.

**ΔPocc (Bertoni 2019) [V]:**
- ΔPocc = the maximal Paw deflection below PEEP during a single-breath end-expiratory occlusion.
- k1 = Pmus/ΔPocc = −0.74 (95% CI −0.69 to −0.78); k2 = ΔPes/ΔPocc = 0.66 (0.61–0.70). Validation used −3/4 and 2/3.
- **Pmus,pred = −0.75·ΔPocc**
- **ΔPL,dyn,pred = (Ppeak − PEEP) − 0.66·ΔPocc.** ΔPocc is negative, so this adds.
- Detects Pmus > 10 with AUROC 0.92, and ΔPL,dyn > 15 with AUROC 0.93.
- **Simulator implication:** if the simulator's Pmus is identical in occluded and unoccluded breaths, k1 comes out at about −1, not −0.75. Model a force–velocity (shortening) penalty: unoccluded Pmus ≈ 0.75 × isometric Pmus **[M]**.

**PMI (pressure muscle index; Foti 1997) [V]:**
- PMI = Pplat during an end-inspiratory hold in pressure support − (PEEP + PS).
- If the patient is still contracting at end-inspiration, muscle relaxation during the hold raises Paw above PEEP + PS.
- PMI > 6 cmH2O suggests high effort; the published result is that the 6 cmH2O threshold identified PTP < 125 cmH2O·s/min with sensitivity and specificity of 0.89.
- Gao 2024 used a peak-referenced variant **[V]**. The maneuver is invalid if the patient actively expires during the hold.

**Target ranges (Goligher 2020, Table 3) [V]:**

| Metric | Floor (avoid disuse) | Ceiling (avoid injury) |
|---|---|---|
| Pmus | ≥ 3–5 | ≤ 10–15 |
| Esophageal pressure swing | at least −2 to −3 | no more negative than −8 to −12 |
| ΔPocc | — | no more negative than −15 to −20 |
| P0.1 | > 1–1.5 | < 3.5–5 |
| Integrated lung- and diaphragm-protective targets | ΔPes 3–8, ΔPL,dyn < 15, pH > 7.25 | |
| Diaphragm electrical activity (EAdi) | < 10 µV almost always abnormally low | |

All values in cmH2O except EAdi.

### P-SILI and pendelluft

**Concept (Brochard, Slutsky, Pesenti 2017) [V]:** strong effort creates large, and regionally concentrated, PL swings plus larger swings in transmural vascular pressure, driving self-inflicted injury.

**Pendelluft (Yoshida 2013) [V]:**
- In injured lungs, diaphragm-generated negative Ppl is **not uniformly transmitted**: local Ppl swing was −13.0 ± 4.0 dependent vs −6.4 ± 3.8 cmH2O non-dependent.
- Gas moves from non-dependent to dependent lung early in inspiration, even with VT < 6 mL/kg.
- Matching dependent-lung inflation under paralysis needed about 3× the driving pressure (28.0 vs 10.3 cmH2O).

**Related findings:**
- Volume control does not prevent this (Yoshida 2017 **[V]**): dependent stress rises while Pes-based PL stays the same, so **Pes underestimates dependent swings**.
- Higher PEEP reduces pendelluft and effort (Pes swing from −5.6 to −2.0 cmH2O; Yoshida 2016 **[V]**).

**Two-compartment implementation [M]:**

For each compartment i ∈ {ND (non-dependent), D (dependent)}:
- Ppl,i = Ppl0,i + Ecw·Vtot − αi·Pmus(t)
  - Ppl0,D − Ppl0,ND = G × height.
  - Use αD ≈ 1.4 and αND ≈ 0.7 in injured lungs and αi = 1 in normal lungs; the weighted mean of α should equal 1.
- Palv,i = Ppl,i + PL,i(Vi), using a Venegas or recruitable-population model per compartment.
- V′i = (Paw,internal − Palv,i)/Ri. Use a shared tube resistance plus compartment resistances: Pint = Paw − Rtube·ΣV′i.
- Solve the small linear system each step. Explicit Euler is stable at 200 Hz when every time constant τ = R·C ≥ 0.05 s; check the stiff case with a low-resistance compartment **[M]**.
- Pendelluft appears as V′ND < 0 while V′D > 0. Display "occult" dependent PL next to the bedside Paw − Pes.

---

## 5. Measurement maneuvers in the simulator

| Maneuver | Mechanics | How to emulate |
|---|---|---|
| Inspiratory hold (Pplat) | Close both valves at end-inspiration, so V′ at the Y-piece = 0. Paw drops quickly from Ppeak to P1 (loss of the R·V′ term), then slowly to P2/Pplat (viscoelastic stress relaxation plus pendelluft redistribution). | Hold 0.3–0.5 s minimum; 1–2 s for P2 **[L]**. Internal compartment flows keep going. Add a Kelvin viscoelastic element (R2, E2) so P1 − P2 = ΔR·V′ before the hold **[M]**. Invalid with leak, active effort (muscle relaxation changes the plateau, which is how PMI works) or expiratory effort. |
| Expiratory hold (total PEEP) | Close at end-expiration; Paw equilibrates to the mean Palv. Intrinsic PEEP = total PEEP − set PEEP. | 2–4 s, or until dPaw/dt ≈ 0 **[L]**. In COPD with heterogeneous τ, show dynamic (Pes-based, the Pes drop before flow starts) versus static intrinsic PEEP; dynamic is lower. |
| P0.1 | Occlusion at the start of inspiratory effort. V is constant, so ΔPaw = ΔPpl = −Pmus(0.1 s). | Record Paw(t0) − Paw(t0 + 100 ms) from the onset of the deflection. Occlusion is unaffected by respiratory mechanics, but hyperinflation and intrinsic PEEP change muscle length and the onset time. |
| ΔPocc | End-expiratory occlusion held for one whole breath; ΔPocc = min Paw − PEEP = −(isometric Pmus). | Use the isometric Pmus (the 1/0.75 scaling above). |
| Occlusion test | Same occlusion; compare ΔPes/ΔPaw. | Exposes balloon errors (k, height, fill volume). |
| Stress index | Passive, constant-flow volume control. | Power-law fit on the Paw segment. |
| R/I | One-breath PEEP release 15 → 5. | See §2.4. |

### What the bedside shows versus what only the simulation knows

| Bedside-measurable | Only knowable in simulation (show in a "truth" layer) |
|---|---|
| Paw, flow, volume; Ppeak, Pplat (passive and at a real plateau), total PEEP/intrinsic PEEP, ΔP, Crs, R, stress index, P0.1, ΔPocc, PMI, R/I | True Palv at every instant, including during flow |
| Pes (offset, damped, artifact-laden), direct PL, Pes-based ΔPes, PTP, Pmus estimate (needs an assumed Ecw) | True Ppl at every height; dependent-lung PL and its swing |
| Elastance-derived PL (needs ΔPes) | True Pmus waveform and neural drive; occluded vs unoccluded Pmus |
| Mechanical power surrogates | Integrated lung power, per-unit strain, tidal-recruitment count, recruited volume, pendelluft volume, true FRC/EELV and strain (bedside needs a nitrogen-washout measurement) |

---

## 6. Summary of thresholds

| Metric | Target / normal | Concerning |
|---|---|---|
| Pplat | ≤ 28–30 | > 30 |
| ΔP (airway driving pressure) | ≤ 15 | > 15 (worse per 7 cmH2O increase) |
| ΔPL | < 10–12 | > 12 |
| ΔPL,dyn (assisted) | < 15 | > 15–20 |
| End-inspiratory PL | < 20–25 | > 25 |
| End-expiratory PL | 0 to +6 (EPVent-2) / 0–10 (EPVent) | < 0 (collapse risk, dependent lung) |
| Strain (VT/EELV) | < ~1.5 | > 1.5–2 |
| Specific lung elastance | ~13.5 | — |
| Mechanical power | < 17 J/min | > 17 J/min |
| Stress index b | 0.9–1.1 | < 0.9 recruitment; > 1.1 overdistension |
| R/I | ≥ 0.5 high recruitability | < 0.5 low |
| ΔPes | 3–8 | > 8–12 vigorous; < 2–3 over-assisted |
| Pmus | 5–10 | > 10–15 |
| P0.1 | 1–3.5 | > 3.5–4 high drive; ≤ 1 low |
| ΔPocc | −5 to −15 | more negative than −15 to −20 |
| PMI | ≤ 6 | > 6 |
| PTPes per minute | 50–200 | ≥ 200 high; ≤ 50 low |

All in cmH2O unless noted. The Pplat ≤ 28–30 limit is from ARDSNet-era practice **[L]**; the others are sourced in §3–4.

---

## References

**Partitioning and esophageal manometry**
- Gattinoni L et al. ARDS caused by pulmonary and extrapulmonary disease. Am J Respir Crit Care Med 1998;158:3–11. [doi:10.1164/ajrccm.158.1.9708031](https://doi.org/10.1164/ajrccm.158.1.9708031)
- Pelosi P et al. Respiratory mechanics in morbidly obese patients. Chest 1996;109:144–151. [doi:10.1378/chest.109.1.144](https://doi.org/10.1378/chest.109.1.144)
- Behazin N et al. Elevated pleural and esophageal pressures in morbid obesity. J Appl Physiol 2010;108:212–218. [doi:10.1152/japplphysiol.91356.2008](https://doi.org/10.1152/japplphysiol.91356.2008)
- Loring SH et al. Esophageal pressures in acute lung injury. J Appl Physiol 2010;108:515–522. [doi:10.1152/japplphysiol.00835.2009](https://doi.org/10.1152/japplphysiol.00835.2009)
- Talmor D et al. Esophageal and transpulmonary pressures in acute respiratory failure. Crit Care Med 2006;34:1389–1394. [doi:10.1097/01.CCM.0000215515.49001.A2](https://doi.org/10.1097/01.CCM.0000215515.49001.A2)
- Washko GR et al. Postural effects on esophageal and transpulmonary pressures. J Appl Physiol 2006. [PubMed 16306256](https://pubmed.ncbi.nlm.nih.gov/16306256/) · [doi:10.1152/japplphysiol.00697.2005](https://doi.org/10.1152/japplphysiol.00697.2005)
- Yoshida T et al. Esophageal manometry and regional transpulmonary pressure in lung injury. Am J Respir Crit Care Med 2018;197:1018–1026. [doi:10.1164/rccm.201709-1806OC](https://doi.org/10.1164/rccm.201709-1806OC)
- Baydur A et al. Occlusion test for the esophageal balloon. Am Rev Respir Dis 1982;126:788–791. [doi:10.1164/arrd.1982.126.5.788](https://doi.org/10.1164/arrd.1982.126.5.788)
- Mojoli F et al. In vivo calibration of esophageal pressure. Crit Care 2016;20:98. [doi:10.1186/s13054-016-1278-5](https://ccforum.biomedcentral.com/articles/10.1186/s13054-016-1278-5)
- Mojoli F et al. Technical aspects of bedside transpulmonary pressure monitoring. Ann Transl Med. [atm.amegroups.org](https://atm.amegroups.org/article/view/21270/21281)
- Akoumianaki E et al. Esophageal pressure measurement in respiratory failure. Am J Respir Crit Care Med 2014;189:520–531. [doi:10.1164/rccm.201312-2193CI](https://doi.org/10.1164/rccm.201312-2193CI)
- Mauri T et al. Esophageal and transpulmonary pressure in the clinical setting. Intensive Care Med 2016;42:1360–1373. [doi:10.1007/s00134-016-4400-x](https://doi.org/10.1007/s00134-016-4400-x)
- Vertical pleural pressure gradient, normal humans: [PubMed 508980](https://pubmed.ncbi.nlm.nih.gov/508980/) · [Lai-Fook, Physiol Rev 2004](https://journals.physiology.org/doi/full/10.1152/physrev.00026.2003)
- Pelosi P et al. Vertical gradient of regional lung inflation in ARDS. Am J Respir Crit Care Med 1994;149:8–13. [doi:10.1164/ajrccm.149.1.8111603](https://doi.org/10.1164/ajrccm.149.1.8111603)
- Pelosi P et al. Recruitment and derecruitment during acute respiratory failure. Am J Respir Crit Care Med 2001;164:122–130. [doi:10.1164/ajrccm.164.1.2007010](https://doi.org/10.1164/ajrccm.164.1.2007010)
- Cardiac-artifact frequency bands: [PMC11164798](https://pmc.ncbi.nlm.nih.gov/articles/PMC11164798/)

**PEEP titration by esophageal pressure**
- Talmor D et al. EPVent. N Engl J Med 2008;359:2095–2104. [doi:10.1056/NEJMoa0708638](https://doi.org/10.1056/NEJMoa0708638)
- Beitler JR et al. EPVent-2. JAMA 2019;321:846–857. [doi:10.1001/jama.2019.0555](https://doi.org/10.1001/jama.2019.0555)

**Nonlinear mechanics and recruitment**
- Venegas JG et al. A comprehensive equation for the pulmonary P-V curve. J Appl Physiol 1998;84:389–395. [doi:10.1152/jappl.1998.84.1.389](https://doi.org/10.1152/jappl.1998.84.1.389)
- Hickling KG. The P-V curve is greatly modified by recruitment. Am J Respir Crit Care Med 1998;158:194–202. [doi:10.1164/ajrccm.158.1.9708049](https://doi.org/10.1164/ajrccm.158.1.9708049)
- Ranieri VM et al. Pressure-time curve predicts minimally injurious ventilation. Anesthesiology 2000;93:1320–1328. [doi:10.1097/00000542-200011000-00027](https://doi.org/10.1097/00000542-200011000-00027)
- Grasso S et al. Stress index detects tidal recruitment/hyperinflation. Crit Care Med 2004;32:1018–1027. [doi:10.1097/01.CCM.0000120059.94009.AD](https://doi.org/10.1097/01.CCM.0000120059.94009.AD)
- Chen L et al. Recruitment-to-inflation ratio. Am J Respir Crit Care Med 2020;201:178–187. [doi:10.1164/rccm.201902-0334OC](https://doi.org/10.1164/rccm.201902-0334OC)
- Hamilton Medical, R/I single-breath method: [hamilton-medical.com](https://www.hamilton-medical.com/en_US/Article-page~knowledge-base~d54d93b4-a4e9-4c13-ae9c-c2bf1f4203b0~Bedside-tools-for-assessing--de-recruitability~.html)

**Stress, strain and driving pressure**
- Amato MBP et al. Driving pressure and survival in ARDS. N Engl J Med 2015;372:747–755. [doi:10.1056/NEJMsa1410639](https://doi.org/10.1056/NEJMsa1410639)
- Baedorf Kassis E et al. Respiratory system and transpulmonary driving pressures in ARDS. Intensive Care Med 2016;42:1206–1213. [doi:10.1007/s00134-016-4403-7](https://doi.org/10.1007/s00134-016-4403-7)
- Chiumello D et al. Lung stress and strain in ARDS. Am J Respir Crit Care Med 2008;178:346–355. [doi:10.1164/rccm.200710-1589OC](https://doi.org/10.1164/rccm.200710-1589OC)
- Chiumello D et al. Airway driving pressure and lung stress. Crit Care 2016;20:276. [doi:10.1186/s13054-016-1446-7](https://doi.org/10.1186/s13054-016-1446-7)
- Protti A et al. Lung stress and strain: any safe threshold? Am J Respir Crit Care Med 2011;183:1354–1362. [doi:10.1164/rccm.201010-1757OC](https://doi.org/10.1164/rccm.201010-1757OC)

**Mechanical power**
- Gattinoni L et al. The mechanical power. Intensive Care Med 2016;42:1567–1575. [doi:10.1007/s00134-016-4505-2](https://doi.org/10.1007/s00134-016-4505-2)
- Cressoni M et al. Mechanical power and VILI. Anesthesiology 2016;124:1100–1108. [doi:10.1097/ALN.0000000000001056](https://doi.org/10.1097/ALN.0000000000001056)
- Serpa Neto A et al. Mechanical power and mortality. Intensive Care Med 2018;44:1914–1922. [doi:10.1007/s00134-018-5375-6](https://doi.org/10.1007/s00134-018-5375-6)
- Giosa L et al. Mechanical power at a glance. Intensive Care Med Exp 2019;7:61. [doi:10.1186/s40635-019-0276-8](https://icm-experimental.springeropen.com/articles/10.1186/s40635-019-0276-8)
- Becher T et al. Mechanical power for pressure-controlled ventilation. Intensive Care Med 2019;45:1321–1323. [doi:10.1007/s00134-019-05636-8](https://link.springer.com/article/10.1007/s00134-019-05636-8)
- Trinkle CA et al. Mechanical power in PCV. Intensive Care Med Exp 2022;10:22. [doi:10.1186/s40635-022-00448-5](https://pmc.ncbi.nlm.nih.gov/articles/PMC9148680/)
- Hamilton Medical, mechanical power estimation: [hamilton-medical.com](https://www.hamilton-medical.com/en_US/Resource-center/Article-page~knowledge-base~f40239e0-e478-43ad-ba33-121f81fe632b~How-to-estimate-mechanical-power-in-volume--and-pressure-control-ventilation~.html)

**Effort, P-SILI and pendelluft**
- Telias I et al. P0.1 as an estimate of drive and effort. Am J Respir Crit Care Med 2020;201:1086–1098. [doi:10.1164/rccm.201907-1425OC](https://doi.org/10.1164/rccm.201907-1425oc)
- Bertoni M et al. ΔPocc to detect high effort and ΔPL,dyn. Crit Care 2019;23:346. [doi:10.1186/s13054-019-2617-0](https://ccforum.biomedcentral.com/articles/10.1186/s13054-019-2617-0) (PMC6836358)
- Foti G et al. End-inspiratory occlusion (PMI). Am J Respir Crit Care Med 1997;156:1210–1216. [doi:10.1164/ajrccm.156.4.96-02031](https://doi.org/10.1164/ajrccm.156.4.96-02031)
- Gao R et al. PMI in pressure support. Front Med 2024;11:1390878. [doi:10.3389/fmed.2024.1390878](https://doi.org/10.3389/fmed.2024.1390878)
- Goligher EC et al. Lung- and diaphragm-protective ventilation. Am J Respir Crit Care Med 2020;202:950–961. [doi:10.1164/rccm.202003-0655CP](https://www.atsjournals.org/doi/abs/10.1164/rccm.202003-0655CP)
- Brochard L, Slutsky A, Pesenti A. Minimizing progression of lung injury. Am J Respir Crit Care Med 2017;195:438–442. [doi:10.1164/rccm.201605-1081CP](https://doi.org/10.1164/rccm.201605-1081CP)
- Yoshida T et al. Occult pendelluft. Am J Respir Crit Care Med 2013;188:1420–1427. [doi:10.1164/rccm.201303-0539OC](https://doi.org/10.1164/rccm.201303-0539OC)
- Yoshida T et al. Spontaneous effort: maximal injury with less PEEP. Crit Care Med 2016;44:e678–688. [doi:10.1097/CCM.0000000000001649](https://doi.org/10.1097/CCM.0000000000001649)
- Yoshida T et al. Volume control does not prevent injurious inflation. Am J Respir Crit Care Med 2017;196:590–601. [doi:10.1164/rccm.201610-1972OC](https://doi.org/10.1164/rccm.201610-1972OC)

---

**Gaps I couldn't close:**
- The exact Becher comprehensive and van der Meijden pressure-control formulas; integrate the P-V loop in the simulator instead.
- The cardiac-artifact amplitude in cmH2O.
- COPD and abdominal-hypertension partition values (no primary source checked).
- The ARDS pleural-gradient magnitude and the illustrative Venegas parameters.
- The EPVent / EPVent-2 end-inspiratory ceilings (≤ 25 and ≤ 20).
- The ΔPL < 10–12 cutoff, which is consensus rather than trial-derived.

All of these are labeled **[L]** or **[M]** above.
