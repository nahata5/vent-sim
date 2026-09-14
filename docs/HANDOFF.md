# Handoff — VentSim build state

Updated 2026-09-14 (M9 complete; post-M9 extensions done: Pes artifact fix, quiz extras, capstone,
schematic SpO2, live EL/Ecw, quiz bedside view + debrief D-019 with its follow-ups, mobile-responsive layout
D-020, Cloudflare Workers hosting at `vent.nahass.ai` D-021; M10 complete: scenario authoring, My scenarios,
help overlay D-025; M11 complete: SIMV, a shared `breath` event, stacked-mandatory double triggers D-022;
M12 complete: PRVC, a breath-by-breath pressure regulator seeded by a VC test breath, the
support-withdrawal truth pattern D-023), for a fresh session continuing from `docs/FABLE_GOAL_PROMPT.md`.

## Read in this order

1. `docs/FABLE_GOAL_PROMPT.md` — the goal, non-negotiables, definition of done.
2. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` — the spec (§7 pattern catalog, §8 education, §9
   validation, §10 export, §12 milestones); `docs/superpowers/specs/2026-09-14-modes-authoring-help-design.md`
   — the spec for SIMV/PRVC/APRV, scenario authoring and the help overlay (§2–§4 modes, §5–§7 M10 parts).
3. `PROGRESS.md` — what each milestone built and its test results (M6 detector table, M7 numbers, the M9
   definition-of-done walkthrough, the M10 entry, the M11 entry, the M12 entry).
4. `docs/DECISIONS.md` — D-001…D-023, D-025 (D-024 reserved for M13 APRV); D-012
   is the detector's measurement basis, D-014 the M7 physics (recruited gas, R/I limits, CO2 loop gains, the
   settings-log bug), D-015 the education/export choices, D-016 the Pes cardiac artifact and cardiac-smoothed
   ΔPes, D-017 the schematic SpO2, D-018 live EL/Ecw, D-019 the quiz bedside view, locked link and templated
   debrief (+ follow-ups addendum), D-020 the mobile-responsive layout, D-021 Cloudflare hosting, D-025
   scenario authoring / My scenarios / help overlay, D-022 SIMV (the `breath` event and breath-kind judging,
   the end-of-period sync window and clock reset, stacked-mandatory double triggers, the "leave SIMV" fix
   finding), D-023 PRVC (the VC test breath and breath-by-breath regulator, the floor/ceiling/step, the
   support-withdrawal truth pattern and its report-only detector rule, the "treat the drive too" fix
   finding).
5. `docs/LIMITATIONS.md`, `docs/QUESTIONS.md` (Q-1…Q-5; Q-1…Q-3 answered: keep the defaults).
6. `README.md`, `docs/MODEL.md`, `docs/VALIDATION.md`, `docs/SCENARIO_AUTHORING.md` — the user-facing docs.
7. This file's "What is left" before touching anything.

## Where things stand

| Milestone | State |
|---|---|
| M0–M6 | done (scaffold, physics, ventilator, effort, live UI, labeler, injectors, detector, Validation page) |
| M7 | **done**: recruitable-population lung with real recruited gas, stress index, R/I, decremental PEEP trial, Gattinoni full power, CO2 → drive loop with time warp, truth recruitment readouts, 4 new scenarios, Playwright |
| M8 | **done**: explain cards with case evidence, quiz (identify → fix → score), instructor mode with a scenario editor, progress in localStorage, session CSV/JSON, batch zip (worker + `scripts/batch.ts`) |
| M9 | **done**: README, MODEL.md (equations + constants table via `scripts/model-constants.ts`), VALIDATION.md, determinism and performance tests, axe accessibility pass, keyboard/focus, Validation page links; definition-of-done walked in PROGRESS |
| Post-M9 | **done** (2026-09-11 → 2026-09-12): Pes cardiac artifact → systolic pulse + cardiac-smoothed ΔPes (D-016); scenario quiz extras (`quizExtras`); capstone scenario; schematic SpO2 tile (D-017); live EL/Ecw instructor control (D-018); quiz bedside view, locked quiz link and debrief (D-019) + follow-ups (masked picker, drive marks, attempts review); mobile-responsive layout (D-020); Cloudflare Workers Static Assets hosting at `vent.nahass.ai` as the primary home (D-021) |
| M10 | **done** (2026-09-14): scenario authoring through the reader's own LLM, a field-level validator as the save/run gate, "My scenarios" persisted per-browser, a first-visit help overlay (D-025) — see "M10 as built" below |
| M11 | **done** (2026-09-14): SIMV (mandatory VC or PC breaths with PS between them, end-of-period sync window), a shared `breath` event judging every mode by breath kind, stacked-mandatory double triggers, three SIMV scenarios, a reported (not gated) detector-in-SIMV table (D-022) — see "M11 as built" below |
| M12 | **done** (2026-09-14): PRVC (a VC test breath seeds a breath-by-breath pressure regulator with a step, ceiling and floor), "volume not achieved", the `support-withdrawal` truth pattern and its report-only detector rule, three PRVC scenarios (D-023) — see "M12 as built" below |

`npm test` → 268 passed, 43 files (held-out detector suite un-gated). `npm run lint` clean. `npm run test:e2e
-- --reporter=line` → 53 total: 43 passed, 1 failed (`tests/e2e/a11y.spec.ts` main-page colour-contrast on
`.chip-alarm` — re-ran that spec alone: 3/3 passed, the known one-off flake, not a regression), 9 skipped
(screenshot tests behind `SCREENSHOTS=1`). `npm run build` clean (`dist/assets/index-*.js` 286.01 kB, gzip
99.67 kB). All numbers from this session's full verification run in the `m12-prvc` worktree. Committed on
the `worktree-m12-prvc` branch; the controller merges and deploys separately (this session does not push or
poll the live site — see "Hosting"). Note: the performance test (`≥ 50× real time`) is a wall-clock test;
under a loaded machine it fails inside the parallel full run while passing alone (see PROGRESS post-M9); it
also fails the same way on unrelated commits, so treat that as environment, not regression, and re-run it
alone — it passed on the first try this session. `tests/e2e/quiz.spec.ts` and the `a11y.spec.ts`
colour-contrast check have each shown a one-off failure under a loaded full Playwright run in multiple past
sessions (M10 Tasks 5–6, the a11y check again in M11, and again this session); each has reproduced clean
when re-run alone — same rule: re-run the spec alone, report both outcomes. Live-site check after a push:
fetch the served `assets/index-*.js` and grep for a **literal** string of the change (template strings such
as `mtab-${id}` or `setting-${f.key}` are not literal in the bundle; `mobile-tabs`, `view-toggles` and
`simv-base-select` are, because those are written as literal string props) — but see the Cloudflare note
under "Hosting": `vent.nahass.ai` answers a scripted fetch with a managed challenge regardless of user
agent, so this check only works against the Netlify fallback; a real browser passes on both hosts. For M10
the literal string is `ventsim.custom.v1` (My scenarios' storage key); `ventsim.help.seen.v1` also works.
For M11 the literal string is `simv-base-select` (the settings control's test id). For M12 the literal
string is `prvc-limit` (the volume-not-achieved alarm id, used as a runtime string in `ventilator.ts` and
`waveform-draw.ts`, not a template).

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
- `src/ui/InstructorPanel.tsx` (drive / R,EL multipliers / CO2 gains live; JSON editor → `ctl.loadScenarioDef`;
  parsing moved to `parseScenarioText` in M10, see "M10 as built"); protocol `setGas`, `setPatientScale`;
  `GasExchange.setParams`.
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

## M10 as built (map of the code)

Spec `docs/superpowers/specs/2026-09-14-modes-authoring-help-design.md` §5–§7; plan
`docs/superpowers/plans/2026-09-14-m10-authoring-help.md` (seven tasks); D-025.

- **Shared bounds**: `src/sim/vent/settings.ts` — `NumericSettingKey`, `SETTING_BOUNDS` (`{min, max, unit}`
  per numeric setting), used by `clampSettings`, the settings UI and the validator so the three cannot drift.
- **Validator**: `src/edu/scenario-schema.ts` — `validateScenario(raw)` / `parseScenarioText(text)` →
  `{def, errors, warnings}`; checks every top-level key (`SCENARIO_TOP_KEYS`), the id slug, phenotype,
  category, settings (mode + every `SETTING_BOUNDS` key + alarms), drive (`DRIVE_BOUNDS`, entrainment),
  mechanics/recoil, balloon, gas, injectors (`INJECTOR_KINDS`), targetPatterns (`PATTERN_IDS`), the `fix`
  block, `criteria` (`CRITERIA_EXTRA_METRICS`), `quizExtras` (`QUIZ_EXTRA_METRICS`); unknown keys warn and are
  ignored (they stay in the stored JSON), not rejected. `src/edu/scenarios/index.ts` — `SCENARIO_CATEGORIES` (added `'mode'`),
  `isShippedScenario(id)`. `ScenarioPicker.tsx` — `CATEGORY_LABEL.mode = 'SIMV, PRVC and APRV'`.
- **Authoring prompt**: `src/edu/authoring.ts` — `AUTHORING_PROMPT` (built from the validator's own tables:
  phenotypes, modes, injector kinds, pattern ids, every bound), `EXAMPLE_SCENARIO`
  (`example-obesity-pc-short-ti`, double-triggering from a short Ti in obesity; validates clean, not in
  `SCENARIOS`), `authoringDocument()`. `scripts/authoring-doc.ts` writes `docs/SCENARIO_AUTHORING.md`
  (`npm run docs:authoring` — regenerate after any change to `authoring.ts` or the tables it reads from).
- **My scenarios**: `src/edu/custom-scenarios.ts` — `CustomScenarioStore` (guarded `localStorage`, same
  pattern as `ProgressStore`; key `CUSTOM_KEY = 'ventsim.custom.v1'`; one versioned `{version, scenarios}`
  document); `save` refuses an id in `isShippedScenario`; `all/get/remove/exportJson`. Controller
  (`src/app/controller.ts`): `customScenarios`, `findScenario(id)` (library first, then the store),
  `hasScenario(id)`, `refresh()` (re-render without touching the running scenario, used by delete).
  `App.tsx`'s hash resolver (`fromHash`) and `ScenarioPicker`'s `custom` prop / "My scenarios" optgroup
  (`data-testid="picker-custom-group"`) both go through `findScenario`/`hasScenario`.
- **Instructor authoring controls**: `src/ui/InstructorPanel.tsx` — `author-copy-prompt` (clipboard-writes
  `AUTHORING_PROMPT`, reveals read-only `author-prompt-field`), `author-load-example`, `author-validate`,
  `author-save` (validate → `customScenarios.save` → on success `loadScenario` + set `location.hash`, on
  failure show the store's error in `author-errors`), `author-errors`/`author-warnings` lists, "My scenarios"
  list (`custom-list`/`custom-row`, `custom-load`/`custom-export`/`custom-delete`). `theme.css`:
  `.instructor-body .author-errors|.author-warnings|.custom-list` rules added **before** the responsive
  `@media` blocks at the end of the file.
- **Help overlay**: `src/ui/HelpDialog.tsx` — native `<dialog>` driven with `showModal()`/`close()`
  (`help-dialog`, `help-close`, Escape and backdrop-click close), `HELP_SEEN_KEY = 'ventsim.help.seen.v1'`.
  `App.tsx`: `help` state seeded from `browserStorage().getItem(HELP_SEEN_KEY) === null` (opens once, first
  visit), header button `help-open` present regardless of quiz lock (the dialog holds no truth data so it
  stays available in the locked view); mounted only in the main `app-shell`, not on `#validation`.
  `theme.css`: `dialog.help-dialog`/`::backdrop`/`.help-body`/`button.help-open` rules, also before the
  responsive blocks. `tests/e2e/helpers/layout.ts` — `dismissHelp(page)` (seeds the seen-key via
  `page.addInitScript` before first paint); added to the `beforeEach` of every e2e spec except
  `help.spec.ts` itself (13 files).
- **Fix round**: `efd848f` — Task 5's rewording of the `instr-load` ("run without saving") status message
  dropped the word "loaded", breaking the pre-existing M8 assertion in `tests/e2e/quiz.spec.ts:68`; restored
  to `loaded "<title>" (not saved)`. No test file was touched to fix it.
- **Tests**: `tests/unit/scenario-schema.test.ts` (6), `tests/unit/authoring.test.ts` (3),
  `tests/unit/custom-scenarios.test.ts` (3), one appended test in `tests/unit/ventilator.test.ts`
  (`SETTING_BOUNDS` round trip), `tests/e2e/authoring.spec.ts` (3), `tests/e2e/help.spec.ts` (2).

## M11 as built (map of the code)

Spec `docs/superpowers/specs/2026-09-14-modes-authoring-help-design.md` §2; plan
`docs/superpowers/plans/2026-09-14-m11-simv.md` (six tasks); D-022.

- **The `breath` event and breath-kind helper**: `src/sim/types.ts` — `BreathKind = 'vc' | 'pc' | 'ps' |
  'aprv'`, `VentEvent` gains `{ type: 'breath'; t; kind; mandatory; pTarget }`. `src/sim/vent/breath-kind.ts`
  (new) — `breathKindFromMode`, `pTargetFromSettings`, `breathEventAt`; every mode's kind is a pure function
  of `settings.mode` (and `simvBase` for SIMV). `ventilator.ts`'s `startInsp` emits the event at the same
  `t` as the breath record's `tStart`, right after building the plan. The truth labeler (`labeler.ts`) and
  the detector (`detector.ts`, `features.ts`) now branch on the breath's own `kind`/`breathKind` instead of
  `ctx.mode`, so a mixed-breath mode's spontaneous and mandatory breaths are judged correctly; for the four
  pre-existing modes this is behaviour-preserving by construction (kind is 1:1 with mode), confirmed by the
  held-out grid being byte-identical before and after.
- **SIMV in the ventilator**: `src/config/constants.ts` `SIMV_SYNC_WINDOW` (0.25); `src/sim/vent/
  settings.ts` `simvBase: 'VC' | 'PC'`, `simvWindow` (in `SETTING_BOUNDS`); `src/sim/vent/ventilator.ts` —
  `vcPlan`/`pcPlan`/`psPlan` (split out of the old single `makePlan` body), `makePlan(s, backup, kind?)`
  selects per mode/kind, `hasMandatoryRate` (replaces `isAC`, now `VC-AC | PC-AC | SIMV`) gates the
  mandatory-rate time trigger and the hold/occlusion timing, `tLastMandatory` is the SIMV period clock
  (resets on every mandatory breath), `inSyncWindow` decides early-mandatory-vs-PS at trigger time. `actuate()`
  and `controlInsp`'s cycle-cause logic key off `plan.kind`, not `plan.mode` (a fix beyond the brief's literal
  text, needed for SIMV-VC to actually flow-control and volume-cycle — see `task-3-report.md`).
- **UI**: `src/ui/SettingsPanel.tsx` — `simv-base-select` (Mandatory breaths: VC/PC), `simvWindow` field
  (Sync window), SIMV-base-conditional field visibility, `dropHiddenForMode` (a draft value hidden by a
  mode/base switch is dropped, never applied silently). `src/app/controller.ts` `simvRates()` — mandatory/
  spontaneous rates over the window since SIMV was actually engaged (walks `settingsLog` backward, not just
  a fixed time window, so a prior mode's breaths never blend in). `src/ui/MonitorPanel.tsx` — `mon-RRmand`/
  `mon-RRspont` tiles spliced in next to `mon-RR` when `settings.mode === 'SIMV'`. `src/ui/HelpDialog.tsx`
  drops the "(not in this version yet)" qualifier for SIMV.
- **Truth and scenarios**: `src/sim/truth/labeler.ts` — `stackedOn(i)` finds the neural effort that
  triggered the previous breath; a machine-triggered breath starting at or before that effort's neural Ti
  (no `LABEL_EFFORT_TAIL` grace) is labeled `double-trigger` with `evidence.mandatoryStack`. Three
  scenarios: `simv-low-support` and `simv-stacking` (fix leaves SIMV for PSV), `simv-mixed-breaths` (fix
  switches `simvBase` to PC, `rr 13`, drive `rate 22`) — `src/edu/scenarios/{simv-low-support,
  simv-mixed-breaths,simv-stacking}.json`. `ScenarioCriteria.over?: 'all' | 'mandatory'` (`src/edu/
  scenarios/index.ts`, `src/detector/validation.ts`'s `runEmergence`) lets a target fraction be measured
  over mandatory breaths only, used by `simv-mixed-breaths` (flow-starvation on mandatory VC breaths).
- **Detector report**: `scripts/mode-detector-report.ts` (new, tracked) — per-breath tp/fp/tn/fn/sens/spec
  for the three SIMV scenarios against four patterns, printed as a markdown table; pasted into
  `docs/VALIDATION.md`'s "Detector in SIMV" section. Reported, not gated — the held-out grid has no SIMV
  breaths and stays untouched.
- **Fix-round finding, recorded in D-022**: the truth rule's first draft (with the `LABEL_EFFORT_TAIL`
  grace period) flagged the mandatory clock landing just after relaxation began as a double trigger on
  nearly every SIMV cycle, making every scenario unpassable; tightening it (require the mandatory breath to
  start at or before the end of neural Ti) fixed that. The remaining after-fix asynchrony-index gate
  (< 10 %) could not be cleared by tuning SIMV settings alone for two of the three scenarios — a
  fixed-mandatory-Ti-vs-variable-neural-effort mismatch and a rate/rate harmonic lock are structural, not
  tunable — so those two scenarios' scripted fixes leave SIMV for PSV instead. This is recorded as a
  pedagogic finding, not a workaround: it demonstrates the real bedside reason clinicians often leave SIMV.
- **Tests**: `tests/unit/breath-kind.test.ts` (new, 3), appended `breath events` block in
  `tests/unit/ventilator.test.ts`, appended `breath kind on labels` + SIMV + synthetic stacked-mandatory
  blocks in `tests/unit/labeler.test.ts`, `tests/physics/simv.test.ts` (new, 6), appended SIMV case in
  `tests/unit/scenario-schema.test.ts`, appended SIMV rows in `tests/unit/scenarios.test.ts` and
  `tests/scenarios/emergence.test.ts`, `tests/e2e/modes.spec.ts` (new, 2: mode/base select + tiles; stale
  hidden-draft-value drop), appended SIMV assertion in `tests/e2e/help.spec.ts`.

## M12 as built (map of the code)

Spec `docs/superpowers/specs/2026-09-14-modes-authoring-help-design.md` §3; plan
`docs/superpowers/plans/2026-09-14-m12-prvc.md` (five tasks); D-023.

- **The PRVC regulator in the ventilator**: `src/sim/vent/ventilator.ts` — private fields `regulatedDp`
  (ΔP above PEEP, null until seeded), `prvcTestPending`, `prvcShortCount`, `prvcCompliance` (the fallback
  denominator below `PRVC_DP_EPSILON`). `makePlan`'s `'PRVC'` case runs a square-flow VC test breath
  (`vcPlan` with `vcTiming: 'ti'`, `flowPattern: 'square'`, `pause: k('PRVC_TEST_PAUSE')`) when
  `prvcTestPending`, otherwise a PC breath at PEEP + `regulatedDp`. `prvcRegulate(t, events)` runs at every
  breath start in every mode (Spec 2026-09-14 §3, D-023): outside PRVC it clears `prvcShortCount` and the
  `prvc-limit` alarm; entering a PRVC breath it steps `regulatedDp` from the previous breath's measured Vti
  (`C_eff = Vti_prev/regulatedDp_prev`, or `prvcCompliance` below `PRVC_DP_EPSILON`) by
  `clamp(PRVC_GAIN·(Vt − Vti_prev)/C_eff, ±PRVC_STEP_MAX)`, then clamps to `[prvcMinDp, prvcCeiling(s)]`
  where `prvcCeiling = highPpeak − PRVC_PMAX_MARGIN − PEEP`; two consecutive at-ceiling breaths under
  `PRVC_LIMIT_VT_FRACTION` of the target set `prvc-limit`. `prvcSeedFromTestBreath(m)` runs at every
  inspiratory exit (not only after a completed test-breath pause) so an alarm-cycled test breath (no
  plateau) still seeds `regulatedDp` from the end-inspiratory pressure — a modelling choice beyond the
  plan's literal text (D-023). `prvcResetIfRetargeted(prev)` forces a new test breath on entering PRVC or
  changing `vt` (both the `applySettings` and `commitPending` paths), but not on a PEEP change.
  `hasMandatoryRate` (`'VC-AC' | 'PC-AC' | 'SIMV' | 'PRVC'`) gates the mandatory-rate time trigger for PRVC
  too. Public getter `Ventilator.prvcDp`.
- **Settings and constants**: `src/sim/vent/settings.ts` `prvcMinDp` (in `SETTING_BOUNDS`, PRVC-only
  field). `src/config/constants.ts`: `PRVC_STEP_MAX` (3), `PRVC_PMAX_MARGIN` (5), `PRVC_MIN_DP` (5),
  `PRVC_TEST_PAUSE` (0.3), `PRVC_GAIN` (1.0), `PRVC_DP_EPSILON` (0.5), `PRVC_LIMIT_VT_FRACTION` (0.9),
  `LABEL_SUPPORT_WITHDRAWAL_MARGIN` (1), `DET_SW_VT_EXCESS` (1.05).
- **UI**: `src/ui/MonitorPanel.tsx` — `Props.prvcDp`, a `Pinsp` tile (`data-testid="mon-Pinsp"`, "cmH2O
  PRVC ΔP above PEEP") spliced in next to `ΔP` when the mode is PRVC. `src/ui/SettingsPanel.tsx` —
  `prvcMinDp` field ("PRVC floor above PEEP", `modes: ['PRVC']`, `data-testid="setting-prvcMinDp"`), a
  high-pressure alarm label note "(PRVC ceiling = limit − 5)" shown in PRVC. `src/ui/HelpDialog.tsx` drops
  the "(not in this version yet)" qualifier for PRVC. `src/app/controller.ts` `SessionStatus.prvcDp` reads
  `Ventilator.prvcDp` each tick.
- **Truth and detector**: `src/sim/truth/labeler.ts` — `support-withdrawal` fires on a PRVC `kind === 'pc'`
  breath whose `pTarget − peep ≤ prvcMinDp + LABEL_SUPPORT_WITHDRAWAL_MARGIN` while `pmusPeak ≥ PMUS_HIGH`;
  evidence `dpAboveFloor`. `DeviceContext.prvcMinDp`/`vt` (`src/detector/features.ts`) let the report-only
  detector read the same settings. `src/detector/detector.ts`'s rule (D-023, supersedes the plan's
  `earlySag` draft): floor test AND `triggerCause === 'patient'` AND `b.vti ≥ DET_SW_VT_EXCESS × (ctx.vt /
  1000)`; evidence string cites ΔP, Vti and `f.earlySag` for the clinician reading it, but `earlySag` is not
  a conjunct. `src/edu/cards/index.ts` — `support-withdrawal` card and its `caseEvidence` line (regulated
  pressure, ΔP above the floor, peak Pmus). `src/ui/waveform-draw.ts` — badge code `SW`, colour `#7986cb`.
  `tests/detector/prvc.test.ts` (new) covers the rule; the held-out detector grid and its scorer are
  untouched (no PRVC breaths in it).
- **Scenarios**: `src/edu/scenarios/{prvc-pressure-withdrawal,prvc-volume-not-achieved,
  prvc-double-trigger}.json`. `prvc-pressure-withdrawal`'s fix is PSV (PS 12) with the drive also treated
  (`ScenarioFix.drive`, rate 16, Pmax 8); `pendelluft` is not in its `targetPatterns` (the pattern needs the
  two-compartment recruitable-recoil lung, which this phenotype does not use). `prvc-double-trigger`'s fix
  lengthens Ti to 1.1 s against a 1.2 s neural Ti; `prvc-volume-not-achieved`'s fix removes the bronchospasm
  injector and lengthens Ti to 1.3 s.
- **Detector report**: `scripts/mode-detector-report.ts` extended — `IDS` gained the three PRVC scenario
  ids, `PATTERNS` gained `support-withdrawal` and `high-resistance`; its table (SIMV and PRVC rows) is in
  `docs/VALIDATION.md`'s "Detector in SIMV and PRVC" section. Reported, not gated.
- **Fix-round findings, recorded in D-023**: the alarm-cycled test-breath seeding, `PRVC_DP_EPSILON`, and
  `prvcRegulate`'s clear-on-mode-change are all deviations from the plan's literal text, found while
  writing `tests/physics/prvc.test.ts`. The detector rule ruling (floor + patient trigger + Vti excess,
  not `earlySag`) came from Task 3's tuning runs (separators: patient trigger 15/15 vs 0/11, Vti/Vt
  1.10–1.18 vs 0.99–1.01). `prvc-pressure-withdrawal`'s fix needed widening to treat the drive after a full
  PC-AC/PSV settings sweep at the unmodified drive could not clear the 10 % after-fix asynchrony gate (best
  38.5 % / 42.1 %) — the M12 counterpart of D-022's "leave the mode" finding.
- **Tests**: `tests/physics/prvc.test.ts` (new, 7), `tests/detector/prvc.test.ts` (new), appended blocks in
  `tests/unit/labeler.test.ts` (the truth pattern), `tests/unit/scenarios.test.ts` and
  `tests/scenarios/emergence.test.ts` (three PRVC rows), `tests/e2e/modes.spec.ts` (the regulated-pressure
  tile and the floor field), `tests/e2e/help.spec.ts` (the dropped qualifier).

## What is left (post-M9)

All spec milestones and the optional extensions listed in the previous handoff are built, and M10 (scenario
authoring, My scenarios, help overlay, D-025), M11 (SIMV, D-022) and M12 (PRVC, D-023) are also done — see
"M10 as built", "M11 as built" and "M12 as built" above. What is actually next is **M13 APRV** (spec §4,
D-024 reserved), whose plan still needs writing first, following the shape of
`docs/superpowers/plans/2026-09-14-m11-simv.md` and `…-m12-prvc.md` (tests first per task, one commit per
task, interfaces stated up front, a Global Constraints section pinning the held-out grid), per
`docs/superpowers/specs/2026-09-14-modes-authoring-help-design.md` §4. See "Prompt for the next session"
below. The rest of this section is the pre-M10 leftover list, still accurate:

1. **Owner questions** Q-4 and Q-5 are answered: keep the defaults (QUESTIONS.md, second round). Nothing to do.
2. **Held-out delayed cycling 0.84 vs 0.85** (D-012, Q-2 answered "keep the defaults"): leave unless a new
   signal-only idea appears; never tune on the held-out grid.
3. **Alias** `tomnahass.com/vent-sim/` — **root cause found 2026-09-11 (evening), owner action needed;
   re-checked later the same evening: still the personal site's 404.** No longer blocks VentSim's public URL:
   D-021 moves the primary home to Cloudflare Workers Static Assets at `vent.nahass.ai`, which does not depend
   on the personal site. The Cloudflare project is connected and its build passes; deploy is `npx wrangler deploy`
   against `[assets]` in `wrangler.toml` (a Pages-shaped config makes wrangler run its setup wizard and fail —
   see D-021). Owner adds the custom domain once, and separately does the Netlify deploy-key fix below if
   tomnahass.com matters.
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

**Cloudflare Workers Static Assets (primary, D-021)** — `vent.nahass.ai`. `wrangler.toml` `[assets] directory
= "./dist"`, no `main`; Workers Builds runs `npm run build` then `npx wrangler deploy`; production branch
`main`. `wrangler` is pinned as an exact devDependency (version-sensitive autoconfig behaviour, see D-021).
`npm run deploy` builds and deploys the same way locally; `npx wrangler deploy --dry-run` validates config
without deploying.

**Netlify (fallback)** — https://vent-sim.netlify.app/, `netlify.toml` builds `npm run build` → `dist`, Node
22; redeploys on every push to `main`. GitHub Actions (`.github/workflows/deploy.yml`) is CI only (lint,
tests, Playwright, build) on both.

The alias `tomnahass.com/vent-sim/` has its proxy rules on the personal site but that site's Netlify build
cannot clone its repo (deploy key missing; 404 on 2026-09-11, owner action in "What is left" 3); it no longer
blocks VentSim's public URL since D-021.

Deploy check used after each push: fetch the served `assets/index-*.js` and grep for a **literal** string
unique to the commit (a template string like `` `mtab-${id}` `` is not literal in the bundle). For M10 that
string is `ventsim.custom.v1`; for M11 it is `simv-base-select` (verified present in the built
`dist/assets/index-*.js` this session; not pushed or polled live per the controller's ruling for this
task — the branch is merged and deployed separately).

**`vent.nahass.ai` blocks scripted fetches (found this session).** A plain `curl`/`fetch` request against
`vent.nahass.ai` — any user agent — gets a Cloudflare **managed challenge** back (HTTP 403,
`cf-mitigated: challenge` response header), not the page. This is a Cloudflare account-level security
setting on the zone, not anything in `wrangler.toml` or this repo, and it means the served-bundle deploy
check above only actually works against the Netlify fallback (`vent-sim.netlify.app`) when run as a
scripted request. A real browser (a person, or a Playwright/`browser_navigate` session) passes the
challenge transparently and sees the live site on both hosts — only a bare scripted HTTP client is
affected. Use the Netlify URL for a scripted post-push check, or drive a real browser against
`vent.nahass.ai` if the check needs to be against the primary host specifically.

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
- `detector/` — see above. `edu/scenarios/` — 28 JSON (incl. `capstone.json` and the three SIMV scenarios) + `index.ts`.
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

> Continue VentSim in this repo. Read docs/HANDOFF.md first, then PROGRESS.md (the M9 definition-of-done
> walkthrough, the post-M9 entries, the M10 entry, the M11 entry, and the M12 entry) and docs/DECISIONS.md
> (D-001…D-023, D-025; D-024 is reserved for APRV). The goal and non-negotiables are in
> docs/FABLE_GOAL_PROMPT.md; the original spec is docs/superpowers/specs/2026-09-10-vent-sim-design.md; the
> spec for what comes next is docs/superpowers/specs/2026-09-14-modes-authoring-help-design.md (§4 is
> APRV). The owner has answered docs/QUESTIONS.md Q-1…Q-5: keep the defaults; do not reopen them.
>
> State: M0–M9, the post-M9 extensions (Pes artifact fix, quiz extras, capstone, schematic SpO2, live EL/Ecw,
> quiz bedside view + debrief D-019 with its follow-ups, mobile-responsive layout D-020, Cloudflare hosting
> D-021), **M10 — scenario authoring, My scenarios, help overlay (D-025)**, **M11 — SIMV, the shared
> `breath` event, stacked-mandatory double triggers (D-022)**, and **M12 — PRVC, the VC-test-breath-seeded
> pressure regulator, the support-withdrawal truth pattern and its report-only detector rule (D-023)** are
> done. Primary host https://vent.nahass.ai (Cloudflare, D-021); fallback https://vent-sim.netlify.app/ —
> note `vent.nahass.ai` answers a scripted fetch with a Cloudflare managed challenge (403, any user agent)
> regardless of the request, so a served-bundle deploy check by curl/fetch only works against the Netlify
> fallback; a real browser passes on both hosts (see "Hosting"). Vitest 268/268 across 43 files (held-out
> detector suite un-gated; the performance test is wall-clock and must be re-run alone if the parallel run
> is under load), lint clean, Playwright 43/43 (+ 9 screenshot tests behind `SCREENSHOTS=1`) across three
> projects (chromium, mobile, tablet; `tests/e2e/quiz.spec.ts` and the `a11y.spec.ts` colour-contrast check
> have each shown a one-off flake under a loaded full run, most recently the a11y check again this session —
> re-run the spec alone and report both outcomes if it recurs), build clean (`dist/assets/index-*.js` 286.01
> kB, gzip 99.67 kB). Do not revisit finished milestones except to fix a bug; never tune the detector on the
> held-out grid (the seven held-out tp/fp/tn/fn lines are pinned in the M11 plan's Global Constraints,
> `docs/superpowers/plans/2026-09-14-m11-simv.md`, and confirmed unchanged again this session — cite them in
> the M13 plan's Global Constraints too); regenerate src/validation/snapshot.json after any scenario change
> and the MODEL.md constants table after any constants change (`npx tsx scripts/model-constants.ts`); keep
> the responsive CSS blocks at the end of theme.css; run Playwright in the foreground with the plain Bash
> tool (never Monitor or background); never read a dispatched subagent's transcript file directly — take its
> final report; each mode removes its own "(not in this version yet)" qualifier from `src/ui/HelpDialog.tsx`
> when it ships; the nested `.claude/worktrees` directory is git- and eslint-ignored, so nothing inside it
> needs to lint or be committed from the parent checkout. The M10 deploy check is the literal string
> `ventsim.custom.v1` in the served bundle; M11's is `simv-base-select`; M12's is `prvc-limit` (a runtime
> string, not a template — `data-testid={...}` template strings like `setting-${f.key}` are never literal in
> the bundle).
>
> Task — **write, then execute, the M13 APRV plan**. No plan exists yet for APRV (unlike M12, which started
> from an already-written plan); write `docs/superpowers/plans/2026-09-14-m13-aprv.md` first, in the shape
> of `docs/superpowers/plans/2026-09-14-m11-simv.md` and `…-m12-prvc.md`: tests first per task, one commit
> per task, interfaces stated up front, a Global Constraints section pinning the held-out grid (the seven
> lines above) and the push/deploy policy for the session. Read spec §4 for APRV's mechanics (`phigh`,
> `plow`, `thigh`, `tlow`, `tlowMode` "fixed" or "pefr" with `tlowPefr`) before writing the plan; `MODE_NOTES`
> in `src/edu/authoring.ts` already has a placeholder note for these settings keys — check the plan's design
> matches it, or update the note if the built settings differ. Then execute the plan with subagent-driven
> development in a fresh `EnterWorktree` worktree rebased onto local main. APRV needs: the ventilator
> FSM/settings support, the new settings keys added to `SETTING_BOUNDS` (`src/sim/vent/settings.ts`) with
> `'APRV'` added to `IMPLEMENTED_MODES` (`src/sim/types.ts`, already has `'VC-AC' | 'PC-AC' | 'PSV' | 'CPAP'
> | 'SIMV' | 'PRVC'`) so `scenario-schema.ts` and `authoring.ts` pick it up automatically (no change to the
> authoring/help/My-scenarios code itself should be needed), scenarios exercising it (the `'mode'` scenario
> category and `scripts/mode-detector-report.ts`'s pattern are exactly for this — extend the script's
> `IDS`/`PATTERNS` rather than writing a new one, the way M11 and M12 each did), and a decision entry
> D-024 recording APRV's design choices in the same register as D-022 and D-023 (prose paragraphs, numbers
> cited, no bullet soup). Tests first for anything in `src/sim`/`src/detector`/`src/edu`; regenerate the
> validation snapshot and the MODEL.md constants table if scenarios or constants change. If a scenario's
> after-fix asynchrony index resists tuning within the authorized ranges the way two of M11's SIMV scenarios
> and M12's `prvc-pressure-withdrawal` did, that is a legitimate outcome to report and record — D-022's
> "leave the mode" finding and D-023's "treat the drive too" finding are the precedent — not something to
> force by loosening a labeler rule or widening scope unauthorized. Confirm the push/deploy policy for the
> session before pushing (the M10, M11 and M12 sessions were each told to commit only and let a controller
> merge and deploy); check the live site with a literal string in the served bundle once it is deployed (use
> the Netlify URL for a scripted check, or a real browser against `vent.nahass.ai`). When you reach a good
> place around 50 % context, update docs/HANDOFF.md and write the next prompt into it.
