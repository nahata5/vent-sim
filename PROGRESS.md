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
| M5 | Live UI v1: worker streaming, sweep waveforms, loops, settings confirm, monitor, lung-stress dashboard, truth toggle, time controls | `src/worker/{sim.worker.ts,protocol.ts}`, `src/app/{StreamStore,WorkerClient}.ts`, `src/ui/{WaveformCanvas,LoopCanvas,SettingsPanel,MonitorPanel,LungStressDashboard,TruthToggle,TimeControls,AlarmBar,Disclaimer}.tsx`, `src/ui/theme.css`, `tests/e2e/{load,settings}.spec.ts` |
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
