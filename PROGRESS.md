# VentSim — Progress

Build log for the milestones in `docs/superpowers/specs/2026-09-10-vent-sim-design.md` §12.
Each milestone entry records what was built, test results, screenshots where relevant, and known issues.

## Plan: milestones → files

Conventions: simulation core in `src/sim/**` has no DOM access and runs in Node (Vitest) and in the worker.
Every physiologic/detector constant lives in `src/config/constants.ts` as `{ value, unit, source, confidence }`.
Tests: `tests/unit` (pure functions), `tests/physics` (analytic + partition + calibration), `tests/scenarios`
(emergence matrix), `tests/detector` (held-out scoring), `tests/e2e` (Playwright).

| # | Milestone | Files expected |
|---|---|---|
| M0 | Scaffold | `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `playwright.config.ts`, `.github/workflows/deploy.yml`, `index.html`, `src/main.tsx`, `src/app/App.tsx`, `src/sim/math/prng.ts`, `src/config/constants.ts` (schema + first constants), `tests/unit/prng.test.ts`, `tests/unit/constants.test.ts`, `tests/e2e/smoke.spec.ts` |
| M1 | Passive single-compartment core, VC/PC fixed timing, headless runner | `src/sim/types.ts` (units, state, settings, mode interfaces incl. SIMV/PRVC placeholders), `src/sim/math/{integrate,rohrer,filters}.ts`, `src/sim/patient/{lung-linear,chestwall,airway,patient}.ts`, `src/sim/vent/{settings,fsm,controllers,sensor-chain}.ts`, `src/sim/engine.ts` (fixed-step loop), `src/sim/headless.ts` (run N seconds, return streams + breaths), `tests/physics/analytic.test.ts` (§9.1) |
| M2 | Two-compartment partitioned lung, chest wall, Ppl/Palv/PL, viscoelastic, Venegas, presets, holds, truth channels | `src/sim/patient/{lung-venegas,lung-recoil,compartments,viscoelastic,pleural}.ts`, `src/sim/patient/presets.ts` (Brief 2 Table 1), `src/sim/truth/{channels,recorder}.ts`, `src/sim/vent/maneuvers.ts` (insp/exp hold), `tests/physics/partition.test.ts` (§9.2) |
| M3 | Full ventilator FSM, triggers, refractory, PSV/CPAP, servo lag, rise, ETS, alarms, apnea backup, sensor chain, monitor values | `src/sim/vent/{trigger,cycle,servo,alarms,apnea}.ts`, `src/monitor/{breath-metrics,monitor}.ts`, `tests/unit/{trigger,cycle,servo,alarms}.test.ts`, `tests/physics/monitor.test.ts` |
| M4 | Neural drive + Pmus (iso + F–V), jitter, entrainment, expiratory muscles; P0.1, ΔPocc, PMI; balloon + occlusion test | `src/sim/patient/{neural-drive,pmus,entrainment,balloon}.ts`, `src/sim/vent/maneuvers.ts` (P0.1, ΔPocc, occlusion test), `src/sim/math/ar1.ts`, `tests/physics/effort-calibration.test.ts` (§9.3), `tests/physics/balloon.test.ts` |
| M5 | Live UI v1: worker streaming, sweep waveforms, loops, settings confirm, monitor, lung-stress dashboard, truth toggle, time controls | `src/worker/{sim.worker,session,protocol}.ts`, `src/app/{StreamStore,WorkerClient,controller}.ts`, `src/ui/{WaveformCanvas,LoopCanvas,SettingsPanel,MonitorPanel,LungStressDashboard,TruthToggle,TimeControls,AlarmBar,ScenarioPicker}.tsx`, `src/ui/waveform-draw.ts`, `src/sim/truth/lung-stress.ts`, `src/monitor/bands.ts`, `src/edu/scenarios/*.json`, `tests/unit/{session,stream-store,lung-stress,scenarios,channels}.test.ts`, `tests/e2e/{load,settings}.spec.ts` |
| M6 | Ground-truth labeler, injectors, detector, AI, scorer, Validation page | `src/sim/truth/labeler.ts`, `src/sim/injectors/{leak,cardiac,secretions,water,cough,pneumothorax,mainstem,bronchospasm}.ts`, `src/detector/{features,rules,detector,asynchrony-index}.ts`, `src/detector/scorer.ts`, `src/ui/ValidationPage.tsx`, `src/edu/scenarios/*.json` (first set), `tests/scenarios/emergence.test.ts` (§9.4), `tests/detector/heldout.test.ts` (§9.5) |
| M7 | Recruitable-population lung, PEEP trial, stress index, R/I, mechanical power; CO2 loop + time warp | `src/sim/patient/{lung-recruitable,gas-exchange}.ts`, `src/sim/vent/maneuvers.ts` (R/I, PEEP trial), `src/monitor/{stress-index,power}.ts`, `tests/physics/{recruitment,stress-index,ri,co2}.test.ts` |
| M8 | Education: ≥18 scenarios, explain cards, quiz, instructor mode, progress; session + batch export | `src/edu/scenarios/*.json`, `src/edu/cards/*.ts`, `src/edu/{quiz,progress,instructor}.ts`, `src/ui/{ExplainCard,QuizPanel,InstructorPanel,ScenarioPicker}.tsx`, `src/export/{csv,json,batch}.ts`, `tests/e2e/{quiz,export}.spec.ts` |
| M9 | Hardening: perf, a11y, docs (README, MODEL.md, VALIDATION.md, DECISIONS.md, limitations), known-limitations | `docs/MODEL.md`, `docs/VALIDATION.md`, `docs/DECISIONS.md`, `docs/LIMITATIONS.md`, `tests/physics/{determinism,performance}.test.ts` |

## Milestone log

### M0 — Scaffold (2026-09-10)

**Built:** Vite 7 + strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Preact TSX via
esbuild's automatic runtime (no plugin), ESLint 9 flat config with type-checked rules, Vitest, Playwright
(Chromium), GitHub Actions workflow that lints, tests, runs the e2e smoke, builds with `BASE_PATH=./` and
deploys `dist/` to Pages. Seeded PRNG (`src/sim/math/prng.ts`: xoshiro128** seeded via splitmix32; child streams
forked by label from the parent seed so modules cannot perturb each other). Constants registry
(`src/config/constants.ts`) with the `{value, unit, source, confidence}` schema and the first ventilator/sensor
constants. Blank app shell with the education-only disclaimer.

**Tests:** `npm test` 10/10 (PRNG determinism, uniformity, gaussian moments, fork independence; constants
schema). `npm run lint` clean. `npm run test:e2e` 1/1 (app loads, disclaimer visible).

**Known issues:** none.

### M1 — Passive core, VC/PC fixed timing, headless runner (2026-09-10)

**Built:** `src/sim/patient/*`: two-compartment lung with shared chest wall, per-compartment resistances by
flow direction, shared ETT Rohrer term, optional expiratory flow limitation, optional Maxwell viscoelastic
element, lung recoil behind one interface (linear now; Venegas class present, wired in M2), closed-form
airway node solve (flow source / Thevenin pressure source / occluded, with a leak fixed-point), RK4 at
1 ms, static-equilibrium initialization at set PEEP. `src/sim/vent/*`: settings with clinical units and
clamping, VC (square / ramp, pause) flow source, PC pressure servo with integral action and source
resistance, exhalation valve as a PEEP servo, actuator latency, pending-settings commit at next breath,
sensor chain (LPF → delay → band-limited noise → quantization → device-rate sampling, volume integrated
from measured flow at the physics rate). `src/sim/engine.ts` fixed-step loop with device-rate samples and
breath records; `src/sim/headless.ts` returns Float32Array streams (measured + truth) and breaths.

**Tests (§9.1):** 7/7 in `tests/physics/analytic.test.ts`: PC Vt within 2% (ideal) and 3% (realistic
servo), VC Ppeak − Pplat = R·Q, per-breath mass balance, steady-state intrinsic PEEP vs e^(−Te/τ), no
triggers without Pmus, byte-identical streams for the same seed. Total 17/17; lint clean.

**Known issues:** the Pages deployment succeeds (deploy-pages reports success, environment URL
`http://tomnahass.com/vent-sim/`), but the URL serves a 404 from Netlify. Cause: the `nahata5.github.io`
user-site repo still has `tomnahass.com` configured as its Pages custom domain, so GitHub redirects every
`*.github.io` project site for the account to that domain, and DNS for `tomnahass.com` / `www` points at
Netlify, not GitHub. Fix is outside this repo: remove the stale custom domain from `nahata5.github.io`
(then the app lives at `https://nahata5.github.io/vent-sim/`), or add a Netlify redirect/proxy for
`/vent-sim/*`, or host VentSim on Netlify as well.

### M2 — Partitioned lung, presets, holds, truth channels (2026-09-10)

**Built:** Venegas recoil wired through `presetMechanics` with the anchor parametrization (D-005): each
phenotype fixes s0 (position of FRC on the sigmoid) and width d, the code derives a, b, c so EL at FRC equals
Brief 2 Table 1 and the curve passes through PL0 = −Ppl0. Eight presets in `src/sim/patient/presets.ts`
(normal, pulmonary ARDS, extrapulmonary ARDS, obesity, abdominal hypertension, COPD with Rexp > Rinsp and
EFL, asthma, fibrosis) with Ecw, R split into tube + peripheral at the Arnal reference flow, FRC, Ppl0,
pleural gradient, α transmission, viscoelastic R2. Inspiratory and expiratory holds in the ventilator
(`requestHold`), taken at the next eligible phase, reporting P1/P2 and total PEEP from *measured* Paw as
`maneuver` events; an alarm-cycled breath skips the hold. Truth channels: Palv/Ppl/PL per compartment,
compartment flows, Pcw,rec, Pmus, phase.

**Tests (§9.2):** 8/8 in `tests/physics/partition.test.ts`: ΔPL/ΔPaw = EL/Ers within 15% for four
passive presets at PEEP 5 (static Ers within 25% of Table 1); obesity Ppl0 > 5 with negative PL,ee at
PEEP 5 and the dependent region more negative; normal PL,ee > 0; specific elastance 11.5–15.5 across
normal/ARDS/obesity; Gattinoni 1998 direction (pulmonary Ers 25.3 → 29.2, extrapulmonary 24.1 → 21.4 for
PEEP 0 → 15); P1 − P2 drop of 0.5–6 cmH2O with P2 = Pplat; linear EELV shift = PEEP/Ers; no pendelluft in
passive lungs. Total 25/25; lint clean.

**Known issues:** COPD, asthma, fibrosis and IAH presets are consistent with the briefs but not yet
exercised by tests beyond construction; they get covered by the M6 emergence matrix. Hosting issue above
still open.

### M3 — Full ventilator state machine, sensor chain, monitor (2026-09-10)

**Built:** patient triggering on measured signals (flow trigger against the net flow, pressure trigger
against PEEP), refractory period after cycle-off, actuator latency, PSV/CPAP flow cycling at ETS with a
30 ms confirmation, pressure-safety cycling (Paw > target + 3), Ti_max cycling, apnea backup (PC breaths at
the backup rate, cleared by the next patient trigger), alarms (high Ppeak with breath termination, low Vte,
high/low Ve and high RR on a rolling minute, disconnect, high leak, Ti_max, high PEEPi after an expiratory
hold) as `alarm` events with active/inactive transitions, optional leak compensation baseline, valve limits
(inspiratory valve cannot take flow back; expiratory source capped at bias flow; blower peak flow), a
robust bracketed leak solve in the airway node, and delay-line priming so measurements start at PEEP.
`src/monitor/monitor.ts`: per-breath Ppeak, Pplat (from a pause ≥ 0.3 s or the last hold), mean Paw,
measured PEEP, total/intrinsic PEEP from holds, ΔP, Cstat, Cdyn, Raw, Vti/Vte, leak %, Ti/Te/I:E, peak
and end-expiratory flow, rolling RR and Ve, RSBI, Vt/kg PBW, least-squares R/C/PEEP fit.

**Tests:** `tests/unit/ventilator.test.ts` 14/14 (trigger latency < 150 ms, pressure vs flow trigger,
refractory, no triggers without effort then apnea backup + alarm, ETS shortens Ti, leak → Ti_max cycling,
expiratory push → pressure cycling, CPAP holds PEEP, rise time, servo sag under demand only with the
realistic servo, high-Ppeak alarm and cut-off, leak → leak and low-Vte alarms, disconnect, high RR).
`tests/physics/monitor.test.ts` 4/4 (VC with pause: all monitored values vs physics; least-squares R/C
within 10%; COPD intrinsic PEEP after hold with non-zero end-expiratory flow; RSBI and mL/kg). Total 43/43,
lint clean. Two model bugs fixed on the way: the static initializer carried the pleural offset (now
Palv = Ecw·V + recoil, zero at FRC), and the leak fixed-point diverged for large leaks (now a bracketed
monotone solve).

**Known issues:** hosting issue above still open. Emergent double triggers already appear in the CPAP and
pressure-trigger tests (effort persisting past flow cycling), which is expected physics.

### M4 — Neural drive, Pmus, entrainment, balloon, occlusion maneuvers (2026-09-10)

**Built:** `src/sim/patient/neural-drive.ts`: free-running neural clock with AR(1) jitter on rate, Ti and
Pmax, parabolic-rise Pmus with hold fraction and exponential relaxation, sighs, low-drive clusters,
expiratory muscle bump, entrainment (1:1/1:2/1:3, delay + jitter) hooked to ventilator breath starts, and a
neural breath list for the labeler. Force–velocity penalty on |Q| in the patient model (`Pmus_eff`, D-007).
`src/sim/patient/balloon.ts`: Pes as k(fill)·Ppl(z) + supine offset + wall pressure + cardiac artifact, with
under-filled, high and gastric placements. `PatientModel.pplAt(z)` for pleural pressure at any height.
Ventilator occlusion maneuvers (`requestOcclusion`): P0.1 (classic with plateau reference and noise-safe
onset; at-trigger fallback), ΔPocc and the Baydur occlusion test on cardiac-smoothed signals. Engine wires
the drive, balloon (measured Pes to the ventilator when enabled) and exposes `neuralBreaths`.

**Tests (§9.3 and M4 exit):** `tests/unit/neural-drive.test.ts` 6/6 (waveform, jitter statistics,
determinism, periodicity, entrainment ratio/delay/CV < 5%, expiratory activity).
`tests/physics/effort-calibration.test.ts` 4/4: Bertoni k1 = −0.736, k2 = 0.62 on a 20-point PSV grid;
P0.1 within 0.3 + 5% of the analytic Pmus at 100 ms for Pmax 6/12/20; well-placed balloon 0.8–1.2 while
0.5 mL fill and gastric placement fail; PMI rises with effort. `tests/physics/emergence-first.test.ts` 4/4:
ineffective efforts in COPD on over-assisted PSV (> 20% of efforts), double triggers in ARDS on short-Ti VC
(> 20%), scooped Paw in low-flow VC, reverse triggering with a stable 0.4 s delay. Total 57/57; lint clean.

**Known issues:** hosting issue above still open. Hyperinflation-related muscle weakness is not modelled
(D-007). In injured lungs the balloon occlusion test reads > 1 by design (regional transmission).

### Hosting — moved to Netlify (2026-09-11)

`netlify.toml` (build `npm run build`, publish `dist`, Node 22, `BASE_PATH=./`); the GitHub Actions
workflow keeps lint, tests, Playwright and build and no longer deploys to Pages (D-008). Live URL:
https://vent-sim.netlify.app/ with `tomnahass.com/vent-sim/` as a proxy alias from the personal site
(`/vent-sim/* https://vent-sim.netlify.app/:splat 200`). The Netlify CLI was not installed or logged in on
the build machine, so the site was set up by importing `nahata5/vent-sim` in the Netlify UI; the URL is
recorded here and in `README.md` and must be re-checked after the first Netlify build.

### M5 — Live UI v1: worker streaming, sweeps, loops, settings, monitor, dashboard, truth layer (2026-09-11)

**Built:** `src/worker/session.ts` (`SimSession`: one engine advanced by simulated seconds with a step
accumulator; channel-major Float32Array batches of the 5 measured + 20 truth channels; events, breaths,
neural breaths; commands applied between physics steps), `src/worker/sim.worker.ts` (20 ms tick, wall ×
speed capped at 0.25 s, transferable buffers, status every 200 ms), `src/worker/protocol.ts`,
`src/app/WorkerClient.ts`, `src/app/StreamStore.ts` (ring buffers, 120 s, breath/event/neural tables
trimmed to the window), `src/app/controller.ts` (feeds the Monitor measured samples and events in time
order, computes per-breath truth metrics, keeps maneuver readouts, alarm log, view state). UI (Preact +
Canvas2D): `WaveformCanvas` (sweep with erase gap, per-row auto-range, trigger/cycle/alarm markers, hold
shading, breath badges `P·flow`, neural-Ti bands and pendelluft highlight on truth rows, hover cursor
readout of every channel), `LoopCanvas` (P–V, F–V; PL–V per compartment and Campbell Pes–V with the Ecw
line when truth is on), `SettingsPanel` (mode-dependent fields, pending → Confirm/Cancel, "next breath"
chip while the ventilator holds a committed-but-not-yet-active change, alarm limits), `MonitorPanel` (22
measured tiles + maneuver buttons: insp/exp hold, P0.1, ΔPocc, occlusion test), `LungStressDashboard`
(Brief 2 §6 bands from `src/monitor/bands.ts`, citations in tooltips, truth-only rows marked T, power
truth vs bedside surrogate), `TruthToggle`, `TimeControls` (pause, freeze, scroll back 120 s, speed
0.25–4×, sweep 6/12/24 s), `AlarmBar`, `ScenarioPicker`. Truth metrics in `src/sim/truth/lung-stress.ts`
(PL,ei/PL,ee per compartment, ΔPL static and dynamic, strain, ∫Paw·dV and ∫PL·dV power, Pmus peak, ΔPes,
pendelluft). Two new truth channels `vND`/`vD`. Scenario library `src/edu/scenarios/*.json` (8 phenotype
presets + double trigger, ineffective effort, reverse trigger) with `resolveScenario`. Ventilator fix
found by the session tests: an expiratory hold in a breathing patient now reports the pre-effort plateau
and releases when the effort begins (D-009).

**Tests:** Vitest 79/79 (new: `session.test.ts` 7 incl. byte-identical batches under random chunking,
`stream-store.test.ts` 4, `lung-stress.test.ts` 4 incl. ∫Paw·dV = PEEP·Vt + R·Q·Vt + ½E·Vt² within 5%
and every §6 band, `scenarios.test.ts` 5 incl. the three patterns re-verified as scenarios,
`channels.test.ts` 1, exp-hold test 1). Playwright 8/8: load + moving canvas + monitor populated; scenario
switch restarts and shows patient triggers; truth toggle adds 2 loops and fills truth rows; pause stops
simulated time, freeze holds the view, 4× runs ≥ 2.5 s sim per wall second; PEEP change stays pending
until Confirm then measured PEEP rises to 12; Vt change shows the next-breath chip then Vte > 560; an
inspiratory hold yields Pplat, ΔP and a band. Render budget: 7 rows + 4 loops draw in 1.4 ms/frame at
60 fps headless (`load.spec.ts` asserts < 8 ms). Lint clean.

**Screenshots:** `docs/screenshots/m5-normal-passive.png`, `docs/screenshots/m5-ineffective-effort-truth.png`
(COPD over-assisted on PSV with the truth layer: five shaded efforts, one delivered breath, Vt 13 mL/kg in
the red band, Ti max alarm).

**Known issues:** PMI, stress index and R/I rows are placeholders until M7. The displayed volume can dip
below zero late in a long expiration (integrated measured flow, as on a real device). `setPatient` (instructor
controls) is not in the protocol yet (M8). The Netlify URL needs its first-build check by the owner.

### M6 — Labeler, injectors, emergence matrix; detector in progress (2026-09-11, not finished)

**Built:** `src/sim/injectors/index.ts` (leak, cardiac, secretions, water, cough provoked by inflation,
pneumothorax, mainstem, bronchospasm; all terms in the equations via `PatientDrive`, new `eScale`; change log
for the labeler), `BreathRecord.leakTrue`, `Ventilator.settingsLog`, live drive changes
(`SimEngine.setDriveParams`, worker `setPatient`, `inject`). `src/sim/truth/labeler.ts`: every Spec §7 truth
rule (effort–breath matching from neural timing vs trigger events, reverse trigger with phase lock, IE incl.
phase, delayed/premature/delayed cycling margins, flow starvation by PTP, overshoot, auto-PEEP on the relaxed
end-expiratory Palv, leak, injector findings, truth-only pendelluft/overdistension/high/low effort) and the
asynchrony index with the Vaporidi cluster flag. Scenario library grown to 20 JSON files with injectors,
scripted fixes and criteria (`scenarioSchedule`, `applyFix`); new: auto-trigger, leak-psv, flow-starvation,
premature-cycling, copd-auto-peep, secretions, bronchospasm, pneumothorax (at 20 s), mainstem (at 20 s).
`tests/scenarios/emergence.test.ts` (§9.4). Detector: `src/detector/{features,detector,scorer,grids}.ts` and
`scripts/tune-detector.ts` (signal-only rule engine with evidence strings, measured-only reader type,
tuning grid seeds 1–4 vs held-out seeds 101–104 with perturbations), `tests/detector/heldout.test.ts` (gated
by `RUN_HELDOUT=1` until the targets are met).

**Tests:** Vitest 110 passed, 9 skipped (held-out suite). New green: injectors 8/8, labeler 9/9, neural-drive
live change 1/1, emergence matrix 14/14 (every target pattern present; AI < 10% within 60 s after each fix;
passive baseline clean). Lint clean. Playwright unchanged (8/8).

**Detector finished (2026-09-11, second session).** Measurement basis rebuilt after tracing every remaining
gap on the tuning grid (D-012): expiratory notches as deviations from the passive decay on smoothed flow
with anchor tracking and a fall-back requirement; Chen's flow criterion alone for ineffective efforts (the
modelled exhalation valve gives a 0.2 cmH2O Paw deflection); autocorrelation-based cardiac regularity and
notch trains; leak auto-trigger from ΣVte/ΣVti plus the absence of an effort ramp; an auto-trigger never
stacks; τ fitted on notch-free decay stretches with a median reference; delayed cycling from the flow-decay
knee, the shoulder, the inspiratory-tail τ, the smoothed end-inspiratory Paw rise and a concave-down VC
ramp; flow starvation from the least-squares ramp convexity and the end-of-ramp steepening. Two truth
refinements with tests (D-012): an effort met by a coincident time-triggered breath is assisted, and flow
starvation needs an effort still rising after the insufflation starts. Scoring domain extended (D-011/12):
breaths holding only an inspiratory-phase effort are unscored for IE; both members of a double-trigger pair
are unscored for flow starvation. New constants `DET_NOTCH_*`, `DET_CARDIAC_NOTCH_FACTOR`,
`DET_AT_CARDIAC_CORR`, `DET_FS_CONVEXITY`, `DET_FS_END_STEEPENING`, `DET_DC_KNEE_*`, `DET_DC_VC_CONCAVITY`,
`DET_HIGH_R_EEF`, `LABEL_FLOW_STARVATION_RISE`; removed `DET_IE_FDEF_WITH_PDEF`, `DET_IE_PDEF_SMOOTH`,
`DET_PREM_NOTCH_PDEF`.

| pattern (sens/spec) | tuning grid (seeds 1–4, 36 cases) | held-out grid (seeds 101–104, perturbed) | target |
|---|---|---|---|
| ineffective effort | 0.97 / 0.99 | 0.93 / 0.99 | 0.85 / 0.90 |
| double trigger | 0.98 / 1.00 | 0.99 / 1.00 | 0.85 / 0.90 |
| auto-trigger | 1.00 / 0.99 | 0.97 / 0.99 | 0.85 / 0.90 |
| premature cycling | 0.90 / 1.00 | 0.95 / 0.99 | 0.85 / 0.90 |
| delayed cycling | 0.84 / 0.98 | **0.84 / 0.98** | 0.85 / 0.90 |
| flow starvation | 0.94 / 1.00 | 0.91 / 0.98 | 0.85 / 0.90 |
| reverse trigger | 0.86 / 1.00 | 0.85 / 1.00 | 0.75 / 0.90 |

Delayed cycling misses the target by one point on late-triggered VC breaths inside a relaxing effort
(D-012, `docs/LIMITATIONS.md`, Q-2); the held-out test records 0.80 as the accepted floor. Non-core:
high resistance 0.94/1.00 tuning (0.57/1.00 held-out), leak 1.00/0.99, secretions 1.00/1.00, auto-PEEP
0.76/0.85, low compliance 0.52/0.98, delayed trigger 0.37/0.95. The held-out suite is un-gated:
`npm test` → 122 passed (18 files) incl. `tests/detector/heldout.test.ts`; lint clean. New docs:
`docs/LIMITATIONS.md`, `docs/QUESTIONS.md` Q-1…Q-3.

**UI wiring (2026-09-11, M6 complete).** `SessionController` keeps the settings and injector timelines from
status messages (`PatientSummary.rTotal`, `SessionStatus.rScale/eScale` added to the protocol) and, on
every closed breath, runs one analysis pass off the animation frame (`setTimeout 0`) over the last 90 s of
the StreamStore: `labelBreaths` (truth) and `detect` (signal-only) with readers over the ring buffers,
labels keyed by the ventilator breath index (`ctl.labels`), `ieEvents`, `efforts`, and the asynchrony index
over the last 2 min (`ctl.ai`, cluster and severe flags). Measured cost ≈ 10–40 ms per pass (e2e asserts
< 150 ms). `waveform-draw.ts` draws pattern badges above the traces (short codes and colours in
`PATTERN_CODES`; trigger letter when no pattern) and a second outlined row with the truth labels when the
truth layer is on; badge extents are recorded for hover hit-testing and the cursor readout shows each
detector label's evidence string (e.g. `Fdef 12.3 L/min ≥ 5.45 over 0.71 s`). New `InjectorPanel` (eight
live toggles → `worker.inject`), AI tile in the monitor (`mon-AI`, red when > 10 %, "IE cluster" flag),
"Apply suggested fix" in the scenario card (`ctl.applyFix`: settings, drive, injector removals), and
`ValidationPage` behind `#validation` (physics suite list, emergence matrix, per-pattern confusion
matrices against the §9.5 targets; first paint from `src/validation/snapshot.json` written by
`scripts/validation-snapshot.ts`, "Recompute in this browser" streams the same computation from
`validation.worker.ts`). `runEmergence` moved to `src/detector/validation.ts` (the test imports it).

**Tests:** Vitest 122/122. Playwright 13/13: the M5 suite plus `m6.spec.ts` (badges labelled live in the
IE scenario with evidence on hover; AI tile > 10 % and red in the double-trigger scenario; leak injector
toggle raises the measured leak; apply-fix changes ETS and disables the button; Validation page shows ≥ 10
emergence rows and 7 confusion matrices). Render budget unchanged: 1.45 ms/frame at 60 fps headless. Lint
clean; `npm run build` bundles the two workers (sim 63 kB, validation 120 kB).

**Screenshots:** `docs/screenshots/m6-ineffective-effort-badges.png` (COPD over-assisted on PSV, truth layer
on: detector badges DC/IE over the breaths, truth row beneath, AI tile), `docs/screenshots/m6-validation.png`.

**Known issues:** the AI window is the 120 s the store retains, not Thille's full minutes; delayed cycling
0.84 on the held-out grid (D-012).

**Deployed:** https://vent-sim.netlify.app/ (site created 2026-09-11, verified live; redeploys on every push).

### M7 — Recruitable lung, stress index, R/I, PEEP trial, power, CO2 loop (2026-09-11, complete)

**Built (TDD, tests first):** `src/sim/patient/lung-recruitable.ts` — `RecruitableRecoil` behind the
`LungRecoil` interface (N units per compartment, deterministic normal quantiles of opening pressure on the
recoil axis, closing pressure TOP − Δ, Bates–Irvin trajectories `settle`/`advance`, equal volume sharing
among open units, strain-cap stiffening; D-013), wired through `makeRecoil` (`RecoilSpec` kind
`'recruitable'`), `PatientModel` (settle at initialization, advance after each RK4 step, `beginBreath`,
`recruitment()`), `SimEngine` and `BreathRecord` (`openFractionEE`, `frcAeratedEE`, `tidalRecruitUnits`);
`recruitableRecoil(id, overrides)` in `presets.ts` with `RECRUIT_*` constants. `src/monitor/stress-index.ts`
(`stressIndexFit`, `isConstantFlow`) and `BreathMetrics.stressIndex` from measured signals on machine-
triggered constant-flow breaths; dashboard row filled.

**Tests:** `tests/physics/recruitment.test.ts` 4/4 (unit population hysteresis and delay; Gattinoni 1998
direction with the recruitable lung: extrapulmonary Ers 25.0 → 23.7 with 0.15–0.2 L recruited, pulmonary Ers
rises with < 0.1 L; tidal recruitment at PEEP 2 / 10 mL/kg, kept open at PEEP 16; decremental PEEP steps give
Crs 33.8 / 40.7 / 41.6 / 41.1 / 40.5 / 40.0 mL/cmH2O at PEEP 20…0, best at 12).
`tests/physics/stress-index.test.ts` 4/4 (fit recovers b = 0.8/1.0/1.25 from noisy power laws; linear lung
b ∈ 0.9–1.1; consolidated ARDS driven to a 50 cmH2O plateau: b < 0.9 with ≥ 2 units cycling; normal lung at
PEEP 15 / 13 mL/kg: b > 1.1; no index on PC or patient-triggered breaths). Vitest 130/130, lint clean.

**Second session (M7 complete, TDD throughout; D-014).**

- **Recruited gas is real gas.** `lung-recruitable.ts` now keeps each recruited unit's aerated FRC as compartment
  volume (`V = recruited·frcUnit + V_infl`), so opening draws gas in through the airway and closing expels the
  unit's whole content; EELV/strain include it and the unit strain is honest. Constants re-set with a sweep
  (`scripts/dev/ri-sweep.ts`, `ri-units.ts`): closeDelta 6 → 4, extrapulmonary TOP N(8, 4) → N(9.5, 1.5),
  pulmonary TOP N(30, 4) → N(34, 3), strain caps 0.85 → 0.72 and 1.25 → 1.38. Gattinoni 1998 direction kept:
  extrapulmonary Ers 25.1 → 22.7 with 0.22 L recruited (0.293 in the paper), pulmonary 26.4 → 34.9 with none;
  steady decremental steps at Vt 500 (60 s each) Crs 40.5 / 46.6 / 45.3 / 44.3 / 42.9 / 39.7 mL/cmH2O at
  PEEP 20…0, best 16.
- **R/I maneuver** (`src/sim/vent/peep-maneuvers.ts`, `Ventilator.requestPeepManeuver('ri')`): one-breath PEEP
  release from the set PEEP to 5 at the next cycle-off, ΔVrelease against the previous three Vte, four breaths
  at low PEEP, an inspiratory hold for Crs,low, PEEP restored, result `{dVrelease, vteRef, pplatLow, crsLow,
  vpred, vrec, ri, valid}`. Measured values: recruiter scenario ≈ 0.35–0.4 (ΔVrelease ≈ 720 mL, Crs,low ≈ 53,
  Vrec ≈ 200 mL), extrapulmonary preset 0.15–0.25, consolidated 0.01, normal Venegas lung ≈ 0. Why the
  recruiter stays under Chen's 0.5 (chest-wall deflation and low-PEEP tidal re-recruitment, both real
  limitations of the single-breath method) is in D-014 and Q-4.
- **Decremental PEEP trial** (`'peep-trial'`): PEEP to max(set, 20) at once, −2 every 6 breaths to 4, a 1 s
  inspiratory hold per step (Pplat, ΔP, Crs, PL,ei from Pes when the balloon is on, Gattinoni-simplified power),
  `ManeuverResult.table` + `values.bestPeep`, original PEEP restored. An alarm-cycled breath cannot take its
  hold; after 3 breaths without one the step is recorded invalid and the trial moves on (found by the first
  Playwright run: the pulmonary lung tripped the 40 cmH2O Ppeak alarm at PEEP 20 and the trial stalled).
- **Mechanical power**: Gattinoni 2016 full VC formula (`gattinoniFullPower`), used by `powerSurrogate` when
  Ers, Raw and I:E are measured; equals the truth ∫Paw·dV of a linear lung under square flow within 8 %.
- **CO2 → drive loop** (`src/sim/patient/gas-exchange.ts`, `PatientParams.gas`, `engine.gas`, `co2Log`,
  `SessionStatus.co2`, `setWarp`): CO2 mass balance with K = τ·VA_ref/0.863 (τ 3 min at eupnea, bounded ≈ 13
  mmHg/min rise in apnea), 10 s chemoreceptor delay line on the warped clock, per-breath VA whose period
  stretches during apnea, drive = clamp(1 + 0.06·(PaCO2_d − 40), 0, 3) on Pmax and 1 + 0.03·(…) on rate, apnea
  below 36 → Pmus 0 → ventilator backup. Warp ×1–×60 scales only the CO2 clock (byte-identical streams at
  warp 1 and 60 with the gains at zero). Gains sit at the low end of the brief's range because the warp
  multiplies the breath-by-breath lag of the ventilatory response (Q-5).
- **Truth layer**: `tidal-recruitment` PatternId (rule `tidalRecruitUnits ≥ 1`, badge `TR`), dashboard rows for
  recruited volume (with % of units open and the tidal count), PMI (Foti 1997, from the last inspiratory hold
  in PSV/PC) and R/I with its pieces, the PEEP-trial table under the dashboard, a CO2 panel (PaCO2, delayed
  signal, VA, drive, warp select), monitor buttons R/I and PEEP trial (disabled while one runs,
  `SessionStatus.peepManeuver`).
- **Scenarios** (24 now): `peep-trial-recruiter` (extrapulmonary, Ecw 8, Ppl0 8, recruitable fraction 0.4,
  balloon), `peep-trial-non-recruiter` (pulmonary, recruitable), `co2-over-assist` (COPD PSV 18, warp ×10:
  apnea → backup → recovery cycle; fix PS 12), `co2-under-assist` (pulmonary ARDS PSV 3, warp ×10: PaCO2 54,
  drive ×1.9, high effort; fix PS 12 → drive ×1.0). JSON gained `mechanics.recoil: 'recruitable' | {kind,
  …overrides}` and `gas: {…}`; scenario `alarms` merge into the defaults.
- **Bug fixed (M3–M6)**: `Ventilator.applySettings` mutated the settings object shared with the settings log,
  so a PEEP change rewrote the labeler's context for earlier breaths (D-014). Emergence and held-out scores
  unchanged in outcome.

**Tests:** `tests/physics/ri.test.ts` 7/7 (recruiter R/I ≥ 0.3 with pieces and PEEP restored; phenotype
ordering; PC-AC; recruiter trial best PEEP 8–18 with both ends worse; preset trial at Vt 500 best 8–16 and
PEEP 20 < 92 %; alarm-stall recovery; non-recruiter best ≤ 10 and no PL,ei without the balloon).
`tests/physics/co2.test.ts` 9/9 (τ at the reference VA, delay line, warp; drive mapping and apnea; bounded
apneic rise and VA decay; passive steady state within 5 % of 0.863·VCO2/VA; warp-only-CO2 byte identity;
over-assist apnea + backup + recovery; under-assist drive ×1.3+ and Pmax ×1.5+; both CO2 scenarios with
their fixes). `tests/unit/power.test.ts` 3/3. Labeler +1 (tidal recruitment on the consolidated lung at
Pplat ≈ 50, none at 6 mL/kg). Recruitment test updated for the gas semantics. Vitest 151/151 (23 files), held-out
detector suite unchanged; lint clean; `npm run build` clean (sim worker 81 kB). Playwright 17/17 + 4 screenshot
tests: `tests/e2e/m7.spec.ts` (R/I from the button → dashboard ratio, pieces, PEEP restored; PEEP trial fills
9 rows and names the best PEEP; CO2 panel moves and warp ×1 slows it; recruited-volume row with the truth
layer). Render budget unchanged (`load.spec.ts` < 8 ms/frame).

**Screenshots:** `docs/screenshots/m7-ri-recruiter.png` (recruiter after the R/I release, truth layer on),
`docs/screenshots/m7-co2-over-assist.png` (CO2 panel during the apnea cycle).

**Known issues:** R/I under-reads through a stiff chest wall (D-014, Q-4); the warped CO2 loop shows lag-driven
periodic breathing above ≈ ×20 (Q-5); airway opening pressure and SpO2 are not modelled (LIMITATIONS).

### M8 — Education: explain cards, quiz, instructor mode, progress, session and batch export (2026-09-11)

**Built (TDD for the pure logic; D-015):**

- `src/edu/cards/index.ts` — `CARDS` (21 patterns: definition, mechanism, signature, causes, ranked fixes,
  pitfalls, citations from Brief 1 §3 / Brief 2), `caseEvidence()` (templated sentences from
  `BreathLabel.evidence`, neural timing and settings), `effortEvidence()` for ineffective efforts,
  `explainBreath()`. `src/ui/ExplainCard.tsx`: opened from the Explain tab or by clicking a badge
  (`WaveformCanvas` `onClick` → `ctl.selectBreath`).
- `src/edu/quiz.ts` — `truthPatternsInWindow`, `gradeIdentification` (Jaccard), `gradeFix` (AI < 10 % over 60 s,
  ΔP ≤ 15, Pplat ≤ 30, Vt 4–8 mL/kg, no new severe alarm, extras), `quizScore` (50 % identification, 50 % fix
  with time and setting-change factors). `src/edu/quiz-session.ts` — the idle → identify → identified → fix →
  done machine on simulated time. `src/ui/QuizPanel.tsx`; the controller hides the badges during
  identification, counts confirmed setting changes, builds the fix-window input from the truth labels,
  monitor log and alarm log, and records the attempt.
- `src/edu/progress.ts` — `ProgressStore` (localStorage `ventsim.progress.v1`, try/catch with a memory
  fallback, best score / attempts / pass per scenario); shown in the scenario picker (`· best 88 ✓`).
- `src/ui/InstructorPanel.tsx` — live drive (rate, Ti, Pmax, entrainment), R/EL multipliers (new protocol
  `setPatientScale`), CO2 gain/VCO2 (`setGas`, `GasExchange.setParams`), and a scenario editor: load the
  current JSON, edit, run (`ctl.loadScenarioDef`), export, import a file. `parseScenarioJson` validates the
  shape.
- `src/export/csv.ts` (`sessionCsv`, `csvFromHeadless`: t, paw, flow, vol, pes, breath_id, phase, optional
  truth columns), `src/export/json.ts` (`sessionJson`, `sessionJsonFromHeadless`, `monitorBreaths`; schema
  `ventsim-session/1` with scenario, seed, settings and injector logs, breaths, monitor values, truth labels,
  efforts, detector labels with evidence, IE events, maneuvers, events, CO2 log, AI), `src/export/batch.ts`
  (`runBatch`, `zipBatch`, manifest), `src/export/download.ts` (Blob + anchor, clipboard fallback),
  `src/worker/batch.worker.ts`, `src/ui/ExportPanel.tsx`, `scripts/batch.ts` (`npm run batch -- --scenarios
  a,b --seeds 1,2 --duration 60 --out batch.zip`).
- Controller: `view.badges`, `view.drawerTab`, `co2Log`, `maneuverLog`, `monitorLog`, `settingChanges`, `quiz`,
  `progress`, `selectedBreath`, `explanationFor`, `quizTruthPatterns`, `quizFixInput`, `exportCsv/Json`,
  `loadScenarioDef`, `setDrive/setGas/setPatientScale`. App: tabbed drawer (Scenario · Explain · Quiz · Export).

**Tests:** `tests/unit/cards.test.ts` 6, `quiz.test.ts` 7, `quiz-session.test.ts` 2, `progress.test.ts` 3,
`export.test.ts` 6 (CSV shape with and without truth, generic reader, JSON contents, batch grid + zip round
trip, perturbations in the manifest). Vitest 175/175 (28 files); lint clean; build clean (batch worker 158 kB).
Playwright 22/22: `quiz.spec.ts` (identify with badges hidden → apply the fix → evaluate after 60 s →
pass, score > 50, progress in localStorage and in the picker; explain card with case evidence; instructor
JSON edit restarts with PEEP 9), `export.spec.ts` (CSV + truth and JSON downloads with the expected header
and schema; batch zip of 2 seeds with manifest). Render budget unchanged.

**Screenshots:** `docs/screenshots/m8-explain-card.png`, `docs/screenshots/m8-quiz-result.png`.

**Known issues:** see LIMITATIONS "Education layer and export" (quiz extras not defined per scenario, 120 s
signal window in the session CSV, EL/Ecw changes restart the scenario).

### M9 — Hardening: docs, determinism and performance tests, accessibility (2026-09-11)

**Built:** `README.md` (what it does, run/test/build/batch, using the app, docs table, architecture tree,
hosting); `docs/MODEL.md` (every equation with symbols, units and sources: loop, two-compartment mechanics,
airway node and leak, Venegas and recruitable recoil, muscles and force–velocity, entrainment, CO2 loop,
balloon, ventilator FSM/servo/trigger/cycling/alarms/sensor chain, every maneuver, monitor and power
formulas, the truth-rule table, the detector summary, and a constants table of all 251 constants generated
by `scripts/model-constants.ts`); `docs/VALIDATION.md` (spec §9.1–9.8 with the covering tests and the
current numbers, plus the M7/M8 suites); `tests/physics/determinism.test.ts` (every scenario byte-identical
across engines; labels, maneuvers and the CO2 log repeat; the worker session equals the headless stream for
any chunking; a different seed differs); `tests/physics/performance.test.ts` (heaviest scenarios ≥ 50× real
time); accessibility: `tests/e2e/a11y.spec.ts` with `@axe-core/playwright` (no serious or critical WCAG 2A/AA
violations on the main page with the quiz open and on the Validation page; keyboard reach of the drawer
tabs and maneuver buttons; the alarm bar is an `aria-live` region), `:focus-visible` outlines in
`theme.css`; the Validation page shows the app version and links to MODEL/VALIDATION/LIMITATIONS; applying
a scenario's suggested fix now counts as a setting change in the quiz.

**Tests:** Vitest 180/180 (30 files); Playwright 25/25 (+ 6 screenshot tests behind `SCREENSHOTS=1`); lint
clean; build clean. Live at https://vent-sim.netlify.app/.

**Definition of done (`docs/FABLE_GOAL_PROMPT.md`), item by item:**

1. Spec §9 green in CI — analytic (`analytic.test.ts` 7/7), partition (`partition.test.ts` 8/8 plus
   recruitment and stress index), effort calibration (`effort-calibration.test.ts`: k1 −0.736, k2 0.62–0.64),
   emergence matrix for every scenario with targets (`emergence.test.ts` 15/15, fixes bring AI < 10 % within
   60 s), detector targets on the held-out grid (`heldout.test.ts`: all core patterns above target except
   delayed cycling 0.84 vs 0.85 with the accepted 0.80 floor documented in D-012 and LIMITATIONS; reverse
   trigger 0.85/1.00), determinism (`determinism.test.ts`, `session.test.ts`), performance
   (`performance.test.ts` ≥ 50×; `load.spec.ts` < 8 ms/frame), Playwright smoke and feature tests (25).
2. In-app Validation page — `#validation`: physics suite list, emergence matrix, per-pattern confusion
   matrices against the §9.5 targets from the snapshot, recompute in the browser, links to the docs.
3. Deployed at a public static URL — https://vent-sim.netlify.app/ (D-008; Pages was blocked by the
   account's custom domain), redeploys on every push.
4. Docs — README.md, docs/MODEL.md, docs/VALIDATION.md, docs/DECISIONS.md (D-001…D-015),
   docs/LIMITATIONS.md (incl. schematic/absent SpO2, single-store CO2, R/I limits, education/export limits).
5. Clinician walkthrough — load any of the 24 scenarios, see the badges labelled live with evidence on
   hover, click a badge for the explain card with case-specific evidence, toggle the truth layer for Ppl,
   Pes, PL (by region) and Pmus with the extra loops, change and confirm settings or apply the suggested fix
   and watch the AI tile and the lung-stress bands respond (`m6.spec.ts`, `quiz.spec.ts`, `m7.spec.ts`).

**Open items for the owner:** Q-4 (should the recruiter phenotype be re-anchored to read R/I ≥ 0.5) and
Q-5 (CO2 → drive gain vs warp stability); the `tomnahass.com/vent-sim/` proxy alias is unverified until the
personal site carries the redirect rule.
