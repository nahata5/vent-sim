# Handoff — VentSim build state

Updated 2026-09-11 (M9 complete; post-M9 extensions done: Pes artifact fix, quiz extras, capstone, schematic
SpO2, live EL/Ecw), for a fresh session continuing from `docs/FABLE_GOAL_PROMPT.md`.

## Read in this order

1. `docs/FABLE_GOAL_PROMPT.md` — the goal, non-negotiables, definition of done.
2. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` — the spec (§7 pattern catalog, §8 education, §9
   validation, §10 export, §12 milestones).
3. `PROGRESS.md` — what each milestone built and its test results (M6 detector table, M7 numbers, the M9
   definition-of-done walkthrough).
4. `docs/DECISIONS.md` — D-001…D-018; D-012 is the detector's measurement basis, D-014 the M7 physics
   (recruited gas, R/I limits, CO2 loop gains, the settings-log bug), D-015 the education/export choices,
   D-016 the Pes cardiac artifact and cardiac-smoothed ΔPes, D-017 the schematic SpO2, D-018 live EL/Ecw.
5. `docs/LIMITATIONS.md`, `docs/QUESTIONS.md` (Q-1…Q-5; Q-1…Q-3 answered: keep the defaults).
6. `README.md`, `docs/MODEL.md`, `docs/VALIDATION.md` — the user-facing docs (M9).
7. This file's "What is left" before touching anything.

## Where things stand

| Milestone | State |
|---|---|
| M0–M6 | done (scaffold, physics, ventilator, effort, live UI, labeler, injectors, detector, Validation page) |
| M7 | **done**: recruitable-population lung with real recruited gas, stress index, R/I, decremental PEEP trial, Gattinoni full power, CO2 → drive loop with time warp, truth recruitment readouts, 4 new scenarios, Playwright |
| M8 | **done**: explain cards with case evidence, quiz (identify → fix → score), instructor mode with a scenario editor, progress in localStorage, session CSV/JSON, batch zip (worker + `scripts/batch.ts`) |
| M9 | **done**: README, MODEL.md (equations + constants table via `scripts/model-constants.ts`), VALIDATION.md, determinism and performance tests, axe accessibility pass, keyboard/focus, Validation page links; definition-of-done walked in PROGRESS |
| Post-M9 | **done** (2026-09-11): Pes cardiac artifact → systolic pulse + cardiac-smoothed ΔPes (D-016); scenario quiz extras (`quizExtras`); capstone scenario; schematic SpO2 tile (D-017); live EL/Ecw instructor control (D-018) |

`npm test` → 195 passed, 33 files (held-out detector suite un-gated). `npm run lint` clean. `npm run test:e2e`
→ 28/28 (+ 6 screenshot tests behind `SCREENSHOTS=1`). `npm run build` clean. Everything committed and
pushed on `main`; **live at https://vent-sim.netlify.app/** (every push to `main` redeploys). Note: the
performance test (`≥ 50× real time`) is a wall-clock test; under a loaded machine it fails inside the
parallel full run (28–49×) while passing alone (see PROGRESS post-M9); it also fails the same way on the
pre-change commits, so treat that as environment, not regression, and re-run it alone.

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

## Post-M9 as built (map of the code)

- **Pes cardiac artifact (D-016)**: `cardiacArtifact()` in `src/sim/patient/balloon.ts` (raised-cosine
  systolic bump, `PES_CARDIAC_PP` 1.5 peak-to-peak, `PES_CARDIAC_WIDTH` 0.3 of the beat, beat-mean removed);
  `truthBreathMetrics` takes `fs` and reads ΔPes on the `OCCLUSION_SMOOTHING` moving average.
  Tests `tests/unit/balloon.test.ts`, `lung-stress.test.ts`.
- **Quiz extras**: `ScenarioDef.quizExtras: QuizExtraDef[]` (`metric` plEE|plEI|dPL|dPes|pmusPeak, `min`/`max`,
  `label?`); `extrasFromTruth` in `src/edu/quiz.ts`; controller `truthLog` (per-breath truth metrics) feeds
  `quizFixInput().extras`. Obesity (PL,ee ≥ 0, PL,ei ≤ 20), abdominal-hypertension and ards-extrapulmonary
  (PL,ee ≥ 0). Tests `quiz.test.ts`, `scenarios.test.ts`, `tests/e2e/quiz.spec.ts`.
- **Capstone**: `src/edu/scenarios/capstone.json` (category `capstone`, order 300): over-assisted COPD on
  PSV + leak k 0.03 + secretions; targets ineffective-effort, delayed-cycling, auto-peep, leak, secretions;
  emergence row (14 rows now). Dev check: `scripts/dev/capstone.ts` (git-ignored).
- **Schematic SpO2 (D-017)**: `src/monitor/spo2.ts` (`spo2Schematic`, `severinghaus`), nine `SPO2_*`
  constants, `ScenarioDef.shunt` (ards-pulmonary 0.3, ards-extrapulmonary 0.2), controller `latestSpo2`
  computed per closed breath, Monitor tile `mon-SpO2` labelled "schematic". MODEL.md §5b. Tests
  `tests/unit/spo2.test.ts`, `tests/e2e/m7.spec.ts`.
- **Live EL/Ecw (D-018)**: `PatientModel.setMechanics` (Ecw parameter; EL as `elScale` multiplier on the
  recoil curves composing with the injector `eScale`, also in `lungElastance` and the static inversion);
  `SimEngine.setMechanics`; `SimSession.setMechanics`; protocol `setMechanics` + `SessionStatus.mechanics`
  (controller updates its `PatientSummary` from it); `WorkerClient.setMechanics`; `InstructorPanel` inputs
  `instr-el`, `instr-ecw`, button `instr-apply-el`. Tests `tests/physics/live-mechanics.test.ts`,
  `session.test.ts`, `quiz.spec.ts`.

## What is left (post-M9)

All spec milestones and the optional extensions listed in the previous handoff are built. Remaining:

1. **Owner questions** Q-4 and Q-5 are answered: keep the defaults (QUESTIONS.md, second round). Nothing to do.
2. **Held-out delayed cycling 0.84 vs 0.85** (D-012, Q-2 answered "keep the defaults"): leave unless a new
   signal-only idea appears; never tune on the held-out grid.
3. **Alias** `tomnahass.com/vent-sim/`: the redirect rules are now in the personal site's repo
   (`~/Documents/development/personal-website/netlify.toml`, commit 4d756ac pushed to
   `github.com/nahata5/personal-website` main on 2026-09-11; remote switched to https because the SSH key
   is not loaded). DNS already points at Netlify, so nothing on Namecheap. Netlify's GitHub webhook fired
   but 15 min later the alias still returned the personal site's 404 and no deploy status was posted, so
   the personal site's build (Hugo 0.95 + `netlify-plugin-hugo-cache-resources`, last built 2023) has
   probably failed. The owner must check that site's deploy log in the Netlify dashboard (or run
   `npx netlify-cli login` in the session so the log can be read from here). Re-check with
   `curl -sSL -o /dev/null -w '%{url_effective} %{http_code}\n' https://tomnahass.com/vent-sim/` and expect
   200 with the VentSim `<title>`, then check that `assets/index-*.js` is proxied too.
4. **Next feature (owner-approved design, build next)**: the quiz "bedside view" and debrief —
   `docs/superpowers/specs/2026-09-11-quiz-bedside-view-design.md`. Instructor-set hide set (truth, Pes,
   scenario text, derived numbers, explain cards, CO2), a "Bedside" preset, checkboxes plus a copyable
   locked quiz link (`#<id>?quiz=bedside`), and a four-section debrief on submit (what you changed, what was
   happening, the recommended fix key by key, physiology and recognition from the cards). Tests are listed
   in the spec §6; work tests-first and follow the superpowers writing-plans → executing-plans flow.
5. **Optional, still open**: light theme for the panels (waveform screen stays dark), i18n, a screenshot
   refresh for the docs (`SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts`) now that the
   Monitor has the SpO2 tile and the Instructor panel the elastance row, a Pes-position dependence of the
   cardiac artifact (larger behind the heart), quiz extras for more scenarios (e.g. `dPes ≤ 8` for the
   P-SILI scenario), and an explain-card/objective for the capstone that lists the fix order.
6. Keep the working method: tests first for anything in `src/sim`/`src/detector`/`src/edu` logic, constants
   cited, deviations in DECISIONS, clinical questions in QUESTIONS, regenerate the snapshot after scenario or
   detector changes, `SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts` for the docs.

## Hosting

Netlify (D-008). `netlify.toml` builds `npm run build` → `dist`, Node 22; GitHub Actions is CI only. Live at
https://vent-sim.netlify.app/; every push to `main` redeploys. The alias `tomnahass.com/vent-sim/` needs the
proxy rule in README on the personal site and is not yet verified (404 on 2026-09-11, see "What is left" 3).
Deploy check used after each push: poll the served `assets/index-*.js` for a string unique to the commit.

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
- `monitor/monitor.ts` (measured only), `monitor/stress-index.ts`, `monitor/bands.ts` (bands + power),
  `monitor/spo2.ts` (schematic SpO2, display only).
- `detector/` — see above. `edu/scenarios/` — 25 JSON (incl. `capstone.json`) + `index.ts`.
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

> Continue VentSim in this repo (main branch, clean tree). Read docs/HANDOFF.md first, then PROGRESS.md (the
> M9 definition-of-done walkthrough and the post-M9 entries) and docs/DECISIONS.md (D-001…D-018). The goal
> and non-negotiables are in docs/FABLE_GOAL_PROMPT.md; the spec is
> docs/superpowers/specs/2026-09-10-vent-sim-design.md. The owner has answered docs/QUESTIONS.md Q-1…Q-5:
> keep the defaults; do not reopen them.
>
> State: M0–M9 and the post-M9 extensions (Pes artifact fix, quiz extras, capstone, schematic SpO2, live
> EL/Ecw) are done and deployed at https://vent-sim.netlify.app/. Vitest 195/195 (held-out detector suite
> un-gated; the performance test is wall-clock and must be re-run alone if the parallel run is under load),
> lint clean, Playwright 28/28, build clean. Do not revisit finished milestones except to fix a bug; never
> tune the detector on the held-out grid; regenerate src/validation/snapshot.json after any scenario change
> and the MODEL.md constants table after any constants change.
>
> Task — build the quiz "bedside view" and debrief from the owner-approved design in
> docs/superpowers/specs/2026-09-11-quiz-bedside-view-design.md (HANDOFF "What is left" item 4): first
> write the implementation plan (superpowers writing-plans) from the spec, then execute it tests-first
> (spec §6 lists the tests), keeping the existing quiz behaviour unchanged when no hide set is given.
> Commit, push and check the live site after each task; add D-019 to DECISIONS, a PROGRESS entry and the
> README quiz section. Before starting, re-check the tomnahass.com/vent-sim/ alias with the curl in
> HANDOFF item 3 and report the result (the fix is pushed to the personal site's repo; only its Netlify
> build can be at fault now). When you reach a good place around 50 % context, update docs/HANDOFF.md and
> write the next prompt into it.
