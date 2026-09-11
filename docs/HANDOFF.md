# Handoff — VentSim build state

Updated 2026-09-11, mid-M6, for a fresh session continuing the goal in `docs/FABLE_GOAL_PROMPT.md`.

## Read in this order

1. `docs/FABLE_GOAL_PROMPT.md` — the goal, non-negotiables, definition of done.
2. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` — the spec (§7 pattern catalog, §9 validation).
3. `PROGRESS.md` — what each milestone built and its test results.
4. `docs/DECISIONS.md` — D-001…D-011, every deviation and every non-obvious modelling choice.
5. This file's "M6 state" section before touching the detector.

## Where things stand

| Milestone | State |
|---|---|
| M0–M5 | done (scaffold, physics, ventilator, effort, live UI on a deterministic worker) |
| M6 | **in progress**: injectors, truth labeler, emergence matrix (§9.4) and 20 scenarios are done and green; the signal-only detector, scorer, tuning/held-out grids exist and the detector is mid-tuning (§9.5 not yet met); UI badges, AI tile, injector controls and the Validation page are not started |
| M7–M9 | not started |

`npm test` → 110 passed, 9 skipped (the held-out detector suite, gated by `RUN_HELDOUT=1`). `npm run lint` clean.
`npm run test:e2e` → 8/8 (M5 suite; nothing in M6 touched the UI yet).

## Hosting

Netlify (D-008). `netlify.toml` builds `npm run build` → `dist`, Node 22; GitHub Actions is CI only. Intended URL
https://vent-sim.netlify.app/ with alias `tomnahass.com/vent-sim/` (proxy rule in README). **The Netlify site did
not exist as of 2026-09-11** (the subdomain returned a bare Netlify 404, so the name looks free): the owner must
import `nahata5/vent-sim` in the Netlify UI (Add new site → Import an existing project → GitHub → repo; build
settings come from `netlify.toml`; site name `vent-sim`). Verify the URL afterwards and update README/PROGRESS.

## M6 state (read before continuing)

### Done and green

- **Injectors** `src/sim/injectors/index.ts`: leak (orifice at the Y-piece), cardiac (pleural sine → flow
  oscillation ≈ A/R), secretions (band-limited 5–20 Hz R modulation), water (regular R oscillation), cough
  (expiratory Pmus bursts provoked by inflation, `onBreathStart`), pneumothorax (Ppl offset + elastance ×),
  mainstem (elastance ×2, R ×1.5), bronchospasm (ramped R ×). New drive term `eScale` in `PatientDrive`;
  `BreathRecord.leakTrue`; change logs `Injectors.log` and `Ventilator.settingsLog` ride on `HeadlessResult`.
  Tests: `tests/unit/injectors.test.ts` 8/8.
- **Live drive changes**: `SimEngine.setDriveParams` → `NeuralDrive.setParams` (entrainment-off restarts the
  free-running clock from now); worker messages `inject` and `setPatient`.
- **Truth labeler** `src/sim/truth/labeler.ts` (`labelBreaths`, `labelRun`, `asynchronyIndex`): all §7 truth
  rules, truth-only findings, AI with the Vaporidi cluster flag. Tests: `tests/unit/labeler.test.ts` 9/9.
- **Scenarios**: 20 JSON files in `src/edu/scenarios/` with `injectors`, scripted `fix` and `criteria`;
  `scenarioSchedule(def, {withFix})`, `applyFix`, `scenarioInjectorList`. The index imports files explicitly
  (no `import.meta.glob`) so tsx scripts work.
- **Emergence matrix** `tests/scenarios/emergence.test.ts` (§9.4): 14 rows green — each target pattern present
  before the fix and AI < 10% within 60 s after it; passive baseline clean. `runEmergence(def)` is exported for
  the Validation page.
- **Detector scaffolding**: `src/detector/features.ts` (measured-only reader type; `readChannels` proves no
  truth key is touched), `src/detector/detector.ts` (two-pass rule engine with evidence strings),
  `src/detector/scorer.ts` (per-pattern confusion matrices, IE scored on expiratory efforts — D-011),
  `src/detector/grids.ts` (TUNING seeds 1–4, HELD-OUT seeds 101–104 with setting/drive perturbations),
  `scripts/tune-detector.ts` (prints sens/spec and per-case FP/FN; `npx tsx scripts/tune-detector.ts` or
  `... heldout`). Debug helpers in `scripts/dev/` (git-ignored): `dump-features.ts <scenario[:seed]>`,
  `trace.ts <scenario> <t0> <t1>`, `evidence.ts <scenario> <pattern>`.

### Detector: last tuning-grid numbers (36 cases) and what to do next

| pattern | sens | spec | note |
|---|---|---|---|
| double-trigger | 0.98 | 0.98 | done (Te < max(½·Ti, 0.6 s) + unexhaled volume; stacking after any machine breath within 1 s) |
| premature-cycling | 0.78 | 0.98 | was 0.94 before the last round; see (3) |
| delayed-cycling | 0.69 | 0.96 | COPD borderline cases (τ·ln(1/ETS) rule at 1.05 s); Ti-max breaths solid |
| reverse-trigger | 0.56 | 0.97 | weak entrained efforts invisible; RT scenario Pmax raised to 8 in the last edit, re-run |
| auto-trigger | 0.25 | 1.00 | see (1) |
| ineffective-effort | 0.27 | 0.96 | was 0.57 two rounds ago; see (2) |
| flow-starvation | 0.15 | 0.97 | FS scenario itself is fully detected; the DT scenario's 0.38 s breaths are not; see (4) |

Regressions in the final round and the exact cause, so the next session can undo or finish them:

1. **Auto-trigger.** Cardiac AT now needs `f.cardiacRegular` (positive zero crossings of the centered-moving-
   average flow residual over the 5 s before the trigger, ≥ 3 crossings, period 0.4–1.25 s, CV < 0.35) with
   amplitude ≥ `DET_AT_CARDIAC_OSC` (1.0 L/min on the smoothed residual; measured 1.4–1.5 in the AT scenario)
   and pre-trigger flow rise < 12 L/min. Dumps show AT breaths at co 1.4–1.5 with the regular flag set, so the
   remaining misses are the two ATs right after cycle-off (te 0.53) and the fr/noDip gate; check with
   `dump-features.ts auto-trigger`. Leak-type AT uses `preFlowFloor > 0.5 L/min` (flow never below zero in the
   0.5 s before the trigger) and currently catches 0 of 24 leak-scenario breaths: the leak scenario's breaths
   have Te ≈ 2.5 s because the leak baseline (+5 L/min at PEEP 5) only appears once expiratory flow has decayed;
   trace with `trace.ts leak-psv 13.2 15.8` showed flow still −1 L/min at 14.9 s, i.e. the vent-side flow does
   not settle at +leak. Investigate why (leak solve? volume reset?) before tuning the rule.
2. **Ineffective effort.** Notch Paw dips are now read on a 0.1 s moving average (raw minima were noise-biased
   by ~0.4 cmH2O, which produced cardiac/secretion false positives). The COPD scenario's weak efforts
   (Pmax 5, R 22) give deflections of 3–7 L/min above the extrapolated decay with smoothed dips ≈ 0.2–0.3, so
   `DET_IE_FDEF_WITH_PDEF` 3 L/min + `DET_IE_PDEF_SMOOTH` 0.3 misses about half. Either lower the smoothed Pdef
   to 0.2 (check secretions/cardiac FPs in the report) or add a slope feature (rate of the deflection). Also
   confirm the notch "crest stall" logic (peak search stops after 0.1 s without a rise) did what was intended:
   rises in the IE scenario should be ≈ 10–13 L/min, not 3–7.
3. **Premature cycling.** `DET_PREM_NOTCH` was raised 5 → 8 → 10 L/min and now needs a smoothed Paw dip ≥ 0.25
   (`DET_PREM_NOTCH_PDEF`) to stop cardiac notches; the fibrosis premature scenario lost 18 of 108 (fn11/fn7).
   Check whether those breaths' notches fail on the dip or the rise, and whether `earlyReturn`
   (`returnRatio < 0.55` with `expReturnTime < 1 s`) should carry them.
4. **Flow starvation.** Truth = PTP of Pmus during a VC inspiration ≥ 1 cmH2O·s. Detector = concavity ≥ 1, ramp
   min < PEEP + 0.5, or `ptpDeficit ≥ 1` against a passive prediction (set PEEP + R_ref·Q + V/C_pass with R_ref =
   running max of the resistive-step R, C_pass = τe,max/R_ref, trapped volume from the previous breath). In the
   double-trigger scenario every breath starts with an active effort, so the step R is itself depressed and the
   prediction is too low; there is no passive reference. Decide: accept and document (short-Ti FS is invisible
   without a passive breath), score FS only on scenarios with a passive reference, or find a better reference.
5. **High resistance** (non-core): the step-R rule now requires end-expiratory flow > −3 L/min (auto-PEEP inflates
   the step); the bronchospasm scenario's eef is exactly −3, so it now misses. Use −5 or the auto-PEEP label.
6. **Leak** (non-core): ΣVte/ΣVti over 8 breaths < 0.85 still fires in the fibrosis premature scenario (0.71–0.83);
   the stacked-pair accounting there is asymmetric (`evidence.ts premature-cycling leak`).

Working method that paid off: change one rule, run `npx tsx scripts/tune-detector.ts` (≈ 20 s), and look at
`dump-features.ts` for the offending scenario before touching thresholds. Never tune on the held-out grid.

### Not started in M6

- UI: pattern badges above breaths (detector label; truth label when the truth layer is on), AI% tile and
  cluster flag, an injector panel (toggle leak/cardiac/secretions/water/cough/pneumothorax/mainstem/
  bronchospasm live via `worker.inject`), an "apply suggested fix" button (`ScenarioFix` → `applySettings`,
  `setPatient`, `inject`), and `ValidationPage.tsx` behind `#validation` showing the emergence matrix
  (`runEmergence`) and per-pattern confusion matrices (`scoreGrid(runGrid(HELD_OUT_GRID))`), run in a worker
  with a static JSON snapshot generated by a script for the first paint.
- The controller must run the labeler and detector on the main thread from the StreamStore on each closed
  breath (`labelBreaths` / `detect` with readers over the store; settings and injector timelines come from the
  status messages, `SessionStatus.injectors`).
- PROGRESS/DECISIONS entries for M6, screenshots, commit, deploy.

## Architecture as built (src/)

- `sim/engine.ts` — fixed-step loop, 1 ms. Owns `PatientModel`, `Ventilator`, `SensorChain`, optional
  `NeuralDrive`, `Injectors`, balloon. Emits device-rate samples with measured Paw/flow/vol/Pes and 20 truth
  channels (`sim/channels.ts`), breath records (incl. `leakTrue`), events, maneuver results.
- `sim/headless.ts` — `runHeadless({patient, settings, seed, duration, schedule?, drive?})` returns streams,
  breaths, events, maneuvers, neural breaths, `settingsLog`, `injectorLog`, mechanics summary.
- `sim/patient/` — `params.ts`, `presets.ts` (8 phenotypes), `recoil.ts`, `airway-node.ts`, `patient.ts`
  (`PatientDrive` incl. `eScale`), `neural-drive.ts` (`setParams`), `balloon.ts`.
- `sim/vent/` — `settings.ts`, `ventilator.ts` (FSM, holds incl. effort-interrupted exp hold D-009, occlusions,
  alarms, `pendingKeys`, `settingsLog`), `sensor-chain.ts`.
- `sim/injectors/index.ts` — see above. `sim/truth/labeler.ts`, `sim/truth/lung-stress.ts`.
- `monitor/monitor.ts` (measured only), `monitor/bands.ts` (Brief 2 §6 bands, power surrogates).
- `detector/` — see above. `edu/scenarios/` — 20 JSON + `index.ts`.
- `worker/session.ts` (pure core), `worker/sim.worker.ts`, `worker/protocol.ts` (`inject`, `setPatient`,
  `SessionStatus.injectors`).
- `app/controller.ts`, `app/StreamStore.ts`, `app/WorkerClient.ts` (`inject`, `setPatient`), `app/App.tsx`.
- `ui/` — waveform/loop canvases, panels (M5). `config/constants.ts` — every constant cited (`DET_*`, `LABEL_*`
  added in M6).

## Conventions that matter

- The detector reads only `t, paw, flow, vol, pes` and ventilator events/settings; `MeasuredReader` enforces
  the key set and `detect()` returns `readChannels` so a test can prove it.
- Constants: no magic numbers; add to `constants.ts` with a source tag before using.
- Tests first for physics/detector; never loosen a threshold without a DECISIONS entry.
- Truth labels define the scoring; when the detector and truth disagree on a definition, fix the definition in
  `DECISIONS.md` (see D-011 for the ones already settled) rather than bending the rule.
- `scripts/dev/` is git-ignored scratch space; `scripts/tune-detector.ts` is tracked.

## Open clinical questions

`docs/QUESTIONS.md` is still empty. Candidates from M6 worth the owner's view: whether flow starvation on very
short VC breaths (Ti < 0.4 s) should count as detectable at the bedside, and whether COPD on PSV with ETS 35%
should be labeled delayed cycling when the neural Ti happens to be long.
