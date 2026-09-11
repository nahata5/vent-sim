# Mobile-responsive layout — design (2026-09-11)

Owner request (HANDOFF "What is left" 5). The three layout choices below were put to the owner as options
with mockups on 2026-09-11 and the recommended option was taken each time. No physics, detector, scenario
or education-logic change; the desktop layout (≥ 1100 px) is unchanged and the 31 desktop Playwright tests
stay as they are.

## 1. Goals and non-goals

**Goals.** A learner on a phone can watch the waveforms, change a setting and confirm it, take a quiz and
read the debrief, without horizontal scrolling and with touch-sized controls. An instructor on a tablet
gets two columns with the same panel grouping as the desktop. The canvases follow their container's size.

**Non-goals.** No light theme, no i18n, no gesture navigation, no separate mobile build, no changes to what
a panel shows. The truth layer works on a phone but is not optimised for it (eight rows in 55 % of a phone
screen are small; that is accepted).

## 2. Breakpoints

| Name | Width | Layout |
|---|---|---|
| phone | < 700 px | single column, waveforms pinned, bottom tab bar (§3) |
| tablet | 700–1099 px | waveforms and drawer full width, panels in two columns below (§4) |
| desktop | ≥ 1100 px | unchanged three-column grid |

The phone threshold lives in one TypeScript constant (`PHONE_MAX_WIDTH` = 699 in `src/ui/breakpoints.ts`)
used by the `usePhoneLayout()` hook, and in the CSS media query `(max-width: 699px)`; a unit test reads
`theme.css` and fails if the two drift. Tablet is `(min-width: 700px) and (max-width: 1099px)`, CSS only.
The existing `@media (max-width: 1100px)` rule is replaced by the tablet rule.

## 3. Phone layout (owner choice: waveforms pinned + bottom tab bar)

Top to bottom, the page never scrolls as a whole (`.app-shell` is `100dvh`, `100vh` fallback):

1. **Header, one row**: "VentSim" and the scenario picker (the select takes the remaining width). The
   version tag, the truth toggle, the balloon toggle and the Validation link are not in the header on a
   phone.
2. **Alarm bar** as today (chips wrap).
3. **Waveform screen**, full width, fixed height `min(55vh, rows × 68 px + 22 px)` where `rows` is the
   number of drawn rows (3 bedside, 4 with the balloon, 8 with the truth layer). It never scrolls away.
4. **Time controls**, one wrapping row, compact.
5. **One panel** chosen by the tab bar, filling the remaining height and scrolling on its own:
   - **Vent**: truth-layer toggle and balloon toggle (moved here from the header), Settings (Confirm/Cancel
     row sticks to the bottom of the scrolling panel), Injectors, Instructor (unless locked).
   - **Monitor**: Monitor tiles and maneuver buttons, Lung-stress dashboard, CO2 panel (on the phone the
     CO2 panel moves from the left column to the monitor column).
   - **Loops**: the loop canvases in a 2-column grid (2 bedside loops, 4 with the truth layer).
   - **Learn**: the drawer pane with its existing sub-tabs Scenario · Explain · Quiz · Export; the
     Validation link is appended to the Export panel here.
6. **Tab bar**, four buttons, 48 px tall, `role="tablist"`, `data-testid="mtab-vent|monitor|loops|learn"`.
   Default tab: Vent.
7. **Footer** disclaimer, 10 px, wrapping.

**Tab switching.** All four panels stay mounted; inactive ones are `display: none` (component state such as
the settings draft and the instructor's open state survives a tab change; a hidden loop canvas has zero
size and its draw loop already skips it). When the controller changes the drawer tab on its own (a badge
tap opens the Explain card, starting a quiz opens Quiz), the phone switches to Learn so the learner sees
the result.

**Touch.** Under the phone query and under `(pointer: coarse)`: buttons, selects and inputs are at least
40 px tall, inputs use 16 px text (prevents the iOS focus zoom), the settings inputs are 120 px wide, quiz
picks are one checkbox per row. The badge strip on the canvas is 18 px; on a coarse pointer a tap within
the top 32 px of the screen counts as a badge tap (`BADGE_TAP_HEIGHT`, WaveformCanvas only, no change to
the drawn geometry). The cursor readout appears at a tap and stays until the next tap (there is no
mouseleave on touch); accepted.

**Readable content.** Explain and debrief two-column blocks become one column; the debrief keys table and
the PEEP-trial table scroll horizontally inside a `.table-wrap` container; Monitor tiles keep three
columns (≈ 110 px each at 360 px).

## 4. Tablet layout (owner choice: waveforms + drawer full width, panels in two columns below)

Grid, two equal columns, the page scrolls vertically (`.app-main` is `overflow-y: auto`; the columns no
longer scroll independently):

| Row | Content |
|---|---|
| 1 | time controls, full width |
| 2 | waveform screen, full width, height `min(50vh, rows × 80 px + 22 px)`, at least 300 px |
| 3 | drawer: loops (left) and the tabbed drawer pane (right), 260 px tall |
| 4 | left: Settings, Injectors, CO2, Instructor · right: Monitor, Dashboard |

Header unchanged from the desktop (it already wraps). No tab bar.

## 5. How the DOM stays the same

The desktop DOM is not restructured. On the phone and tablet the CSS turns `.col-center` and `.drawer`
into `display: contents`, so the time controls, the waveform wrap, the loops and the drawer pane become
direct children of `.app-main` and can be placed with `order` (phone flex column) or `grid-row`/
`grid-column` (tablet grid). The only JS layout state is a `phone` boolean from `usePhoneLayout()`
(`matchMedia`) that App uses to:

- render the truth and balloon toggles and the Validation link in the Vent tab / Export panel instead of
  the header (each control is rendered exactly once, so the `data-testid`s stay unique);
- render the CO2 panel in the right column instead of the left;
- render the tab bar and put `data-mtab="<tab>"` on `.app-main`, which the phone CSS uses to hide the
  three inactive panels.

`WaveformCanvas` sets `--wave-rows` on its wrap so the phone/tablet height rule can follow the row count.
Both canvases already re-measure their container every frame (`clientWidth`/`clientHeight` with the
device-pixel ratio capped at 2), so a viewport or tab change resizes them without a `ResizeObserver`; the
mobile test asserts it.

## 6. Files

- `src/ui/breakpoints.ts` (new): `PHONE_MAX_WIDTH`, `PHONE_QUERY`, `BADGE_TAP_HEIGHT`, `usePhoneLayout()`.
- `src/ui/theme.css`: phone and tablet blocks replacing the 1100 px rule; touch sizes; `100dvh`.
- `src/app/App.tsx`: `phone` flag, tab bar (`MobileTabBar` inline), relocated toggles/link/CO2 panel,
  drawer-tab → Learn effect.
- `src/ui/WaveformCanvas.tsx`: `--wave-rows`, coarse-pointer badge tap height.
- `src/ui/ExportPanel.tsx`: optional `validationLink` slot; `src/ui/DebriefPanel.tsx`,
  `src/ui/LungStressDashboard.tsx`: `.table-wrap` around the tables.
- `playwright.config.ts`: projects `chromium` (unchanged, ignores `mobile.spec.ts`), `mobile`
  (`devices['Pixel 7']`, 412 × 839, touch) and `tablet` (`devices['Nexus 10']`, 800 × 1280, Chromium),
  both matching only `tests/e2e/mobile.spec.ts`.
- `tests/e2e/mobile.spec.ts` (new), `tests/unit/breakpoints.test.ts` (new),
  `tests/e2e/screenshots.spec.ts` (+ phone and tablet screenshots via `test.use(devices[...])`).
- Docs: `docs/DECISIONS.md` D-020, `PROGRESS.md`, `README.md` note, `docs/HANDOFF.md`, screenshots.

## 7. Tests (written first)

**Unit** (`tests/unit/breakpoints.test.ts`): the CSS phone query in `theme.css` matches `PHONE_MAX_WIDTH`;
`usePhoneLayout` is not unit-tested (needs a DOM), the e2e covers it.

**Playwright `mobile` project** (`tests/e2e/mobile.spec.ts`, Pixel 7):

1. *Phone smoke*: load `#ineffective-effort`; `documentElement.scrollWidth ≤ innerWidth`; the waveform
   canvas is visible, spans the viewport width (within 20 px) and its backing store equals
   `round(clientWidth × min(dpr, 2))`; the tab bar is visible with Vent active; the truth toggle is in the
   Vent panel, not the header; the settings Confirm button is in the viewport after filling PEEP, and the
   setting applies; Monitor tab shows the tiles; Loops tab shows loop canvases with non-zero size;
   Learn tab shows the drawer sub-tabs; no horizontal overflow after each tab.
2. *Phone quiz to debrief*: Learn → Quiz → start (after 25 s) → pick → submit → fix window → Vent →
   PS 6 / ETS 70 → Confirm → wait 61 s → Learn → Evaluate → debrief panel visible, the debrief content
   does not overflow its pane horizontally, the page has no horizontal overflow.
3. *Resize follows the container*: set the viewport to 360 × 740, the canvas backing width follows.

**Playwright `tablet` project** (same file, Nexus 10): no horizontal overflow; no tab bar; the waveform
wrap spans the full width; the settings panel and the monitor panel are side by side (monitor's left edge
is right of the settings panel's right edge, tops within 40 px); the drawer pane and the loops are visible
together.

**Desktop**: the existing 31 tests unchanged; the screenshot spec gains phone and tablet captures
(`docs/screenshots/mobile-phone-*.png`, `mobile-tablet.png`) behind `SCREENSHOTS=1`.

## 8. Open points and accepted limitations

- Landscape phones (≈ 840 × 400) fall into the tablet rule and will be cramped; not a target.
- No swipe between tabs; no persistence of the chosen tab.
- The Instructor panel's JSON editor on a phone is usable but small; the instructor's device is the tablet.
