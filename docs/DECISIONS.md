# Decisions

Deviations from the design spec and choices the spec leaves open, with reasoning. Newest last.

## D-001 · UI framework: Preact with TSX (2026-09-10)

The spec allows "vanilla TS or Preact". The settings panel, monitor, dashboard, cards, quiz and instructor
editor are a lot of stateful DOM. Preact (about 4 kB) keeps that manageable without a heavy framework.
Waveforms and loops stay on custom Canvas2D as required. No JSX plugin is needed: esbuild's automatic JSX
runtime with `jsxImportSource: preact` is configured in `vite.config.ts` and `tsconfig.json`.

## D-002 · Ventilator logic runs at the device rate, physics at 1 kHz (2026-09-10)

Spec §2.2 says the ventilator sees only device-rate measured signals. The controller therefore evaluates
trigger and cycle rules every `1/fs` s (default 100 Hz) on the sensor-chain output and holds its command
between evaluations. The flow source, pressure servo and exhalation valve are continuous physics at 1 kHz.
This reproduces the detection-latency component of trigger delay for free.

## D-003 · Lung recoil anchored to phenotype Ppl0; FRC is a phenotype parameter (2026-09-10)

Spec §4.2 says FRC should be solved at initialization. Brief 2 §3 keeps FRC as a parameter (needed for
strain), and Table 1 gives end-expiratory Pes per phenotype. We keep FRC as the phenotype's relaxation
volume, define compartment volume `V_i` relative to its share of FRC, and anchor the lung recoil so that
`PL_i(0) = −Ppl0_i` (static equilibrium at zero PEEP with no effort). What is solved at initialization is
the static equilibrium at the *set PEEP*, so the change in EELV with PEEP, Ppl at PEEP and PL at PEEP all
emerge from the model. The Venegas curve supplies the nonlinear shape around that anchor.

## D-004 · Normal-preset FRC 1.6 L rather than Table 1's 1.69 L (2026-09-10)

Spec §9.2 requires specific lung elastance (ΔPL/strain, strain = Vt/FRC) of about 13.5 ± 2 across presets
(Chiumello 2008). With Pelosi's EL 9.4 and FRC 1.69 the linear product is 15.9, just outside the band;
1.6 L gives 15.0. The value is tagged [M] in `presets.ts`. ARDS FRCs (0.7 pulmonary, 1.0 extrapulmonary)
are chosen inside Table 1's 0.7–1.3 range for the same reason.

## D-005 · Venegas parameters solved from the phenotype anchor (2026-09-10)

Brief 2 §2.1 gives illustrative Venegas parameters tagged [M] and says to tune b and d so the slope at the
operating point matches Table 1 EL. Rather than hand-tune, each preset fixes the lower asymptote a (L below
FRC) and span b (L) and the code solves d and c so that the elastance at FRC equals EL and the curve
passes through (V = 0, PL0). The Venegas shape then determines how Ers changes with PEEP, which is what
the Gattinoni 1998 direction test checks. The recruitable-population lung (M7) replaces this for
recruitment-specific behaviour.

## D-006 · Ventilator valve limits and cycling details (2026-09-10)

- **Pressure-safety cycling applies to spontaneous pressure-targeted breaths (PSV/CPAP).** Spec §5 lists
  "Paw above target + 3" among the cycle criteria. In PC-AC the breath stays time-cycled and the
  high-pressure alarm is the safety, which matches how active-exhalation-valve ventilators behave.
- **Inspiratory valve cannot take flow back (qMin = 0 during inspiration).** With a pure Thevenin source an
  ideal integral servo would "inhale" against an expiratory push and Paw could never rise above target,
  so pressure cycling could never occur. Real valves close; the pressure BC therefore degenerates to a
  flow source at 0 when the patient pushes.
- **Expiratory source flow capped at the bias flow.** During expiration the inspiratory valve supplies at
  most the bias flow (Brief 1 §2.1). A larger patient demand pulls Paw down, which is the mechanism of
  pressure triggering; without the cap the PEEP servo would supply any demand and the pressure trigger
  would never see a dip.
- **Blower peak flow 3 L/s [M].** Bounds the servo under large leaks and disconnects (`MAX_SERVO_FLOW`).
- **ETS confirmation window 30 ms [M].** The flow-cycle criterion is validated over a few device samples
  so that an abrupt expiratory push can pressure-cycle first (`ETS_CONFIRM_TIME`).
- **Disconnect alarm is not phase-limited.** A disconnected circuit auto-triggers through the leak, so
  expiration can be shorter than the sustain window; Paw < PEEP − 3 for 0.5 s in any phase raises it.
- **Ventilator vti/vte** are integrated from the measured flow at the physics rate by phase (device
  internal rate); the Monitor integrates positive and negative flow over the cycle so the sensor delay
  does not clip the last milliseconds of inspiration.

## D-007 · Effort model and occlusion measurements (2026-09-10)

- **Force–velocity penalty on |Q|.** `Pmus_eff = Pmus_iso·(1 − kFv·sat(|Q|/qRef))` with qRef = 0.15 L/s,
  so any flowing breath is penalized and only a true occlusion (Q = 0) is isometric. A first version
  penalized inspiratory flow only; after flow cycling the effort then became isometric while still near
  its peak and k1 came out at −0.85. A length–tension variant fixed that but made P0.1 depend on how much
  gas was trapped when the valve closed, so it was dropped. Hyperinflation-related weakness is therefore
  not modelled (listed in the limitations).
- **kFv calibrated to the measured ratio.** Spec §4.4 says to calibrate k_fv so simulated ΔPocc gives
  Bertoni's k1. The *measured* ΔPocc slightly under-reads Pmus_iso because Paw is still equilibrating
  toward alveolar pressure after the valve closes (viscoelastic recovery, residual flow), exactly as at the
  bedside, so kFv = 0.30 (spec range 0.25–0.3) gives k1 = −0.74 on the PSV grid (normal, both ARDS
  presets, obesity, Pmax 6–25) and k2 = 0.62–0.64.
- **Calibration grid excludes COPD.** With intrinsic PEEP the post-occlusion Paw rise is long and the
  occlusion catches efforts mid-way; ΔPocc under-reads there, a documented pitfall, so obstructive lungs
  are not used to set kFv.
- **Occlusion references are the pre-effort plateau,** read on a 0.3 s moving average for whole-effort
  maneuvers (ΔPocc, occlusion test) so the cardiac artifact on Pes does not inflate the swing, and on a
  0.1 s average for P0.1 with a 0.5 cmH2O onset threshold above sensor noise, back-extrapolated along the
  slope. Whole-effort occlusions start only once expiratory flow has settled below 0.04 L/s; P0.1 falls
  back to the vendor method (occlude for 100 ms from trigger detection, reads a little low) when an
  effort arrives first.
- **Pes height 0.7 of the vertical lung height** (Brief 2: mid-to-dependent), and the balloon occlusion
  test is validated on the normal preset; in injured lungs with α_D = 1.35 a well-placed balloon reads a
  ratio above 1 by design, which is a teaching point rather than a failure.

## D-008 · Hosting on Netlify instead of GitHub Pages (2026-09-11)

The goal prompt targets GitHub Pages. The account's user site (`nahata5.github.io`) still carries
`tomnahass.com` as its Pages custom domain, so GitHub redirects every project site of the account to that
domain, and the domain's DNS points at Netlify. Rather than touch the personal site's Pages configuration,
VentSim deploys to Netlify from `netlify.toml` (`npm run build`, publish `dist`, Node 22) and the personal
site proxies `/vent-sim/*` to it. GitHub Actions stays as the CI gate (lint, tests, Playwright, build) with
the Pages steps removed. Vite's relative `base: './'` makes both URLs work without a rebuild. The spec's
principle 6 allows Netlify explicitly.

## D-009 · Expiratory hold in a breathing patient reads the pre-effort plateau and releases early (2026-09-11)

Spec §5 describes an expiratory hold of 2–4 s reporting total PEEP. With a spontaneously breathing
patient a fixed 3 s occlusion almost always contains an effort, and a device that reads Paw at the end of
the hold would report the effort's negative deflection as "total PEEP" (the first session test read −0.9
with PEEP 6). Real ventilators track the relaxed plateau and abort the maneuver when the patient pulls.
The ventilator now tracks Paw during the hold on a 0.1 s moving average, reports the running maximum as
total PEEP when an effort drops the smoothed Paw more than `POCC_MIN_DIP` (1 cmH2O) below it, ends the
hold at that moment with `values.interrupted = 1`, and triggers the held breath as patient-triggered. In a
passive patient nothing changes: Paw rises monotonically toward alveolar pressure, so the end-of-hold value
is the plateau. Tested in `tests/unit/ventilator.test.ts` ("expiratory hold in a breathing patient").

## D-010 · Sweep display, ranges and M5 scope choices (2026-09-11)

- **Worker timing.** The worker ticks every 20 ms, advances the engine by wall-clock × speed capped at
  0.25 s per tick (a backgrounded tab does not spiral on wake), and sends one transferable channel-major
  Float32Array per tick. Determinism is a property of `SimSession` (`tests/unit/session.test.ts`): same
  seed and same commands at the same simulated times give byte-identical batches for any chunking.
- **Scroll back = freeze + sweep re-rendered at an earlier cursor time.** The display keeps the sweep
  semantics (cursor overwriting the previous sweep) at any `tView` inside the 120 s ring buffer, so the
  learner sees exactly what the screen showed at that moment; the cursor readout maps the mouse column to
  time through the same function.
- **Auto-ranging per row** expands immediately and shrinks after ~2 s of slack, with a minimum span per
  channel (Paw 20, flow 60 L/min, volume 500 mL) so a flat trace never zooms into sensor noise.
- **Breath badges show trigger · cycle cause** (e.g. `P·flow`, `T·vol`) until the M6 labeler and detector
  replace them with pattern labels.
- **Dashboard rows for PMI, stress index and R/I are present but empty** until M7 supplies the maneuvers.
  Truth-only rows show "truth layer off" when the toggle is off so the bedside ↔ truth distinction stays
  visible in the numbers, not only in the traces.
- **Scenarios are JSON now** (`src/edu/scenarios/*.json`, resolved by `resolveScenario`) so M8's library,
  instructor export and import build on the same shape. The three M5 dyssynchrony scenarios reuse the
  M4 emergence-test parameters and are re-checked as scenarios in `tests/unit/scenarios.test.ts`.
- **Mechanical power surrogate.** VC uses Gattinoni simplified when a plateau exists, Giosa 2019 when it
  does not; PC/PSV use Becher simplified (Brief 2 §3). The truth value ∫Paw·dV and the lung power ∫PL·dV
  are shown next to it when the truth layer is on.
