# Handoff — VentSim build state

Updated 2026-09-11 (M8 complete), for a fresh session continuing the goal in `docs/FABLE_GOAL_PROMPT.md`.

## Read in this order

1. `docs/FABLE_GOAL_PROMPT.md` — the goal, non-negotiables, definition of done.
2. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` — the spec (§7 pattern catalog, §8 education, §9
   validation, §10 export, §12 milestones).
3. `PROGRESS.md` — what each milestone built and its test results (M6 detector table, M7 numbers).
4. `docs/DECISIONS.md` — D-001…D-015; D-012 is the detector's measurement basis, D-014 the M7 physics
   (recruited gas, R/I limits, CO2 loop gains, the settings-log bug), D-015 the education/export choices.
5. `docs/LIMITATIONS.md`, `docs/QUESTIONS.md` (Q-1…Q-5; Q-1…Q-3 answered: keep the defaults).
6. This file's "M9: what is left" before touching anything.

## Where things stand

| Milestone | State |
|---|---|
| M0–M6 | done (scaffold, physics, ventilator, effort, live UI, labeler, injectors, detector, Validation page) |
| M7 | **done**: recruitable-population lung with real recruited gas, stress index, R/I, decremental PEEP trial, Gattinoni full power, CO2 → drive loop with time warp, truth recruitment readouts, 4 new scenarios, Playwright |
| M8 | **done**: explain cards with case evidence, quiz (identify → fix → score), instructor mode with a scenario editor, progress in localStorage, session CSV/JSON, batch zip (worker + `scripts/batch.ts`) |
| M9 | not started (hardening: performance, accessibility, README, MODEL.md, VALIDATION.md, limitations) |

`npm test` → 175 passed, 28 files (held-out detector suite un-gated). `npm run lint` clean. `npm run test:e2e`
→ 22/22 (+ 6 screenshot tests behind `SCREENSHOTS=1`). `npm run build` clean. Everything committed and
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

## M8 as built (map of the code)

- `src/edu/cards/index.ts` (`CARDS`, `caseEvidence`, `effortEvidence`, `explainBreath`), `src/ui/ExplainCard.tsx`
  (Explain tab; badge click → `ctl.selectBreath`).
- `src/edu/quiz.ts` (`truthPatternsInWindow`, `gradeIdentification`, `gradeFix`, `quizScore`, `SEVERE_ALARMS`),
  `src/edu/quiz-session.ts` (`QuizSession`), `src/ui/QuizPanel.tsx`; controller `startQuiz`, `quizTruthPatterns`,
  `submitQuizPicks`, `startQuizFix`, `quizFixInput`, `evaluateQuiz`, `endQuiz`, `settingChanges`, `view.badges`.
- `src/edu/progress.ts` (`ProgressStore`, key `ventsim.progress.v1`); `ScenarioPicker` shows the best score.
- `src/ui/InstructorPanel.tsx` (`parseScenarioJson`; drive / R,EL multipliers / CO2 gains live; JSON editor
  → `ctl.loadScenarioDef`); protocol `setGas`, `setPatientScale`; `GasExchange.setParams`.
- `src/export/{csv,json,batch,download}.ts`, `src/worker/batch.worker.ts`, `src/ui/ExportPanel.tsx`,
  `scripts/batch.ts`; controller `co2Log`, `maneuverLog`, `monitorLog`, `sessionCsvText`, `sessionJsonDoc`.
- App drawer tabs (`tab-scenario|explain|quiz|export`, `ctl.view.drawerTab`).
- Tests: `tests/unit/{cards,quiz,quiz-session,progress,export}.test.ts`, `tests/e2e/{quiz,export}.spec.ts`.

## M9: what is left

Spec §12 M9: hardening — performance, accessibility, docs (README, MODEL.md with equations and citations,
VALIDATION.md, DECISIONS.md, known limitations), and every §9 item green. Concretely:

1. **Docs**: `README.md` (run, build, deploy, architecture, the scenario library, the quiz, exports; the
   Netlify URL and the `tomnahass.com/vent-sim/` proxy note), `docs/MODEL.md` (every equation with symbols,
   units and citations: two-compartment mechanics, chest wall and pleural gradient, Venegas and recruitable
   recoil (D-013/D-014), viscoelastic element, airway node and leak, Pmus generator with force–velocity,
   entrainment, balloon, CO2 loop, ventilator FSM, sensor chain, maneuvers, monitor formulas, truth rules,
   detector rules with thresholds, power formulas; generate the constants table from `listConstants()`),
   `docs/VALIDATION.md` (§9 items with the test names and the current numbers: analytic, partition,
   calibration, emergence matrix, held-out detector table, determinism, performance, e2e; how to regenerate
   the snapshot), refresh `docs/LIMITATIONS.md` and add the SpO2 note.
2. **Performance**: a `tests/physics/performance.test.ts` (headless ≥ 50× real time, 60 s in < 1.2 s; the
   worker's 1× CPU share is already tiny) and `tests/physics/determinism.test.ts` (byte-identical streams for
   the same seed across two engines and across chunked `SimSession.advance`; a determinism test exists in
   `session.test.ts`, make the §9.6 one explicit). Keep `load.spec.ts` < 8 ms/frame.
3. **Accessibility**: keyboard operability of every control (tabs are buttons; confirm the settings panel and
   the injector checkboxes are reachable; add `aria-live` to the alarm bar), badge codes carry text
   (already), colour never the only encoding (bands have text), focus styles in `theme.css`; run an axe pass
   via Playwright (`@axe-core/playwright` is a dev dependency to add) on the main page and the validation
   page and fix what it reports.
4. **Validation page**: add the constants table and links to MODEL.md/VALIDATION.md; show the app version and
   the snapshot commit.
5. Final `PROGRESS.md` M9 entry, `HANDOFF.md`, commit, push, live check; then the definition-of-done checklist
   in `docs/FABLE_GOAL_PROMPT.md` walked item by item with the evidence for each.

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
> PROGRESS.md and docs/DECISIONS.md (D-001…D-015). The goal and non-negotiables are in
> docs/FABLE_GOAL_PROMPT.md; the spec is docs/superpowers/specs/2026-09-10-vent-sim-design.md. The owner has
> answered docs/QUESTIONS.md Q-1…Q-3: keep the defaults; Q-4 and Q-5 are open, keep their defaults too.
>
> State: M0–M8 done and deployed at https://vent-sim.netlify.app/. Vitest 175/175 (held-out detector suite
> un-gated), lint clean, Playwright 22/22, build clean. Do not revisit M0–M8 except to fix a bug; never tune
> the detector on the held-out grid; regenerate src/validation/snapshot.json after any scenario change.
>
> Task — M9 per the spec §12 and HANDOFF "M9: what is left": README.md, docs/MODEL.md (every equation with
> symbols, units, citations, constants table), docs/VALIDATION.md (every §9 item with test names and current
> numbers), LIMITATIONS refresh, explicit determinism and performance tests, accessibility pass (keyboard,
> aria-live alarms, axe via Playwright), Validation page links; then walk the definition-of-done checklist in
> docs/FABLE_GOAL_PROMPT.md with evidence per item. PROGRESS.md M9 entry, DECISIONS, commit, push, live check.
> When you reach a good place around 50 % context, update docs/HANDOFF.md and write the next prompt into it.
