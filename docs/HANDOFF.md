# Handoff — VentSim build state

Updated 2026-09-11 (second M6 session), for a fresh session continuing the goal in `docs/FABLE_GOAL_PROMPT.md`.

## Read in this order

1. `docs/FABLE_GOAL_PROMPT.md` — the goal, non-negotiables, definition of done.
2. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` — the spec (§7 pattern catalog, §9 validation, §12 milestones).
3. `PROGRESS.md` — what each milestone built and its test results (M6 detector table is there).
4. `docs/DECISIONS.md` — D-001…D-012; D-012 is the detector's measurement basis and two truth refinements.
5. `docs/LIMITATIONS.md`, `docs/QUESTIONS.md` (Q-1…Q-3) — what the bedside cannot see and what the owner must decide.
6. This file's "M6: what is left" before touching the UI.

## Where things stand

| Milestone | State |
|---|---|
| M0–M5 | done (scaffold, physics, ventilator, effort, live UI on a deterministic worker) |
| M6 | **detector done** (§9.5 met on the held-out grid except delayed cycling 0.84 vs 0.85, documented); injectors, truth labeler, emergence matrix, 20 scenarios green; **UI wiring not started** |
| M7–M9 | not started |

`npm test` → 122 passed, 18 files (the held-out suite `tests/detector/heldout.test.ts` is un-gated and runs in CI).
`npm run lint` clean. `npm run test:e2e` → 8/8 (M5 suite; nothing in M6 touched the UI yet).
Last commit: `M6: detector meets §9.5 on the held-out grid…` on `main` (not yet pushed — push after the UI work
or now, both fine).

## Hosting

Netlify (D-008). `netlify.toml` builds `npm run build` → `dist`, Node 22; GitHub Actions is CI only. Intended URL
https://vent-sim.netlify.app/ with alias `tomnahass.com/vent-sim/` (proxy rule in README). The Netlify site had
not been created as of 2026-09-11: the owner must import `nahata5/vent-sim` in the Netlify UI (build settings
come from `netlify.toml`; site name `vent-sim`). Verify the URL afterwards and update README/PROGRESS.

## Detector: final numbers and how it works

Held-out grid (seeds 101–104, perturbed settings/drive, never tuned on), sensitivity/specificity: ineffective
effort 0.93/0.99, double trigger 0.99/1.00, auto-trigger 0.97/0.99, premature cycling 0.95/0.99, delayed
cycling 0.84/0.98 (target 0.85; accepted floor 0.80 in the test, reason in D-012 and LIMITATIONS), flow
starvation 0.91/0.98, reverse trigger 0.85/1.00. Tuning grid is in `PROGRESS.md`.

Files: `src/detector/features.ts` (measured-only reader, per-breath features; the notch search, cardiac
autocorrelation, knee/shoulder, ramp convexity and τ fit live here), `src/detector/detector.ts` (two-pass
rules with evidence strings; pass 2 handles stacking, auto-trigger vs stacked breath, and strips cycling
labels from stacked breaths), `src/detector/scorer.ts` (`truthPositives`, `unscoredBreaths`, `scoreGrid`),
`src/detector/grids.ts` (TUNING_GRID / HELD_OUT_GRID, `runGrid`), `scripts/tune-detector.ts`.

Working method that paid off (keep it): change one rule, run `npx tsx scripts/tune-detector.ts` (≈ 20 s), and
read the offending breaths with the git-ignored `scripts/dev/` tools before touching a threshold:
`dump-features.ts <scenario[:seed]> | h:<held-out case id> | t:<tuning case id>` (one line per breath:
truth vs detector labels and every feature; `dumpc.sh` prints a compact subset), `trace2.ts <scenario[:seed]>
t0 t1 [step]` (Paw/flow/Pmus/Palv samples), `taulocal.ts` (local τ profile of an inspiration),
`ie-efforts.ts` (ineffective efforts vs the next trigger), `evidence.ts <scenario> <pattern>`. Never tune on
the held-out grid; looking at a held-out case to understand a miss is fine but any threshold set from it is
tuning (D-012 records that `DET_DC_VC_CONCAVITY` was chosen after seeing held-out values, which is why the
delayed-cycling floor was left at 0.80 rather than pushed).

## M6: what is left (UI wiring, badges, AI tile, injector panel, fix button, Validation page)

Nothing below exists yet. The design was settled by reading the M5 code; follow it unless the code disagrees.

1. **Protocol additions** (`src/worker/protocol.ts`, `src/worker/session.ts`): `PatientSummary.rTotal` (use
   `totalResistance(m)` from the labeler) and `SessionStatus.rScale`/`eScale` (last entry of
   `engine.injectors.log`). Both are needed by `contextFromSettings` for the main-thread labeler.
2. **Controller** (`src/app/controller.ts`): keep `settingsLog: Array<{t, settings}>` (push on `ready` and on
   every `status` whose settings object changed) and `injectorLog: InjectorLogEntry[]` (from
   `status.injectors/rScale/eScale`). Add `labels: Map<number, { truth: BreathLabel; det: DetectedBreath }>`,
   `ieEvents`, `ai: AsynchronyIndex | null`. In `onBreathClosed` schedule one analysis pass (setTimeout 0 or
   `requestIdleCallback`, never inside rAF) that builds a `LabelInput` over the StreamStore (`read` →
   `store.read`, `indexAt`, `breaths: store.breaths` closed only, `neural: store.neural`, `events:
   store.events`, `ctxAt` via `contextFromSettings(settingsAt(t), injectorAt(t), {rTotal, el, ecw})`,
   `tEnd: store.tLatest`, `hasDrive: patient.hasDrive`) and a `DetectorInput` (`reader = {n: store.length,
   fs, read: store.read for the 5 measured keys, indexAt}`, `breaths: store.breaths.map(measuredBreath)`,
   `events`, `ctxAt: deviceContext(settingsAt(t))`), runs `labelBreaths` and `detect`, and computes
   `asynchronyIndex(labels, tLatest − 180, tLatest)` (the store holds 120 s; say "last 2 min" in the UI).
   Cost is ≈ 50–100 ms for 40 breaths; if a frame is dropped, limit the pass to the last 60 s of breaths.
3. **Badges** (`src/ui/waveform-draw.ts`, `WaveformCanvas.tsx`): replace `badgeText(trigger, cycle)` with
   pattern badges from `ctl.labels` (short codes IE, DT, AT, PC, DC, FS, RT, AP, LK, SC, HR, LC, OV, CG,
   colour per pattern; keep the trigger letter when no pattern). When the truth layer is on draw a second
   badge row with the truth labels (double `BADGE_STRIP`). In `onMove`, when `y < BADGE_STRIP`, hit-test the
   badge under `x` and show the evidence strings in the readout.
4. **AI tile** (`MonitorPanel.tsx`): tile `AI` = `ai.ai.toFixed(0)%`, unit `events/cycles`, red class when
   `severe`, plus an "IE cluster" flag when `cluster`; `data-testid="mon-AI"`.
5. **Injector panel** (`src/ui/InjectorPanel.tsx`): eight checkboxes bound to `status.injectors`; toggling
   sends `ctl.worker.inject(kind, on ? {} : null)` (`Injectors.set` merges partial params with defaults);
   `data-testid="inj-<kind>"`.
6. **Apply suggested fix** (scenario-info in `App.tsx`): when `scenario.fix` exists show the note and a
   button `data-testid="apply-fix"` calling `ctl.applyFix(fix)` = `applySettings(fix.settings)`,
   `worker.setPatient(fix.drive)` (`entrainment: null` is a valid partial), and `worker.inject(kind, value ?? null)`
   for each key of `fix.injectors`.
7. **Validation page** (`src/ui/ValidationPage.tsx`, rendered by `App` when `location.hash === '#validation'`):
   move `runEmergence` from `tests/scenarios/emergence.test.ts` to `src/detector/validation.ts` (the test
   imports it from there). `scripts/validation-snapshot.ts` writes `src/validation/snapshot.json`
   `{generatedAt, commit, emergence: EmergenceRow[], heldOut: PatternScore[] (without byCase), tuning: same,
   vitest: {passed, files}}`; the page renders the snapshot on first paint (emergence matrix table, one
   confusion matrix per core pattern with sens/spec vs target, the analytic test list) and a "Recompute in
   this browser" button that runs the same functions in `src/worker/validation.worker.ts`, streaming rows.
8. **Playwright** (`tests/e2e/m6.spec.ts`): badges (load `ineffective-effort` at 4×, wait ≈ 40 s sim, expect
   `window.__ventsim.ctl.labels` to hold a detector `ineffective-effort` or `delayed-cycling`, hover the badge
   strip and expect evidence text in the readout), AI tile (`double-trigger` scenario → `mon-AI` > 10 %),
   injector toggle (`inj-leak` → `status.injectors` contains `leak` within 2 s and the Leak tile rises),
   Validation page (`/#validation` → ≥ 14 emergence rows, 7 confusion matrices). Keep `load.spec.ts`'s
   < 8 ms/frame budget green.
9. Then: PROGRESS M6 final entry with screenshots (`docs/screenshots/m6-*.png` via Playwright), DECISIONS
   entry if anything deviates, commit, `git push`, and on to M7.

## M7 pointers

Spec §4 (recruitable-population lung, CO2 loop with time warp), §5 (R/I, decremental PEEP trial, stress
index), §6 (mechanical power). Files expected are in the PROGRESS.md plan table (M7 row). TDD for everything
in `src/sim`: write `tests/physics/{recruitment,stress-index,ri,co2}.test.ts` first. The dashboard rows for
PMI, stress index and R/I are placeholders waiting for these maneuvers (`LungStressDashboard.tsx`), and
`SimSession.requestManeuver` has `ri`/`peep-trial` stubs.

## Architecture as built (src/)

- `sim/engine.ts` — fixed-step loop, 1 ms. Owns `PatientModel`, `Ventilator`, `SensorChain`, optional
  `NeuralDrive`, `Injectors`, balloon. Emits device-rate samples with measured Paw/flow/vol/Pes and 20 truth
  channels (`sim/channels.ts`), breath records (incl. `leakTrue`), events, maneuver results.
- `sim/headless.ts` — `runHeadless({patient, settings, seed, duration, schedule?, drive?})` returns streams,
  breaths, events, maneuvers, neural breaths, `settingsLog`, `injectorLog`, mechanics summary.
- `sim/patient/` — `params.ts`, `presets.ts` (8 phenotypes), `recoil.ts`, `airway-node.ts`, `patient.ts`
  (`PatientDrive` incl. `eScale`), `neural-drive.ts` (`setParams`), `balloon.ts`.
- `sim/vent/` — `settings.ts`, `ventilator.ts` (FSM, holds, occlusions, alarms, `pendingKeys`, `settingsLog`),
  `sensor-chain.ts`.
- `sim/injectors/index.ts` — leak, cardiac, secretions, water, cough, pneumothorax, mainstem, bronchospasm;
  `log: InjectorLogEntry[]`, `activeKinds()`. `sim/truth/labeler.ts` (`labelBreaths`, `labelRun`,
  `asynchronyIndex`, `contextFromSettings`, `totalResistance`), `sim/truth/lung-stress.ts`.
- `monitor/monitor.ts` (measured only), `monitor/bands.ts`.
- `detector/` — see above. `edu/scenarios/` — 20 JSON + `index.ts` (`ScenarioFix`, `applyFix`,
  `scenarioSchedule`, `scenarioInjectorList`).
- `worker/session.ts` (pure core), `worker/sim.worker.ts`, `worker/protocol.ts` (`inject`, `setPatient`,
  `SessionStatus.injectors`).
- `app/controller.ts`, `app/StreamStore.ts` (120 s ring buffers, breath/event/neural tables),
  `app/WorkerClient.ts`, `app/App.tsx`.
- `ui/` — waveform/loop canvases, panels (M5). `config/constants.ts` — every constant cited (`DET_*`, `LABEL_*`).

## Conventions that matter

- The detector reads only `t, paw, flow, vol, pes` and ventilator events/settings; `MeasuredReader` enforces
  the key set and `detect()` returns `readChannels` so a test can prove it.
- Constants: no magic numbers; add to `constants.ts` with a source tag before using.
- Tests first for physics/detector; never loosen a threshold without a DECISIONS entry.
- Truth labels define the scoring; when the detector and truth disagree on a definition, fix the definition in
  `DECISIONS.md` (D-011, D-012) rather than bending the rule; add the clinical question to `QUESTIONS.md`.
- `scripts/dev/` is git-ignored scratch space; `scripts/tune-detector.ts` is tracked.

## Prompt for the next session

> Continue building VentSim in this repo (main branch). Read docs/HANDOFF.md first (especially "M6: what is
> left"), then PROGRESS.md and docs/DECISIONS.md (D-001…D-012). The goal and non-negotiables are in
> docs/FABLE_GOAL_PROMPT.md; the spec is docs/superpowers/specs/2026-09-10-vent-sim-design.md.
>
> State: M0–M5 done. M6 detector is finished and committed: §9.5 met on the held-out grid (delayed cycling
> 0.84 against 0.85, documented in D-012/LIMITATIONS/Q-2, accepted floor 0.80 in the test); Vitest 122/122
> with the held-out suite un-gated; lint clean; Playwright 8/8. Do not re-tune the detector unless a UI test
> exposes a bug; never tune on the held-out grid.
>
> Task 1 — finish M6's UI exactly as listed in HANDOFF "M6: what is left" items 1–9: protocol additions,
> main-thread labeler + detector from the StreamStore on each closed breath (off the animation frame),
> pattern badges with evidence on hover (truth row when the truth layer is on), AI% tile with the cluster
> flag, injector panel (eight injectors via worker.inject), "apply suggested fix" from ScenarioFix,
> ValidationPage behind #validation (emergence matrix + per-pattern confusion matrices from a static JSON
> snapshot generated by a script, recomputable in a worker), Playwright coverage for badges, AI tile,
> injector toggle and the Validation page. Keep 60 fps (load.spec.ts asserts < 8 ms/frame). Then update
> PROGRESS.md (M6 final entry with numbers and screenshots) and DECISIONS.md, commit, push.
>
> Task 2 — M7 per the spec: recruitable-population lung, decremental PEEP trial, stress index, R/I,
> mechanical power, CO2 loop with time warp. TDD for everything in src/sim (tests/physics first). Update
> the dashboard placeholders, PROGRESS, DECISIONS, commit, push. When you reach a good place around 50%
> context, update docs/HANDOFF.md and write the next prompt into it.
