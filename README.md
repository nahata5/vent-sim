# VentSim

A browser-based ventilator simulator for clinical education. A physiologic model generates live pressure, flow and volume waveforms, and changing ventilator settings changes them. Dyssynchrony patterns emerge from the physics; the app labels them, explains them, and quizzes learners on them. It also shows the pressures inside the lung, including alveolar, pleural, esophageal, transpulmonary and muscle pressure, along with stress, strain and mechanical power.

> **Education only.** This is not a medical device and not a clinical decision aid.

## Status

This repo holds the design phase. The app will be built by an AI coding agent (Fable) from the goal prompt below.

| Doc | Purpose |
|---|---|
| [`docs/FABLE_GOAL_PROMPT.md`](docs/FABLE_GOAL_PROMPT.md) | Goal prompt to give the implementing agent |
| [`docs/superpowers/specs/2026-09-10-vent-sim-design.md`](docs/superpowers/specs/2026-09-10-vent-sim-design.md) | Design spec: architecture, model, patterns, validation, milestones |
| [`docs/research/01-dyssynchrony-vent-logic-realism.md`](docs/research/01-dyssynchrony-vent-logic-realism.md) | Research: dyssynchrony, ventilator logic, synthetic realism |
| [`docs/research/02-pressure-partitioning-lung-stress.md`](docs/research/02-pressure-partitioning-lung-stress.md) | Research: pressure partitioning, lung stress, effort metrics |

## Hosting (GitHub Pages)

It's a static site with no backend. Deployment is handled by GitHub Actions.

1. Create a GitHub repo and push `main`.
2. In the repo, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The build agent adds `.github/workflows/deploy.yml`. It runs `npm ci && npm test && npm run build` and publishes `dist/` using `actions/upload-pages-artifact` and `actions/deploy-pages`.
4. The site will be served at `https://<user>.github.io/<repo>/`. Vite's `base` must match that path; it's set in `vite.config.ts`.
