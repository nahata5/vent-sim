# Handoff — VentSim build state

Written 2026-09-10 for a fresh session continuing the goal in `docs/FABLE_GOAL_PROMPT.md`.

## Read in this order

1. `docs/FABLE_GOAL_PROMPT.md` — the goal, non-negotiables, definition of done.
2. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` — the spec (§4 physiology, §5 ventilator,
   §7 pattern catalog, §8 education, §9 validation, §12 milestones).
3. `PROGRESS.md` — what each milestone built and its test results.
4. `docs/DECISIONS.md` — D-001…D-007, every deviation and every non-obvious modelling choice.
5. The two briefs in `docs/research/` when you need a number.

## Where things stand

| Milestone | State |
|---|---|
| M0 scaffold | done, CI green, Pages deploy runs (see hosting blocker) |
| M1 passive core, VC/PC, headless | done, §9.1 green |
| M2 partitioned lung, presets, holds, truth | done, §9.2 green |
| M3 ventilator FSM, alarms, sensor chain, monitor | done |
| M4 neural drive, Pmus, balloon, P0.1/ΔPocc/occlusion test | done, §9.3 green, first emergent patterns green |
| M5 live UI + worker | **next** |
| M6 labeler, injectors, detector, scorer, Validation page | not started |
| M7 recruitable lung, PEEP trial, stress index, R/I, power, CO2 loop | not started |
| M8 scenarios ≥ 18, cards, quiz, instructor, export | not started |
| M9 hardening + docs (MODEL.md, VALIDATION.md, limitations) | not started |

`npm test` → 57/57. `npm run lint` clean. `npm run test:e2e` → 1/1 (blank app smoke).

## Hosting blocker (needs the owner)

The Pages deployment succeeds and the environment URL is `http://tomnahass.com/vent-sim/`, but it serves
a Netlify 404. `tomnahass.com` (and `www`) resolve to Netlify, while the `nahata5.github.io` repo still has
`tomnahass.com` as its Pages custom domain, so GitHub redirects every project site of the account there.
Options for the owner: remove the custom domain from `nahata5.github.io` (site then lives at
`https://nahata5.github.io/vent-sim/`), add a Netlify redirect/proxy for `/vent-sim/*` to the GitHub Pages
origin, or deploy VentSim to Netlify too. Nothing in this repo needs to change; `base: './'` already works
under any sub-path.

## Architecture as built (src/)

- `sim/engine.ts` — fixed-step loop, 1 ms. Owns `PatientModel`, `Ventilator`, `SensorChain`, optional
  `NeuralDrive`, balloon. Emits device-rate samples (`onSample`) with measured Paw/flow/vol/Pes and truth
  channels (`sim/channels.ts`), breath records, ventilator events, maneuver results.
- `sim/headless.ts` — `runHeadless({patient, settings, seed, duration, schedule?, drive?})` returns
  Float32Array streams + breaths + events + maneuvers + neuralBreaths. Every physics test uses it.
- `sim/patient/` — `params.ts` (MechanicsParams, PatientParams with `drive`, `balloon`, `heartRate`),
  `presets.ts` (8 phenotypes, Venegas from anchor), `recoil.ts`, `airway-node.ts` (closed-form node
  solve, leak, valve limits), `patient.ts` (two compartments, RK4, `pplAt(z)`, `initAtStatic`),
  `neural-drive.ts`, `balloon.ts`.
- `sim/vent/` — `settings.ts` (clinical units, clamps, VC timing), `ventilator.ts` (FSM, actuators,
  holds, occlusions, alarms), `sensor-chain.ts`.
- `monitor/monitor.ts` — per-breath measured metrics from samples + events (no truth).
- `config/constants.ts` — every constant with `{value, unit, source, confidence}`; `k('NAME')` reads one.
- `app/App.tsx`, `main.tsx`, `ui/theme.css` — blank Preact shell with the disclaimer (M0).

Injectors (`sim/injectors/`) do not exist yet; the hooks are `SimEngine.setBaseDrive({pcard, leak, rScale,
pplExtra})` and `PatientDrive` in `patient.ts`. Cardiac oscillation is `pcard`; leak is a function of Paw;
bronchospasm is `rScale`; pneumothorax/mainstem are `pplExtra` / compartment fraction changes.

## Conventions that matter

- Detector and ventilator may read only measured channels and their own events. Truth is for teaching
  displays, labels and scoring.
- Constants: no magic numbers; add to `constants.ts` with a source tag before using.
- Tests first for physics/detector; never loosen a threshold without a DECISIONS entry.
- Settings act at the next breath except PEEP/trigger/alarms/bias flow (immediate), via
  `Ventilator.applySettings`.
- Ventilator vti/vte are integrated per phase at 1 kHz from measured flow; the Monitor integrates positive
  and negative flow over the cycle.
- `scripts/dev/` is git-ignored scratch space for debug scripts (excluded from tsc/eslint).

## M5 plan (next session)

Files: `src/worker/sim.worker.ts` + `protocol.ts` (init/applySettings/setPatient/maneuver/inject/setSpeed/
pause/resume; samples as transferable Float32Array batches every ~20 ms, breath/alarm/maneuver messages),
`src/app/WorkerClient.ts`, `src/app/StreamStore.ts` (ring buffers 120 s at device rate + breath table),
`src/ui/WaveformCanvas.tsx` (Canvas2D sweep, 3–6 channels, event markers, breath badges),
`src/ui/LoopCanvas.tsx` (P–V, F–V; PL–V and Campbell when truth on), `src/ui/SettingsPanel.tsx`
(pending → confirm), `src/ui/MonitorPanel.tsx`, `src/ui/LungStressDashboard.tsx` (Brief 2 §6 bands with
citations), `src/ui/TruthToggle.tsx`, `src/ui/TimeControls.tsx` (pause/freeze/scrollback 120 s, cursor
readout, speed 0.25–4×), `src/ui/AlarmBar.tsx`. Exit: Playwright smoke (load, start scenario, change +
confirm a setting and see the waveform change) and 60 fps with 6 channels + 2 loops. Keep the worker
deterministic: one `SimEngine`, stepped by an accumulator against wall-clock × speed.

## Open clinical questions

`docs/QUESTIONS.md` is still empty; nothing so far needed the owner.
