# Validation

How "done" is judged (spec §9), the tests that cover each item, and the current numbers. Everything below
runs in CI (`npm test`, `npm run test:e2e`); the in-app Validation page (`#validation`) renders the
emergence matrix and the per-pattern confusion matrices from `src/validation/snapshot.json`
(`npx tsx scripts/validation-snapshot.ts`, regenerate after any scenario or detector change) and can
recompute them in the browser.

Totals (2026-09-11): Vitest 180 tests in 30 files; Playwright 25 tests (+ 6 screenshot tests behind
`SCREENSHOTS=1`); lint and build clean.

## §9.1 Analytic physics — `tests/physics/analytic.test.ts` (7)

| Item | Test | Result |
|---|---|---|
| Passive PC Vt = C·ΔP·(1 − e^(−Ti/τ)) | within 2 % (ideal ventilator), 3 % (realistic servo) | pass |
| Passive VC Ppeak − Pplat = R·Q | pass | pass |
| Mass balance ∫insp − ∫exp = ΔEELV + leak | per breath | pass |
| Steady-state intrinsic PEEP vs e^(−Te/τ) | pass | pass |
| No Pmus, no noise → no triggers, AI = 0 | pass | pass |
| Byte-identical streams for the same seed | pass | pass |

## §9.2 Partition — `tests/physics/partition.test.ts` (8), `recruitment.test.ts` (4), `stress-index.test.ts` (4)

| Item | Result |
|---|---|
| ΔPL/ΔPaw = EL/Ers within 15 % for four passive presets at PEEP 5 (static Ers within 25 % of Table 1) | pass |
| Obesity: Ppl0 > 5, negative PL,ee at PEEP 5, dependent region more negative; normal PL,ee > 0 | pass |
| Specific lung elastance 11.5–15.5 (Chiumello 2008: 13.5 ± 2) across normal / ARDS / obesity | pass |
| Gattinoni 1998 direction, Venegas recoil: pulmonary Ers 25.3 → 29.2, extrapulmonary 24.1 → 21.4 (PEEP 0 → 15) | pass |
| Gattinoni 1998 direction, recruitable lung: extrapulmonary 25.1 → 22.7 with 0.22 L recruited; pulmonary 26.4 → 34.9 with none | pass |
| Inspiratory hold P1 − P2 drop 0.5–6 cmH2O, P2 = Pplat; linear EELV shift = PEEP/Ers; no pendelluft in passive lungs | pass |
| Tidal recruitment at PEEP 2 / 10 mL/kg, kept open at PEEP 16; decremental steps best PEEP between 8 and 16 | pass |
| Stress index: fit recovers b = 0.8/1.0/1.25; linear lung 0.9–1.1; consolidated ARDS at Pplat ≈ 50 b < 0.9 with ≥ 2 units cycling; normal lung at PEEP 15 / 13 mL/kg b > 1.1; none on PC or patient-triggered breaths | pass |

## §9.3 Effort calibration — `tests/physics/effort-calibration.test.ts` (4)

| Item | Result |
|---|---|
| ΔPocc → Pmus: Bertoni k1 = −0.736 (target −0.74 ± 0.05), k2 = 0.62–0.64 (0.66 ± 0.05) on a 20-point PSV grid | pass |
| P0.1 within 0.3 + 5 % of the analytic Pmus at 100 ms for Pmax 6/12/20 | pass |
| Balloon occlusion test 0.8–1.2 when well placed; 0.5 mL fill and gastric placement fail | pass |
| PMI rises with effort | pass |

## §9.4 Emergence matrix — `tests/scenarios/emergence.test.ts` (22)

Every scenario with target patterns: the target present in ≥ the scenario's minimum fraction of breaths
(efforts for ineffective effort) between 10 s and the fix at 60 s, AI < 10 % within 60 s after the scripted
fix, no pattern on the passive baseline. Rows on the Validation page. 31 scenarios ship in the library; 20
of them carry target patterns and get an emergence row each: double-trigger, flow-starvation,
ineffective-effort, reverse-trigger, auto-trigger, leak-psv, premature-cycling, copd-auto-peep, secretions,
bronchospasm, pneumothorax, mainstem, co2-under-assist, capstone (five coexisting patterns: ineffective
effort, delayed cycling, auto-PEEP, leak, secretions), simv-low-support, simv-mixed-breaths, simv-stacking
(D-022), prvc-pressure-withdrawal, prvc-volume-not-achieved, prvc-double-trigger (D-023) (+ the passive
baseline).

## §9.5 Detector on the held-out grid — `tests/detector/heldout.test.ts` (9)

Seeds 101–104 with perturbed settings and drive, never used for tuning (tuning grid: seeds 1–4, 36 cases).
Sensitivity / specificity:

| Pattern | Held-out | Target |
|---|---|---|
| ineffective effort | 0.93 / 0.99 | 0.85 / 0.90 |
| double trigger | 0.99 / 1.00 | 0.85 / 0.90 |
| auto-trigger | 0.97 / 0.99 | 0.85 / 0.90 |
| premature cycling | 0.95 / 0.99 | 0.85 / 0.90 |
| delayed cycling | 0.84 / 0.98 | 0.85 / 0.90 (accepted floor 0.80, D-012) |
| flow starvation | 0.91 / 0.98 | 0.85 / 0.90 |
| reverse trigger | 0.85 / 1.00 | 0.75 / 0.90 |

Non-core patterns are reported on the Validation page only (high resistance, leak, secretions, auto-PEEP,
low compliance, delayed trigger). The measurement basis and the one missed target are in D-012.

## §9.6 Determinism — `tests/physics/determinism.test.ts` (4), `tests/unit/session.test.ts`

Two independent runs of every scenario are byte-identical on all channels, breaths and events; labels,
maneuvers and the CO2 log repeat exactly; the worker session gives the same stream for any chunking and it
equals the headless stream; a different seed differs. The CO2 warp changes only the CO2 clock
(`tests/physics/co2.test.ts`: byte-identical streams at warp 1 and 60 with the loop gains at zero).

## §9.7 Performance — `tests/physics/performance.test.ts`, `tests/e2e/load.spec.ts`

Headless runs ≥ 50× real time for the heaviest scenarios (CO2 loop, recruitable lung, spontaneous breathing;
measured ≈ 60–100× on the build machine); the batch generator relies on it. The live UI draws 7 waveform
rows and 4 loops in ≈ 1.5 ms per frame at 60 fps headless (`load.spec.ts` asserts < 8 ms); the analysis pass
on each closed breath costs 10–40 ms off the animation frame (`m6.spec.ts` asserts < 150 ms).

## §9.8 End-to-end — Playwright (`tests/e2e/*.spec.ts`)

App loads with the disclaimer; a scenario starts and draws moving waveforms; a setting stays pending until
confirmed and then changes the waveform and monitor; the truth layer adds channels and loops; pause,
freeze, scroll-back and speed work; holds, P0.1, R/I and the PEEP trial produce their readouts; the CO2
panel moves with the warp; badges are labelled live with evidence on hover; the AI tile turns red; injectors
change the measured signals; the suggested fix lowers AI; the quiz completes (identify → fix → score,
progress persisted); CSV, JSON and a batch zip download; the Validation page renders; no serious axe
violations on the main and validation pages; keyboard operability of tabs and buttons.

## M7 maneuvers — `tests/physics/ri.test.ts` (7), `co2.test.ts` (9), `tests/unit/power.test.ts` (3)

R/I: recruiter scenario ≥ 0.3 with all pieces reported and PEEP restored, phenotype ordering
(extrapulmonary preset intermediate, consolidated < 0.1, normal ≈ 0), works in PC; decremental trial:
9 steps from 20 to 4, best PEEP 8–18 for the recruiter with both ends worse, ≤ 10 for the non-recruiter,
alarm-stall recovery; CO2: τ at the reference ventilation, delay line, bounded apneic rise, steady state
within 5 % of 0.863·VCO2/VA, over-assist apnea → backup → recovery, under-assist drive rise, both scenarios
with their fixes; Gattinoni 2016 full power equals ∫Paw·dV of a linear lung within 8 %.

## M8 education and export — `tests/unit/{cards,quiz,quiz-session,progress,export}.test.ts` (24)

Every pattern has a complete card; case evidence names the neural and ventilator Ti and the cycling delay;
identification grading (Jaccard), fix grading (limits, unverified plateau, extras), composite score;
progress survives a throwing storage and corrupt JSON; CSV shape with and without truth; JSON schema
`ventsim-session/1`; batch grid + zip round trip with a manifest.

## Detector in SIMV and PRVC (reported, not gated; D-022, D-023)

`npx tsx scripts/mode-detector-report.ts` (`tests/physics/prvc.test.ts` covers the regulator itself;
`tests/detector/prvc.test.ts` covers the detector rule below) runs each scenario's pre-fix (dyssynchronous)
60 s segment and compares the signal-only detector's per-breath patterns against the truth labeler's,
breath by breath (first 10 s excluded as settling time). These numbers are informative only — the gated
targets remain the held-out grid in §9.5, which contains no SIMV or PRVC breaths.

The stacked-mandatory truth rule (a time-triggered breath starting inside a neural inspiration that already
triggered the previous breath) is exercised only by the synthetic `labelBreaths` test in
`tests/unit/labeler.test.ts`; no shipped scenario produces it — see D-022 for why.

The PRVC detector rule for `support-withdrawal` (D-023) is: the regulated pressure is within
`LABEL_SUPPORT_WITHDRAWAL_MARGIN` (1 cmH2O) of the floor, the breath is patient-triggered, and the measured
Vti is ≥ `DET_SW_VT_EXCESS` (1.05) × the set target — the floor, the trigger cause and the volume excess,
not the Paw ramp shape (the drafted `earlySag` conjunct never separated the case; see D-023). By
construction this rule misses time- or reverse-triggered support-withdrawal breaths, since it requires a
patient trigger; the truth labeler still scores those breaths (it judges the regulated pressure and effort
only), so `prvc-pressure-withdrawal`'s sensitivity below (0.20) reflects that gap, not a detector bug — most
of its support-withdrawal breaths in this scenario are not patient-triggered.

| Scenario | Pattern | tp | fp | tn | fn | Sens | Spec |
|---|---|---|---|---|---|---|---|
| simv-low-support | ineffective-effort | 0 | 4 | 8 | 0 | NaN | 0.67 |
| simv-low-support | double-trigger | 0 | 0 | 12 | 0 | NaN | 1.00 |
| simv-low-support | flow-starvation | 0 | 6 | 6 | 0 | NaN | 0.50 |
| simv-low-support | auto-peep | 1 | 0 | 0 | 11 | 0.08 | NaN |
| simv-low-support | support-withdrawal | 0 | 0 | 12 | 0 | NaN | 1.00 |
| simv-low-support | high-resistance | 0 | 0 | 12 | 0 | NaN | 1.00 |
| simv-mixed-breaths | ineffective-effort | 0 | 0 | 29 | 0 | NaN | 1.00 |
| simv-mixed-breaths | double-trigger | 3 | 5 | 21 | 0 | 1.00 | 0.81 |
| simv-mixed-breaths | flow-starvation | 3 | 1 | 25 | 0 | 1.00 | 0.96 |
| simv-mixed-breaths | auto-peep | 15 | 8 | 0 | 6 | 0.71 | 0.00 |
| simv-mixed-breaths | support-withdrawal | 0 | 0 | 29 | 0 | NaN | 1.00 |
| simv-mixed-breaths | high-resistance | 0 | 0 | 29 | 0 | NaN | 1.00 |
| simv-stacking | ineffective-effort | 0 | 0 | 27 | 0 | NaN | 1.00 |
| simv-stacking | double-trigger | 4 | 1 | 20 | 2 | 0.67 | 0.95 |
| simv-stacking | flow-starvation | 0 | 0 | 27 | 0 | NaN | 1.00 |
| simv-stacking | auto-peep | 16 | 0 | 0 | 11 | 0.59 | NaN |
| simv-stacking | support-withdrawal | 0 | 0 | 27 | 0 | NaN | 1.00 |
| simv-stacking | high-resistance | 0 | 0 | 27 | 0 | NaN | 1.00 |
| prvc-pressure-withdrawal | ineffective-effort | 0 | 0 | 21 | 0 | NaN | 1.00 |
| prvc-pressure-withdrawal | double-trigger | 0 | 0 | 21 | 0 | NaN | 1.00 |
| prvc-pressure-withdrawal | flow-starvation | 0 | 0 | 21 | 0 | NaN | 1.00 |
| prvc-pressure-withdrawal | auto-peep | 16 | 4 | 1 | 0 | 1.00 | 0.20 |
| prvc-pressure-withdrawal | support-withdrawal | 3 | 0 | 6 | 12 | 0.20 | 1.00 |
| prvc-pressure-withdrawal | high-resistance | 0 | 0 | 21 | 0 | NaN | 1.00 |
| prvc-volume-not-achieved | ineffective-effort | 0 | 0 | 10 | 0 | NaN | 1.00 |
| prvc-volume-not-achieved | double-trigger | 0 | 0 | 10 | 0 | NaN | 1.00 |
| prvc-volume-not-achieved | flow-starvation | 0 | 0 | 10 | 0 | NaN | 1.00 |
| prvc-volume-not-achieved | auto-peep | 9 | 0 | 0 | 1 | 0.90 | NaN |
| prvc-volume-not-achieved | support-withdrawal | 0 | 0 | 10 | 0 | NaN | 1.00 |
| prvc-volume-not-achieved | high-resistance | 0 | 0 | 4 | 6 | 0.00 | 1.00 |
| prvc-double-trigger | ineffective-effort | 0 | 0 | 23 | 0 | NaN | 1.00 |
| prvc-double-trigger | double-trigger | 7 | 0 | 16 | 0 | 1.00 | 1.00 |
| prvc-double-trigger | flow-starvation | 0 | 0 | 23 | 0 | NaN | 1.00 |
| prvc-double-trigger | auto-peep | 8 | 11 | 0 | 4 | 0.67 | 0.00 |
| prvc-double-trigger | support-withdrawal | 0 | 0 | 23 | 0 | NaN | 1.00 |
| prvc-double-trigger | high-resistance | 0 | 0 | 23 | 0 | NaN | 1.00 |
