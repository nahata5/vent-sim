# Handoff — VentSim build state

Updated 2026-09-11, late (M9 complete; post-M9 extensions done: Pes artifact fix, quiz extras, capstone,
schematic SpO2, live EL/Ecw, quiz bedside view + debrief D-019 with its follow-ups, mobile-responsive layout
D-020), for a fresh session continuing from `docs/FABLE_GOAL_PROMPT.md`.

## Read in this order

1. `docs/FABLE_GOAL_PROMPT.md` — the goal, non-negotiables, definition of done.
2. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` — the spec (§7 pattern catalog, §8 education, §9
   validation, §10 export, §12 milestones).
3. `PROGRESS.md` — what each milestone built and its test results (M6 detector table, M7 numbers, the M9
   definition-of-done walkthrough).
4. `docs/DECISIONS.md` — D-001…D-020; D-012 is the detector's measurement basis, D-014 the M7 physics
   (recruited gas, R/I limits, CO2 loop gains, the settings-log bug), D-015 the education/export choices,
   D-016 the Pes cardiac artifact and cardiac-smoothed ΔPes, D-017 the schematic SpO2, D-018 live EL/Ecw,
   D-019 the quiz bedside view, locked link and templated debrief (+ follow-ups addendum), D-020 the
   mobile-responsive layout.
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
| Post-M9 | **done** (2026-09-11): Pes cardiac artifact → systolic pulse + cardiac-smoothed ΔPes (D-016); scenario quiz extras (`quizExtras`); capstone scenario; schematic SpO2 tile (D-017); live EL/Ecw instructor control (D-018); quiz bedside view, locked quiz link and debrief (D-019) + follow-ups (masked picker, drive marks, attempts review); **mobile-responsive layout (D-020)** |

`npm test` → 217 passed, 36 files (held-out detector suite un-gated). `npm run lint` clean. `npm run test:e2e`
→ 35/35 = 32 `chromium` (desktop) + 2 `mobile` (Pixel 7) + 1 `tablet` (Nexus 10) (+ 9 screenshot tests
behind `SCREENSHOTS=1`). `npm run build` clean. Everything committed and pushed on `main`; **live at
https://vent-sim.netlify.app/** (every push to `main` redeploys). Note: the performance test (`≥ 50× real
time`) is a wall-clock test; under a loaded machine it fails inside the parallel full run (28–49×) while
passing alone (see PROGRESS post-M9); it also fails the same way on the pre-change commits, so treat that
as environment, not regression, and re-run it alone. Live-site check after a push: fetch the served
`assets/index-*.js` and grep for a **literal** string of the change (template strings such as
`mtab-${id}` are not literal in the bundle; `mobile-tabs` and `view-toggles` are).

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
- **Quiz bedside view + debrief (D-019)**: `src/edu/quiz-view.ts` (`QUIZ_HIDE_KEYS`, `QUIZ_HIDE_LABELS`,
  `bedsideHide`, `parseQuizHash`, `quizLink`), `src/edu/debrief.ts` (`SettingChange`, `settingChangesFrom`,
  `injectorChange`, `formatChange`, `fixMark`, `buildDebrief`), `progress.ts` `DebriefSummary` /
  `QuizAttempt.debrief`; controller `view.quizHide` / `view.quizLocked`, `quizHides(key)`, `setQuizHide`,
  `lockQuiz`, `settingsChangeLog` (fed by `applySettings`, `applyFix`, `setInjector`), `quizPicks`,
  `lastDebrief` (built in `evaluateQuiz` from the identification truth, the log since `fixWindowStart`, the
  settings/injectors snapshot at fix start and the latest card evidence); `setTruth` and `selectBreath`
  refuse while hidden. `App.tsx` reads `#<id>?quiz=` at load and on hashchange (`hashPage()` is the part
  before `?`), passes `TruthToggle.disabled`, `ScenarioPicker.disabled/mask`, `MonitorPanel.hideBalloonTiles`,
  `ExportPanel.hideTruth`, drops the Explain tab, dashboard, Validation link, CO2 panel and Instructor panel
  as the hide set says; `WaveformCanvas` skips the badge hover when `explain` is hidden.
  `src/ui/DebriefPanel.tsx` (`debrief-panel`, `debrief-changes`, `debrief-happening`, `debrief-fix`,
  `debrief-fix-note`, `debrief-key-<key>`, `debrief-physiology`); Instructor panel `quizview-<key>`,
  `quizview-bedside`, `quizview-none`, `quizview-link`, `quizview-copy`. Constant `QUIZ_FIX_BAND`. Tests
  `tests/unit/{quiz-view,debrief}.test.ts`, `progress.test.ts`, `tests/e2e/quiz-bedside.spec.ts`. Plan:
  `docs/superpowers/plans/2026-09-11-quiz-bedside-view.md`.
- **D-019 follow-ups**: `ScenarioPicker` `mask` → every option "Case n" (library order), groups "Cases";
  drive changes in the log (`DriveSnapshot`, `driveSnapshot`, `applyDriveSnapshot`, `driveChangesFrom` in
  `debrief.ts`; controller `drive`, `driveAtFixStart`, `logDriveChange` called from `setDrive` and
  `applyFix`; `DebriefInput.driveAtFixStart/finalDrive`; keys `drive.rate|ti|pmax|entrainment`, test ids
  `debrief-key-drive.<key>`); Instructor panel `instr-attempts` / `instr-attempt` table from
  `ctl.progress.all()` (newest first, `ATTEMPTS_SHOWN` 20). `loadScenario` now uses `resetSessionState`.
- **Mobile layout (D-020)**: design `docs/superpowers/specs/2026-09-11-mobile-layout-design.md`, plan
  `docs/superpowers/plans/2026-09-11-mobile-layout.md`. `src/ui/breakpoints.ts` (`PHONE_MAX_WIDTH` 699,
  `PHONE_QUERY`, `TABLET_QUERY`, `BADGE_TAP_HEIGHT` 32, `isCoarsePointer`, `usePhoneLayout`). `theme.css`:
  responsive blocks **at the end of the file** (tablet grid, phone flex column with `order`, touch block);
  they must stay after every base rule they override (`.drawer-pane` bit us once). `App.tsx`: `phone`
  flag, `MobileTab` state `mtab`, tab bar `mobile-tabs` / `mtab-vent|monitor|loops|learn`, `data-mtab` on
  `.app-main`, `view-toggles` panel (truth + balloon toggles) at the top of the left column on phones,
  CO2 panel in the right column on phones, `ExportPanel.validationLink`, drawer-tab → Learn effect.
  `WaveformCanvas`: `--wave-rows` style on the wrap, coarse-pointer badge tap, readout x clamped ≥ 0.
  `DebriefPanel` and `LungStressDashboard` tables in `.table-wrap`. Playwright projects `chromium`
  (ignores `mobile.spec.ts`, `tablet.spec.ts`), `mobile` (Pixel 7), `tablet` (Nexus 10); helpers in
  `tests/e2e/helpers/layout.ts` (`ready`, `waitForSim`, `noHorizontalOverflow`, `canvasFollowsWrap`).
  Screenshot spec: `emulate(name)` strips `defaultBrowserType` so `test.use` works inside a describe.

## What is left (post-M9)

All spec milestones and the optional extensions listed in the previous handoff are built. Remaining:

1. **Owner questions** Q-4 and Q-5 are answered: keep the defaults (QUESTIONS.md, second round). Nothing to do.
2. **Held-out delayed cycling 0.84 vs 0.85** (D-012, Q-2 answered "keep the defaults"): leave unless a new
   signal-only idea appears; never tune on the held-out grid.
3. **Alias** `tomnahass.com/vent-sim/` — **root cause found 2026-09-11 (evening), owner action needed;
   re-checked later the same evening: still the personal site's 404.**
   The redirect rules are in the personal site's repo (`~/Documents/development/personal-website/netlify.toml`,
   commit 4d756ac on `github.com/nahata5/personal-website` main). DNS already points at Netlify. The
   personal site's Netlify build fails at "preparing repo": `git@github.com: Permission denied (publickey)`
   when cloning `nahata5/personal-website`, and `gh api repos/nahata5/personal-website/keys` returns `[]`,
   so Netlify's deploy key is no longer on the GitHub repo (the webhook itself is fine: last response 204).
   Fix in the Netlify dashboard for the personal site: Site configuration → Build & deploy → Continuous
   deployment → "Manage repository" → link the repository again (re-installs the deploy key), or copy the
   site's deploy key from that page and add it under the GitHub repo's Settings → Deploy keys (read-only is
   enough; `gh repo deploy-key add <file> -R nahata5/personal-website` also works). Then trigger a deploy
   and re-check with `curl -sSL -o /dev/null -w '%{url_effective} %{http_code}\n' https://tomnahass.com/vent-sim/`
   (expect 200 with the VentSim `<title>`), then check that `assets/index-*.js` is proxied too. Nothing in
   this repo can change the outcome. If the Hugo 0.95 build fails next, that log is the next thing to read.
4. **Quiz bedside view + debrief — done** (D-019, live), and its three follow-ups are done too (masked
   picker "Case n", drive marks, Instructor attempts review; D-019 addendum, PROGRESS entry). Nothing open.
5. **Mobile-responsive layout — done** (D-020, owner-approved design, five commits, live; screenshots
   refreshed). Open only as polish: landscape phones (≈ 840 × 400) fall into the tablet rule and are
   cramped (a `(max-height: 500px)` rule could pin a shorter waveform screen); no swipe between tabs; the
   chosen tab is not persisted; the cursor readout stays after a tap until the next tap; the Validation
   page (`#validation`) was not re-laid out for phones (its tables already scroll in `.table-wrap`).
6. **Optional, still open**: light theme for the panels (waveform screen stays dark), i18n, a Pes-position
   dependence of the cardiac artifact (larger behind the heart), quiz extras for more scenarios (e.g.
   `dPes ≤ 8` for the P-SILI scenario), an explain-card/objective for the capstone that lists the fix
   order, an export of the attempts review (CSV of `ctl.progress.all()`), a `(max-height: 500px)` landscape
   rule for phones.
7. Keep the working method: tests first for anything in `src/sim`/`src/detector`/`src/edu` logic, constants
   cited, deviations in DECISIONS, clinical questions in QUESTIONS, regenerate the snapshot after scenario or
   detector changes, `SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts` for the docs.

## Hosting

Netlify (D-008). `netlify.toml` builds `npm run build` → `dist`, Node 22; GitHub Actions is CI only. Live at
https://vent-sim.netlify.app/; every push to `main` redeploys. The alias `tomnahass.com/vent-sim/` has its
proxy rules on the personal site but that site's Netlify build cannot clone its repo (deploy key missing;
404 on 2026-09-11, owner action in "What is left" 3).
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
> M9 definition-of-done walkthrough and the post-M9 entries) and docs/DECISIONS.md (D-001…D-019). The goal
> and non-negotiables are in docs/FABLE_GOAL_PROMPT.md; the spec is
> docs/superpowers/specs/2026-09-10-vent-sim-design.md. The owner has answered docs/QUESTIONS.md Q-1…Q-5:
> keep the defaults; do not reopen them.
>
> State: M0–M9 and the post-M9 extensions (Pes artifact fix, quiz extras, capstone, schematic SpO2, live
> EL/Ecw, quiz bedside view + debrief D-019 with its follow-ups, mobile-responsive layout D-020) are done
> and deployed at https://vent-sim.netlify.app/. Vitest 217/217 (held-out detector suite un-gated; the
> performance test is wall-clock and must be re-run alone if the parallel run is under load), lint clean,
> Playwright 35/35 in three projects (chromium 32, mobile 2, tablet 1; the M8 quiz test can flake under a
> loaded full run because the fix outcome depends on wall-clock click timing; re-run it alone), build
> clean. Do not revisit finished milestones except to fix a bug; never tune the detector on the held-out
> grid; regenerate src/validation/snapshot.json after any scenario change and the MODEL.md constants table
> after any constants change; keep the responsive CSS blocks at the end of theme.css.
>
> Task — first, the alias: HANDOFF "What is left" item 3 has the root cause (the personal site's Netlify
> deploy key is missing on github.com/nahata5/personal-website). Re-check with the curl there; if it now
> returns 200 with the VentSim title, record it in PROGRESS and HANDOFF; if not, say so in one line and
> move on (only the owner can fix it in the Netlify dashboard).
>
> Main task — pick from HANDOFF "What is left" item 6 in this order unless the owner says otherwise:
> (a) a light theme for the panels with the waveform screen staying dark (brainstorm the palette and the
> toggle placement with the owner first; `prefers-color-scheme` default plus a header toggle persisted in
> localStorage; contrast checked with the axe test; the bands, chips and badge colours must keep their
> meaning; screenshots stay dark); (b) the landscape-phone rule (`(max-height: 500px)`: a shorter pinned
> waveform screen, the tab bar stays) with a Playwright `mobile-landscape` project and one smoke test;
> (c) an export of the Instructor attempts review as CSV. Each is a bounded change: spec in chat or a short
> design file, tests first, one commit per task, push and check the live site (grep the served bundle for a
> literal string). No physics, detector or scenario changes; if a scenario or constant does change,
> regenerate the snapshot and the MODEL.md table. Record layout or theme choices as D-021…, add a PROGRESS
> entry and a README note, and refresh the screenshots if the desktop look changes. When you reach a good
> place around 50 % context, update docs/HANDOFF.md and write the next prompt into it.
