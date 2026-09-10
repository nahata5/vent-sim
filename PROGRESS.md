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

**Known issues:** the deployed Pages URL returned the user-site 404 immediately after switching the Pages
source to the workflow; re-checked at this commit (see below).
