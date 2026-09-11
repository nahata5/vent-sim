# Handoff — VentSim build state

Updated 2026-09-11 (M7 complete), for a fresh session continuing the goal in `docs/FABLE_GOAL_PROMPT.md`.

## Read in this order

1. `docs/FABLE_GOAL_PROMPT.md` — the goal, non-negotiables, definition of done.
2. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` — the spec (§7 pattern catalog, §8 education, §9
   validation, §10 export, §12 milestones).
3. `PROGRESS.md` — what each milestone built and its test results (M6 detector table, M7 numbers).
4. `docs/DECISIONS.md` — D-001…D-014; D-012 is the detector's measurement basis, D-014 the M7 physics
   (recruited gas, R/I limits, CO2 loop gains, the settings-log bug).
5. `docs/LIMITATIONS.md`, `docs/QUESTIONS.md` (Q-1…Q-5; Q-1…Q-3 answered: keep the defaults).
6. This file's "M8: what exists and what is left" before touching the education layer.

## Where things stand

| Milestone | State |
|---|---|
| M0–M6 | done (scaffold, physics, ventilator, effort, live UI, labeler, injectors, detector, Validation page) |
| M7 | **done**: recruitable-population lung with real recruited gas, stress index, R/I, decremental PEEP trial, Gattinoni full power, CO2 → drive loop with time warp, truth recruitment readouts, 4 new scenarios, Playwright |
| M8 | not started (explain cards, quiz, instructor mode, progress, session/batch export) |
| M9 | not started |

`npm test` → 151 passed, 23 files (held-out detector suite un-gated). `npm run lint` clean. `npm run test:e2e`
→ 17/17 (+ 4 screenshot tests behind `SCREENSHOTS=1`). `npm run build` clean. Everything committed and
pushed on `main`; **live at https://vent-sim.netlify.app/** (every push to `main` redeploys).

## M7 as built (map of the code)

- `src/sim/patient/lung-recruitable.ts` — units hold their aerated FRC as gas (D-014); `recruitedVolume()`.
- `src/sim/vent/peep-maneuvers.ts` — `RiManeuver`, `PeepTrial`, `PeepManeuverHost`; driven from
  `Ventilator` (`requestPeepManeuver`, `peepManeuverActive`, hooks at breath start / cycle / hold end, the
  `pendingInvalid` path for alarm-cycled breaths that cannot take a hold). Results are `maneuver` events
  (`kind 'ri'` with `values`, `kind 'peep-trial'` with `values.bestPeep` + `table`).
- `src/sim/patient/gas-exchange.ts` — `GasExchange` (mass-balance store, delay line, per-breath VA, drive
  mapping, warp), `Co2Sample`; `PatientParams.gas`; `SimEngine.gas`, `co2Log` (1/s), `co2Now()`,
  `setTimeWarp()`; `HeadlessResult.co2`.
- `src/monitor/bands.ts` — `gattinoniFullPower`, `powerSurrogate` (full formula when Ers/Raw/I:E given),
  metric `recruited`, R/I band.
- `src/sim/truth/labeler.ts` — `tidal-recruitment` (`LABEL_TIDAL_RECRUIT_UNITS`); `waveform-draw.ts` badge `TR`.
- Protocol/session: `SessionStatus.peepManeuver`, `SessionStatus.co2`, `MainToWorker setWarp`;
  `SimSession.setTimeWarp`; `WorkerClient.setWarp`; controller `maneuvers.ri/peepTrial`, `latestRecruit`,
  `setWarp`.
- UI: `MonitorPanel` buttons `maneuver-ri`, `maneuver-peep-trial`; `LungStressDashboard` rows `stress-ri`,
  `stress-pmi` (`pmiFromHold`), `stress-recruited`, PEEP-trial table `peep-trial-table`/`peep-trial-step`;
  `Co2Panel` (`co2-panel`, `co2-paco2`, `co2-drive`, `co2-warp`).
- Scenarios: `peep-trial-recruiter`, `peep-trial-non-recruiter`, `co2-over-assist`, `co2-under-assist`;
  `ScenarioDef.mechanics.recoil` (`'recruitable'` or `{kind, …overrides}`), `ScenarioDef.gas`, alarms merge.
- Tests: `tests/physics/{ri,co2,recruitment,stress-index}.test.ts`, `tests/unit/power.test.ts`,
  `tests/e2e/m7.spec.ts`. Dev scripts (git-ignored): `scripts/dev/ri-sweep.ts` (parameter sweeps: R/I,
  Gattinoni, steps, trial, tidal), `ri-units.ts` (per-unit TOP/TCP/open dump around a release),
  `ri-trace.ts`, `co2-trace.ts <scenario>` (`GAS='{"warp":10}'` overrides), `trial-check.ts`.

## M8: what exists and what is left

Nothing of M8 exists yet except what M5–M7 already provide: the scenario library (24 JSON files, ≥ 18 met),
`ScenarioFix`/`applyFix`, the truth labels with evidence (`ctl.labels`, `BreathLabel.evidence`), the
detector labels with evidence strings, `ManeuverResult`s, the headless runner (`runHeadless`), the settings
log, `fflate` already in `dependencies` (for the zip), and the `npm run batch` script entry pointing at a
non-existent `scripts/batch.ts`.

Build order (spec §8, §10; TDD for anything in `src/edu`/`src/export` that is pure logic):

1. **Explain cards** (`src/edu/cards/*.ts`, `src/ui/ExplainCard.tsx`): one card per pattern (definition,
   mechanism, signature, causes, ranked fixes, pitfalls, citations from the briefs) plus a `evidence(label,
   ctx)` template that turns `BreathLabel.evidence` and the breath's timing into case-specific sentences
   ("Neural Ti 1.32 s vs ventilator Ti 0.70 s; effort still at 6.1 cmH2O at cycle-off"). No LLM. Open from a
   badge click or a "Explain" button in the drawer; unit-test the templates on labeler output.
2. **Quiz mode** (`src/edu/quiz.ts`, `src/ui/QuizPanel.tsx`): hide badges, learner picks patterns (list or
   tagging), graded against the truth labels of the window; then "fix it" phase graded by the spec §8 rule
   (AI < 10 % over 60 s and ΔP ≤ 15, Pplat ≤ 30, Vt 4–8 mL/kg, no new severe alarms; scenario extras like
   PL,ee ≥ 0); score = accuracy, time, number of setting changes. Pure grading functions first (tests on
   headless runs), then the UI.
3. **Instructor mode** (`src/edu/instructor.ts`, `src/ui/InstructorPanel.tsx`): patient controls (R, C,
   EL/Ecw, drive rate/Ti/Pmax, sedation, entrainment, injectors, CO2 warp/gains) live through
   `worker.setPatient` (extend the protocol for mechanics changes if needed: a new engine command that
   rebuilds the patient at the current volume, or restart the scenario with overrides) and a scenario editor
   (JSON textarea, validate → `ScenarioDef`, load, export/import via Blob + clipboard fallback).
4. **Progress** (`src/edu/progress.ts`): localStorage wrapped in try/catch; per scenario best score, attempts,
   last date; shown in the ScenarioPicker.
5. **Export** (`src/export/{csv,json,batch}.ts`): session CSV (device-rate measured + optional truth channels
   from the StreamStore ring buffers), session JSON (scenario, seed, settings timeline, per-breath monitor
   values, truth + detector labels with evidence, maneuver results, CO2 log), `BatchGenerator` (grid of
   scenarios × seeds × setting perturbations, headless in `validation.worker.ts` or a new worker, zip with
   `fflate`), and `scripts/batch.ts` for Node. Downloads via Blob + anchor with copy-to-clipboard fallback.
6. Playwright: quiz completes (identify + fix on `premature-cycling`, score shown), export downloads (CSV and
   JSON, check the download event and the header row), batch zip of 2 × 2. Keep `load.spec.ts` < 8 ms/frame.
7. PROGRESS M8 entry with numbers and screenshots, DECISIONS for deviations, commit, push, live check.

## Hosting

Netlify (D-008). `netlify.toml` builds `npm run build` → `dist`, Node 22; GitHub Actions is CI only. Live at
https://vent-sim.netlify.app/; every push to `main` redeploys. The alias `tomnahass.com/vent-sim/` needs the
proxy rule in README on the personal site and is not yet verified.

## Detector: final numbers and how it works

Held-out grid (seeds 101–104, perturbed settings/drive, never tuned on), sensitivity/specificity: ineffective
effort 0.93/0.99, double trigger 0.99/1.00, auto-trigger 0.97/0.99, premature cycling 0.95/0.99, delayed
cycling 0.84/0.98 (target 0.85; accepted floor 0.80 in the test, reason in D-012 and LIMITATIONS), flow
starvation 0.91/0.98, reverse trigger 0.85/1.00. Tuning grid is in `PROGRESS.md`.

Files: `src/detector/features.ts` (measured-only reader, per-breath features), `src/detector/detector.ts`
(two-pass rules with evidence strings), `src/detector/scorer.ts`, `src/detector/grids.ts`,
`scripts/tune-detector.ts`. Never tune on the held-out grid (D-012). Dev tools in git-ignored `scripts/dev/`:
`dump-features.ts`, `trace2.ts`, `taulocal.ts`, `ie-efforts.ts`, `evidence.ts`.

## Architecture as built (src/)

- `sim/engine.ts` — fixed-step loop, 1 ms. Owns `PatientModel`, `Ventilator`, `SensorChain`, optional
  `NeuralDrive`, `Injectors`, balloon, optional `GasExchange`. Emits device-rate samples with measured
  Paw/flow/vol/Pes and 20 truth channels (`sim/channels.ts`), breath records (incl. `leakTrue`,
  `openFractionEE`, `frcAeratedEE`, `tidalRecruitUnits`), events, maneuver results, a CO2 log.
- `sim/headless.ts` — `runHeadless({patient, settings, seed, duration, schedule?, drive?})`.
- `sim/patient/` — `params.ts`, `presets.ts` (8 phenotypes, `recruitableRecoil`), `recoil.ts`,
  `lung-recruitable.ts`, `airway-node.ts`, `patient.ts`, `neural-drive.ts` (`setParams`, `setScale`),
  `balloon.ts`, `gas-exchange.ts`.
- `sim/vent/` — `settings.ts`, `ventilator.ts` (FSM, holds, occlusions, alarms, PEEP maneuvers,
  `settingsLog`), `peep-maneuvers.ts`, `sensor-chain.ts`.
- `sim/injectors/index.ts`; `sim/truth/labeler.ts` (`labelBreaths`, `labelRun`, `asynchronyIndex`,
  `contextFromSettings`); `sim/truth/lung-stress.ts`.
- `monitor/monitor.ts` (measured only), `monitor/stress-index.ts`, `monitor/bands.ts` (bands + power).
- `detector/` — see above. `edu/scenarios/` — 24 JSON + `index.ts`.
- `worker/session.ts` (pure core), `worker/sim.worker.ts`, `worker/protocol.ts`, `worker/validation.worker.ts`.
- `app/controller.ts`, `app/StreamStore.ts` (120 s ring buffers), `app/WorkerClient.ts`, `app/App.tsx`.
- `ui/` — canvases, panels, `Co2Panel`, `ValidationPage`. `config/constants.ts` — every constant cited.

## Conventions that matter

- The detector reads only `t, paw, flow, vol, pes` and ventilator events/settings; `MeasuredReader` enforces
  the key set and `detect()` returns `readChannels` so a test can prove it.
- Constants: no magic numbers; add to `constants.ts` with a source tag before using.
- Tests first for physics/detector; never loosen a threshold without a DECISIONS entry.
- Truth labels define the scoring; when the detector and truth disagree on a definition, fix the definition in
  `DECISIONS.md` rather than bending the rule; add the clinical question to `QUESTIONS.md`.
- `scripts/dev/` is git-ignored scratch space; `scripts/tune-detector.ts` and `scripts/validation-snapshot.ts`
  are tracked. Regenerate `src/validation/snapshot.json` after any scenario or detector change.
- Scenario JSON `settings.alarms` merges into the defaults; `mechanics.recoil` and `gas` are resolved in
  `resolveScenario`.

## Prompt for the next session

> Continue building VentSim in this repo (main branch, clean tree). Read docs/HANDOFF.md first, then
> PROGRESS.md and docs/DECISIONS.md (D-001…D-014). The goal and non-negotiables are in
> docs/FABLE_GOAL_PROMPT.md; the spec is docs/superpowers/specs/2026-09-10-vent-sim-design.md. The owner has
> answered docs/QUESTIONS.md Q-1…Q-3: keep the defaults; Q-4 and Q-5 are open, keep their defaults too.
>
> State: M0–M7 done and deployed at https://vent-sim.netlify.app/. Vitest 151/151 (held-out detector suite
> un-gated), lint clean, Playwright 17/17, build clean. Do not revisit M0–M7 except to fix a bug; never tune
> the detector on the held-out grid; regenerate src/validation/snapshot.json after any scenario change.
>
> Task — M8 per the spec §8 and §10, in the order of HANDOFF "M8: what exists and what is left": explain
> cards with case-specific evidence drawn from the truth labels (templated text, no LLM), quiz mode (identify
> the pattern, then fix it within safety limits, graded by the truth labels), instructor mode with a scenario
> editor (JSON in/out), progress in localStorage, session CSV/JSON export and the headless batch generator
> producing a zip of labeled datasets (scripts/batch.ts), Playwright for the quiz and the export, 60 fps.
> Then PROGRESS.md (M8 entry with numbers and screenshots), DECISIONS, commit, push, check the live site, and
> continue to M9 (hardening: performance, accessibility, README/MODEL.md/VALIDATION.md, limitations).
> When you reach a good place around 50 % context, update docs/HANDOFF.md and write the next prompt into it.
