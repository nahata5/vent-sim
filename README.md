# VentSim

A browser-based ventilator simulator for clinical education. A physiologic model generates live pressure,
flow and volume waveforms, and changing ventilator settings changes them the way it would at the bedside.
Patient–ventilator dyssynchrony emerges from the physics; the app labels every breath live, explains why it
is happening, lets learners fix it by adjusting settings, and exports labeled data. A truth layer shows what
the bedside cannot: alveolar, pleural (by region), esophageal, transpulmonary and muscle pressure, plus
stress, strain, driving pressure, mechanical power and recruitment.

> **Education only.** This is not a medical device and not a clinical decision aid.

**Live:** https://vent-sim.netlify.app/ (also proxied at `tomnahass.com/vent-sim/`). Validation page:
https://vent-sim.netlify.app/#validation.

## What it does

- **Physics first.** A two-compartment lung (non-dependent / dependent) with a shared chest wall, vertical
  pleural gradient, viscoelastic element, Venegas or recruitable-population recoil, ETT Rohrer resistance,
  expiratory flow limitation, a neural drive with a Pmus generator (force–velocity, jitter, entrainment,
  expiratory muscles), an esophageal balloon modelled as an imperfect measurement, and a CO2 → drive loop
  with a time warp. Eight phenotype presets reproduce the research briefs' partition tables.
- **A generic ICU ventilator** with VC-AC, PC-AC, PSV and CPAP: trigger and cycling on *measured* signals,
  refractory period, servo lag, rise time, ETS, Ti max, pressure safety, apnea backup, alarms, a sensor
  chain (low-pass, delay, noise, quantization, device rate), pending → confirm settings, and every maneuver:
  inspiratory and expiratory holds, P0.1, ΔPocc, occlusion test, R/I, decremental PEEP trial, stress index.
- **Ground-truth labels for every breath** from neural vs ventilator timing and true physiology, a
  signal-only detector with evidence strings validated on a held-out grid, an asynchrony index, and eight
  fault injectors (leak, cardiac, secretions, water, cough, pneumothorax, mainstem, bronchospasm) that act
  as terms in the equations.
- **Schematic SpO2** tile (clearly labelled; a monotone sketch from FiO2, aerated fraction, mean Paw and a
  scenario base shunt, not a gas-exchange model — `docs/MODEL.md` §5b).
- **Education**: 25 scenarios including a "find all the problems" capstone, explain cards with case-specific evidence, a quiz (identify the patterns
  with the badges hidden, then fix them within safety limits) with an instructor-set **bedside view** (hide
  truth, Pes, scenario text, derived numbers, explain cards, CO2), a locked quiz link and a templated debrief
  on submit, instructor mode with live patient controls and a JSON scenario editor, progress in localStorage.
- **Export**: session CSV and JSON, and a batch generator (browser worker or Node) that zips labeled datasets.

## Run, test, build

```bash
npm ci
npm run dev        # Vite dev server
npm test           # Vitest: unit, physics, scenario (emergence matrix) and held-out detector tests
npm run lint       # ESLint + tsc --noEmit
npm run test:e2e   # Playwright: chromium (desktop), mobile (Pixel 7), tablet (Nexus 10); SCREENSHOTS=1 adds the doc screenshots
npm run build      # production build to dist/
npm run batch -- --scenarios double-trigger,copd --seeds 1,2,3 --duration 60 --out batch.zip
npx tsx scripts/validation-snapshot.ts   # regenerate src/validation/snapshot.json after scenario/detector changes
npx tsx scripts/model-constants.ts       # regenerate the constants table in docs/MODEL.md
```

## Using the app

- **Scenario** picker (top): phenotype presets, dyssynchrony scenarios, circuit and airway problems. Each
  scenario card (drawer, Scenario tab) lists objectives and, where there is one, a suggested fix button.
- **Settings** (left): change, then **Confirm**; rate, volume and pressure changes take effect at the next
  breath (the alarm bar shows a "next breath" chip). **Injectors** and **Instructor** below.
- **Waveforms** (centre): Paw, flow, volume (+ Pes with the balloon; + truth rows with the truth toggle).
  Pattern badges above the traces come from the signal-only detector; with the truth layer on, a second
  row shows the truth labels. Hover a badge for its evidence, click it for the explain card. Time controls:
  pause, freeze, scroll back 120 s, speed 0.25–4×, sweep 6/12/24 s.
- **Monitor** (right): measured values and maneuver buttons. **Lung stress** dashboard with Brief 2 §6 bands
  and citations in the tooltips; truth-only rows are marked `T`.
- **Drawer tabs**: Scenario · Explain · Quiz · Export. The **CO2 loop** panel appears in scenarios that carry
  the loop (PaCO2, delayed chemoreceptor signal, VA, drive scale, time warp).
- **Quiz bedside view** (Instructor panel → Quiz view): tick what the learner must not see during a quiz —
  truth layer, Pes, scenario text, derived numbers (lung-stress dashboard), explain cards, CO2 — or press
  **Bedside** for all six. Outside a quiz the set has no effect, so the case can be previewed normally.
  **Copy quiz link** gives `…/#<scenario-id>?quiz=bedside` (or a comma-separated key list); opening it
  locks the session: no Instructor panel, picker and truth toggle disabled, truth exports hidden, Quiz tab
  open. On **Evaluate** the lock lifts and a debrief lists what you changed, what was happening (found /
  missed / extra), the recommended fix key by key (matched / partial / not done / opposite) with the AI
  before and after, and the physiology and recognition from the explain cards. The lock is a classroom
  convenience, not security: the URL is editable.
- **Validation** (`#validation`): analytic test list, the emergence matrix and per-pattern confusion
  matrices from the snapshot, with a "Recompute in this browser" button.
- **On a phone** (under 700 px): the waveform screen stays pinned at the top and a bottom tab bar switches
  the panel below it — **Vent** (truth-layer and balloon toggles, settings with a sticky Confirm, injectors,
  instructor), **Monitor** (tiles, maneuvers, lung stress, CO2), **Loops**, **Learn** (Scenario · Explain ·
  Quiz · Export, with the Validation link under Export). Tapping a badge opens its explain card in Learn.
  **On a tablet** (700–1099 px) the waveforms and drawer span the width with settings and monitor in two
  columns below; the desktop layout starts at 1100 px (D-020).

## Documentation

| Doc | Purpose |
|---|---|
| [`docs/MODEL.md`](docs/MODEL.md) | Every equation with symbols, units and citations; the constants table |
| [`docs/VALIDATION.md`](docs/VALIDATION.md) | Spec §9 items, the tests that cover them and the current numbers |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Deviations from the spec and choices it left open (D-001…D-020) |
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | What is schematic, what the bedside cannot see, where the model stops |
| [`docs/QUESTIONS.md`](docs/QUESTIONS.md) | Clinical questions for the owner with the defaults built around |
| [`PROGRESS.md`](PROGRESS.md) | Build log per milestone with test results and screenshots |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Map of the code and the next steps |
| [`docs/superpowers/specs/2026-09-10-vent-sim-design.md`](docs/superpowers/specs/2026-09-10-vent-sim-design.md) | Design spec |
| [`docs/research/01-dyssynchrony-vent-logic-realism.md`](docs/research/01-dyssynchrony-vent-logic-realism.md) | Research brief 1: dyssynchrony, ventilator logic, synthetic realism |
| [`docs/research/02-pressure-partitioning-lung-stress.md`](docs/research/02-pressure-partitioning-lung-stress.md) | Research brief 2: pressure partitioning, lung stress, effort metrics |

## Architecture

```
src/sim         simulation core (no DOM; runs in Node tests and in the worker)
  engine.ts       fixed-step loop, 1 ms: PatientModel ⇄ Ventilator through the airway node only
  patient/        mechanics params, presets, Venegas + recruitable recoil, airway node, neural drive,
                  balloon, gas exchange (CO2 loop)
  vent/           settings, ventilator FSM + servo + alarms, PEEP maneuvers, sensor chain
  injectors/      fault injectors as equation terms
  truth/          ground-truth labeler, lung-stress metrics
  headless.ts     runHeadless(): streams, breaths, events, maneuvers, labels input
src/monitor     measured-only monitor, stress index, dashboard bands and power surrogates
src/detector    signal-only feature extraction, rule engine with evidence, scorer, tuning/held-out grids
src/edu         scenarios (JSON), explain cards, quiz grading and session, progress
src/export      CSV, JSON, batch + zip, download
src/worker      sim worker (SimSession), validation worker, batch worker, protocol
src/app         controller (main-thread state), StreamStore ring buffers, WorkerClient, App
src/ui          Canvas2D waveforms and loops, Preact panels
src/config      constants registry: every physiologic/ventilator/detector constant with a citation
```

Physics runs in a Web Worker at 1 ms with a device-rate sensor chain; batches of measured and truth channels
cross to the main thread as transferable `Float32Array`s every 20 ms. The main thread keeps 120 s of ring
buffers, runs the labeler and the detector off the animation frame on each closed breath, and renders
sweeps and loops on Canvas2D at 60 fps. The detector reads only `t, paw, flow, vol, pes` and ventilator
events; the truth layer is for teaching displays, labels, scoring and exports.

## Hosting (Netlify)

A static site with no backend. Netlify builds and deploys it from `netlify.toml` (`npm run build`, publish
`dist/`, Node 22) on every push to `main`; GitHub Actions (`.github/workflows/deploy.yml`) is the quality
gate (lint, tests, Playwright, build).

- **Live URL:** https://vent-sim.netlify.app/ (Netlify site `vent-sim`, imported from `nahata5/vent-sim`).
- **Personal-site alias:** `tomnahass.com/vent-sim/` proxies to the same deploy. The personal site (also on
  Netlify) needs these two lines in its `_redirects` (or the equivalent `[[redirects]]` in its `netlify.toml`):

  ```
  /vent-sim   /vent-sim/   301
  /vent-sim/* https://vent-sim.netlify.app/:splat   200
  ```

Vite's `base` is `./` (from `BASE_PATH`, default `./`), so hashed assets and the module workers resolve
under the root domain and under the `/vent-sim/` proxy alike. GitHub Pages was abandoned because the
account's user site still routes `*.github.io` project sites to `tomnahass.com`, a Netlify domain (D-008).
