# Handoff — VentSim build state

Updated 2026-09-11 after M5, for a fresh session continuing the goal in `docs/FABLE_GOAL_PROMPT.md`.

## Read in this order

1. `docs/FABLE_GOAL_PROMPT.md` — the goal, non-negotiables, definition of done.
2. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` — the spec (§4 physiology, §5 ventilator,
   §7 pattern catalog, §8 education, §9 validation, §12 milestones).
3. `PROGRESS.md` — what each milestone built and its test results.
4. `docs/DECISIONS.md` — D-001…D-010, every deviation and every non-obvious modelling choice.
5. The two briefs in `docs/research/` when you need a number.

## Where things stand

| Milestone | State |
|---|---|
| M0 scaffold | done |
| M1 passive core, VC/PC, headless | done, §9.1 green |
| M2 partitioned lung, presets, holds, truth | done, §9.2 green |
| M3 ventilator FSM, alarms, sensor chain, monitor | done |
| M4 neural drive, Pmus, balloon, P0.1/ΔPocc/occlusion test | done, §9.3 green |
| M5 live UI + worker | done: Playwright 8/8, 60 fps, deterministic worker core |
| M6 labeler, injectors, detector, scorer, Validation page | **next** |
| M7 recruitable lung, PEEP trial, stress index, R/I, power, CO2 loop | not started |
| M8 scenarios ≥ 18, cards, quiz, instructor, export | not started |
| M9 hardening + docs (MODEL.md, VALIDATION.md, limitations) | not started |

`npm test` → 79/79. `npm run lint` clean. `npm run test:e2e` → 8/8.

## Hosting

Netlify (D-008). `netlify.toml` builds `npm run build` → `dist`, Node 22. GitHub Actions is CI only. URL:
https://vent-sim.netlify.app/ (alias `tomnahass.com/vent-sim/` through a proxy rule on the personal
site, see README). If the site does not exist yet: in Netlify → Add new site → Import an existing project
→ GitHub → `nahata5/vent-sim`; the build settings are read from `netlify.toml`; set the site name to
`vent-sim`. Nothing in the repo depends on the final host path (`base: './'`).

## Architecture as built (src/)

- `sim/engine.ts` — fixed-step loop, 1 ms. Owns `PatientModel`, `Ventilator`, `SensorChain`, optional
  `NeuralDrive`, balloon. Emits device-rate samples (`onSample`) with measured Paw/flow/vol/Pes and truth
  channels (`sim/channels.ts`, now incl. `vND`/`vD`), breath records, ventilator events, maneuver results.
- `sim/headless.ts` — `runHeadless({patient, settings, seed, duration, schedule?, drive?})`.
- `sim/patient/` — `params.ts`, `presets.ts` (8 phenotypes), `recoil.ts`, `airway-node.ts`, `patient.ts`,
  `neural-drive.ts`, `balloon.ts`.
- `sim/vent/` — `settings.ts`, `ventilator.ts` (FSM, actuators, holds, occlusions, alarms,
  `pendingKeys()`), `sensor-chain.ts`.
- `sim/truth/lung-stress.ts` — per-breath truth metrics (PL by compartment, ΔPL, strain, power, Pmus, ΔPes,
  pendelluft) from a `TruthReader` over the StreamStore.
- `monitor/monitor.ts` — per-breath measured metrics (no truth). `monitor/bands.ts` — Brief 2 §6 bands,
  citations, bedside power surrogates.
- `worker/session.ts` — `SimSession` (pure, tested); `worker/sim.worker.ts` — timer shell;
  `worker/protocol.ts` — messages, `BATCH_CHANNELS`, `channelIndex`.
- `app/controller.ts` — `SessionController` (worker client, StreamStore, Monitor, truth metrics, maneuver
  readouts, view state). `app/StreamStore.ts`, `app/WorkerClient.ts`, `app/App.tsx` (layout, hash routing
  `#scenario-id`, `window.__ventsim` for tests).
- `ui/` — `waveform-draw.ts` (pure canvas code), `WaveformCanvas`, `LoopCanvas`, `SettingsPanel`,
  `MonitorPanel`, `LungStressDashboard`, `TimeControls`, `AlarmBar`, `TruthToggle`, `ScenarioPicker`.
- `edu/scenarios/*.json` + `index.ts` — scenario library and `resolveScenario`.
- `config/constants.ts` — every constant with `{value, unit, source, confidence}`; `k('NAME')` reads one.

Injectors (`sim/injectors/`) do not exist yet; the hooks are `SimEngine.setBaseDrive({pcard, leak, rScale,
pplExtra})` and `PatientDrive` in `patient.ts`. Cardiac oscillation is `pcard`; leak is a function of Paw;
bronchospasm is `rScale`; pneumothorax/mainstem are `pplExtra` / compartment fraction changes.

## Conventions that matter

- Detector and ventilator may read only measured channels and their own events. Truth is for teaching
  displays, labels and scoring. The `StreamStore` holds both; anything under `src/detector` must only read
  the measured keys (`t, paw, flow, vol, pes`) and events.
- Constants: no magic numbers; add to `constants.ts` with a source tag before using.
- Tests first for physics/detector; never loosen a threshold without a DECISIONS entry.
- Settings act at the next breath except PEEP/trigger/alarms/bias flow (immediate), via
  `Ventilator.applySettings`; `pendingKeys()` tells the UI what is still waiting.
- The worker must stay deterministic: commands are applied between physics steps inside `SimSession`;
  never let wall-clock leak into the engine.
- `scripts/dev/` is git-ignored scratch space for debug scripts (excluded from tsc/eslint).

## M6 plan (next session)

1. **Ground-truth labeler** `src/sim/truth/labeler.ts` (spec §7 rules on neural breaths vs breath records,
   plus truth-only findings: pendelluft, overdistension, high/low effort). Runs in the worker per closed
   breath and rides on the `tick` message (`breaths[i].labels`). Tests: `tests/scenarios/emergence.test.ts`
   (§9.4 matrix: target pattern present in each scenario; scripted fix brings AI < 10% within 60 s).
2. **Injectors** `src/sim/injectors/{leak,cardiac,secretions,water,cough,pneumothorax,mainstem,bronchospasm}.ts`
   as terms through `setBaseDrive` / patient params; protocol message `inject(kind, params)`; scenarios 8–11.
3. **Detector** `src/detector/{features,rules,detector,asynchrony-index}.ts` on measured channels only,
   with evidence strings; tune on one seed/phenotype grid, score on a disjoint held-out grid
   (`tests/detector/heldout.test.ts`, §9.5 targets). **Scorer** `src/detector/scorer.ts`.
4. **UI:** pattern badges above breaths (detector label, truth label when the truth layer is on), AI% tile,
   `ValidationPage.tsx` (analytic results, emergence matrix, confusion matrices) behind `#validation`.

## Open clinical questions

`docs/QUESTIONS.md` is still empty; nothing so far needed the owner.
