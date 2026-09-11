# VentSim

A browser-based ventilator simulator for clinical education. A physiologic model generates live pressure, flow and volume waveforms, and changing ventilator settings changes them. Dyssynchrony patterns emerge from the physics; the app labels them, explains them, and quizzes learners on them. It also shows the pressures inside the lung, including alveolar, pleural, esophageal, transpulmonary and muscle pressure, along with stress, strain and mechanical power.

> **Education only.** This is not a medical device and not a clinical decision aid.

## Status

Under construction, milestone by milestone. See [`PROGRESS.md`](PROGRESS.md) for what is built and tested.

## Run, test, build

```bash
npm ci
npm run dev        # Vite dev server
npm test           # Vitest: unit, physics, scenario and detector tests
npm run lint       # ESLint + tsc --noEmit
npm run test:e2e   # Playwright smoke tests (builds and previews the site)
npm run build      # production build to dist/
```

| Doc | Purpose |
|---|---|
| [`docs/FABLE_GOAL_PROMPT.md`](docs/FABLE_GOAL_PROMPT.md) | Goal prompt to give the implementing agent |
| [`docs/superpowers/specs/2026-09-10-vent-sim-design.md`](docs/superpowers/specs/2026-09-10-vent-sim-design.md) | Design spec: architecture, model, patterns, validation, milestones |
| [`docs/research/01-dyssynchrony-vent-logic-realism.md`](docs/research/01-dyssynchrony-vent-logic-realism.md) | Research: dyssynchrony, ventilator logic, synthetic realism |
| [`docs/research/02-pressure-partitioning-lung-stress.md`](docs/research/02-pressure-partitioning-lung-stress.md) | Research: pressure partitioning, lung stress, effort metrics |

## Architecture

Physics runs in a Web Worker (`src/worker/sim.worker.ts` → `SimSession` → `SimEngine`) at 1 ms with a
device-rate sensor chain; batches of measured and truth channels cross to the main thread as transferable
`Float32Array`s every 20 ms. The main thread keeps 120 s of ring buffers (`src/app/StreamStore.ts`), a
measured-only `Monitor`, truth-derived lung-stress metrics, and renders sweeps and loops on Canvas2D.
Preact handles the panels. Everything under `src/sim` has no DOM access and runs identically in Vitest.
Details: `docs/HANDOFF.md` (architecture as built), `docs/DECISIONS.md`, `PROGRESS.md`.

## Hosting (Netlify)

It's a static site with no backend. Netlify builds and deploys it from `netlify.toml` (`npm run build`,
publish `dist/`, Node 22) on every push to `main`; GitHub Actions (`.github/workflows/deploy.yml`) is the
quality gate (lint, tests, Playwright smoke, build) and no longer deploys.

- **Live URL:** https://vent-sim.netlify.app/ (Netlify site `vent-sim`, imported from `nahata5/vent-sim`).
- **Personal-site alias:** `tomnahass.com/vent-sim/` proxies to the same deploy. The personal site
  (also on Netlify) needs these two lines in its `_redirects` (or the equivalent `[[redirects]]` in its
  `netlify.toml`):

  ```
  /vent-sim   /vent-sim/   301
  /vent-sim/* https://vent-sim.netlify.app/:splat   200
  ```

Vite's `base` is `./` (from `BASE_PATH`, default `./`), so hashed assets and the module worker resolve
under the root domain and under the `/vent-sim/` proxy alike. GitHub Pages was abandoned because the
account's user site still routes `*.github.io` project sites to `tomnahass.com`, which is a Netlify
domain (see `PROGRESS.md`, M1 known issues).
