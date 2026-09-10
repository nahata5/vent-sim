# Goal prompt for Fable: build VentSim

> Paste everything below the line into Fable as its goal. Run it from the repo root (`vent-sim/`) so that it can read `docs/`.

---

## Goal

Build **VentSim**: a browser-hosted, clinically rigorous mechanical-ventilator simulator for teaching. It generates **live synthetic pressure, flow and volume waveforms from a physiologic model**. When a learner changes a ventilator setting, the waveforms change the way they would at the bedside. **Patient–ventilator dyssynchrony emerges from the physics.** Nothing is drawn by hand. The app **auto-labels each breath live, explains why it is happening, lets learners fix it by adjusting settings, and exports labeled data**.

It must also expose the pressures the bedside cannot show directly. That means lung versus chest wall, alveolar, pleural (non-dependent and dependent regions), esophageal, transpulmonary and muscle pressure, plus stress, strain, driving pressure and mechanical power. It is a static site with no backend.

## Read these first; they are your source of truth

1. `docs/superpowers/specs/2026-09-10-vent-sim-design.md` is the **design spec**. It defines the architecture, equations, modules, pattern catalog, education features, validation criteria and milestones. Follow it. If you must deviate, record the decision and your reasoning in `docs/DECISIONS.md`.
2. `docs/research/01-dyssynchrony-vent-logic-realism.md` covers the lung and Pmus model, ventilator logic, dyssynchrony signatures, detection thresholds, synthetic realism and datasets.
3. `docs/research/02-pressure-partitioning-lung-stress.md` covers partitioned elastance, Ppl/Pes/PL, nonlinear mechanics and recruitment, stress and strain, mechanical power, effort metrics (P0.1, ΔPocc, PMI), pendelluft and maneuvers.

Every number you use should come from these documents. Where the briefs tag a value **[M]** or **[uncertain]**, pick a sensible default, put it in `src/config/constants.ts` with `{value, unit, source, confidence}`, and move on. Do not stall trying to pin down constants the literature itself does not pin down.

## Non-negotiable principles

1. **Physics first, emergent patterns.** Build two independent processes coupled only through physics:
   - a patient, with its own neural clock and Pmus;
   - a ventilator, with a trigger/limit/cycle state machine acting on *measured* signals.

   Fault injectors (leak, cardiac oscillation, secretions, water, cough, pneumothorax, mainstem intubation, bronchospasm) must act as terms in the equations, never as visual overlays.
2. **Bedside view ≠ truth.** The ventilator, monitor and detector see only device-rate Paw, flow and volume (with noise, filtering, delay and quantization), their own phase and event markers, and Pes when the balloon is enabled. Truth channels (true Pmus, Ppl by region, Palv, PL, neural timing, recruitment) are for teaching displays, ground-truth labels and scoring. **The detector must never read truth.**
3. **Ground-truth labels for every breath**, from neural timing versus ventilator timing plus the true physiology. These labels grade the quiz, score the detector and populate exports.
4. **Deterministic.** Use a seeded PRNG everywhere. The same seed, scenario and inputs must produce byte-identical streams.
5. **Cited constants.** No unexplained magic numbers in the physics, detector or thresholds.
6. **Static and client-only.** Use Vite and strict TypeScript, and run the simulation in a Web Worker. Send data as transferable Float32Array batches over postMessage; no SharedArrayBuffer. Render waveforms with custom Canvas2D. Keep dependencies minimal. Use Vitest and Playwright, and deploy to GitHub Pages through GitHub Actions.
7. **GitHub Pages target.** The site is served from `https://<user>.github.io/<repo>/`.
   - Set Vite's `base` from `process.env.BASE_PATH`, defaulting to `'./'`, so assets and the Web Worker resolve under the subpath.
   - Add `.github/workflows/deploy.yml`. On push to `main` it should run `npm ci`, lint, `npm test`, and `npm run build`, then publish `dist/` with `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`.
   - Don't use client-side routes that need server rewrites. Use hash routing or a single page.
8. **Education only.** Show a disclaimer. Use a generic ICU-ventilator look, with no vendor branding or cloned layouts.

## Scope (v1)

- **Modes:** VC-AC, PC-AC, PSV and CPAP. Keep the interfaces ready for SIMV and PRVC, but don't build those modes.
- **Physiology** (spec §4):
  - a two-compartment (non-dependent and dependent) lung with shared chest wall and airway resistance (ETT Rohrer, per-compartment R, optional expiratory flow limitation);
  - a viscoelastic element;
  - Venegas nonlinear lung recoil, then a recruitable-population lung;
  - vertical pleural gradient and regional Pmus transmission, so pendelluft can emerge;
  - a Pmus generator with isometric and force–velocity terms, jitter, entrainment for reverse triggering, and expiratory muscles;
  - an esophageal balloon modeled as an imperfect measurement;
  - a CO2 → drive loop with time warp;
  - phenotype presets that reproduce Brief 2 Table 1.
- **Ventilator** (spec §5): the full state machine including refractory period, servo lag, rise time and ETS cycling, plus alarms, apnea backup, the sensor chain, and every maneuver listed (inspiratory and expiratory holds, P0.1, ΔPocc, occlusion test, R/I, decremental PEEP trial, stress index).
- **Monitoring** (spec §6): the monitor panel, a lung-stress dashboard with threshold bands and citations, and a truth-layer toggle ("What the bedside sees ↔ what's really happening").
- **Patterns** (spec §7 table): ineffective effort, auto-trigger, delayed trigger, double trigger and breath stacking, reverse trigger, premature and delayed cycling, flow starvation, overshoot, auto-PEEP, leak, secretions and water, high resistance, low compliance, cough, and the asynchrony index with cluster flag. Also truth-only findings: pendelluft, tidal recruitment, overdistension, and high or low effort.
- **Education** (spec §8): at least 18 scenarios, explain cards with case-specific evidence drawn from truth (templated text, no LLM), quiz mode (identify the pattern, then fix it within safety limits), instructor mode with a scenario editor, and progress stored in localStorage.
- **Export** (spec §10): session CSV and JSON, and a headless batch generator that produces a zip of labeled datasets.

## How to work

- Build in the **milestone order M0 → M9** from spec §12. Don't start a milestone until the previous one's exit criteria are green. M1–M6 alone must already be a usable, deployed teaching tool.
- **Test-driven for the physics and the detector.** Write the analytic, partition, calibration and emergence tests from spec §9 *before* the code that satisfies them. Fix the code to meet the tests, not the other way round. Never loosen a threshold without a DECISIONS.md entry that cites a reason.
- **Keep the detector honest.** Tune detector thresholds on one seed and phenotype grid, and report its scores on a disjoint held-out grid. Every detector label must carry evidence, e.g. `Fdef 8.1 L/min ≥ 5.45`.
- After each milestone:
  - update `PROGRESS.md` with what was built, test results, a screenshot or GIF path where relevant, and known issues;
  - commit;
  - deploy.
- Keep files focused and small. Put the simulation core in `src/sim/{patient,vent,injectors,truth,math}` with no DOM access, so it can run headless in both Node tests and the worker.
- When the literature disagrees (for example the obesity partition data in Brief 2 §1.1), implement the default the brief recommends and note the alternative in `MODEL.md`.
- Ask the clinical owner only when a decision is genuinely clinical and the briefs don't settle it. Batch those questions into `docs/QUESTIONS.md` and keep building around them.

## Definition of done

1. Every item in spec §9 is green in CI:
   - analytic physics
   - partition
   - effort calibration (Bertoni k1 −0.74 ± 0.05, k2 0.66 ± 0.05)
   - emergence matrix for every scenario (target pattern present, and the scripted fix brings AI below 10% within 60 s)
   - detector targets on the held-out grid (sensitivity ≥ 0.85 and specificity ≥ 0.90 for the core patterns; reverse trigger ≥ 0.75 and ≥ 0.90)
   - determinism
   - performance budget
   - Playwright smoke tests
2. An in-app **Validation page** shows the analytic test results, the emergence matrix, and per-pattern confusion matrices.
3. The app is deployed at a public static URL.
4. The docs are complete:
   - `README.md` (run, build, deploy, architecture)
   - `MODEL.md` (every equation, with symbols, units and citations)
   - `VALIDATION.md`
   - `DECISIONS.md`
   - a known-limitations list, including what is schematic, such as SpO2
5. A clinician can load any scenario, see the pattern auto-labeled, open the explain card, toggle the truth layer to see Ppl, Pes, PL and Pmus by region, change settings, and watch the pattern resolve while the lung-stress dashboard stays within limits.

Start with M0. Before writing code, write a short plan in `PROGRESS.md` that maps each milestone to the files you expect to create.
