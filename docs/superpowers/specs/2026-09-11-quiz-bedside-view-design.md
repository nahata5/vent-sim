# Quiz "bedside view" and debrief — design (2026-09-11, owner-approved)

Owner request (verbatim intent): a quiz mode where the instructor sets what the learner can see, then a
mode that hides some of the source material for residents or fellows while they take the quiz. "It should
mimic what we can see at the bedside. They need to be able to make changes for a particular setting and then
have it graded whether it was effective or not, and then when they submit, an explanation should pop up
with what they changed and what the correct item to do was, what it was called, and then discuss the
physiology and recognition." Delivery: both instructor-panel checkboxes and a copyable quiz link.

Builds on the M8 quiz (`src/edu/quiz.ts`, `quiz-session.ts`, `src/ui/QuizPanel.tsx`, controller
`startQuiz → submitQuizPicks → startQuizFix → evaluateQuiz → endQuiz`, D-015) and the post-M9 quiz extras.
Nothing in `src/sim`, `src/detector` or the labeler changes.

## 1. Hide set

`QuizHideKey = 'truth' | 'pes' | 'scenario' | 'derived' | 'explain' | 'co2'`, kept as a `Set` in
`ctl.view.quizHide`. What each hides while a quiz is in the `identify` or `fix` phase (and while locked, §3):

| key | hidden | still visible |
|---|---|---|
| `truth` | truth layer rows, truth toggle (disabled), truth badges, truth-only readouts | measured waveforms |
| `pes` | the Pes row and the ΔPes/ΔPaw and SpO2-shunt-detail tiles that need the balloon | everything measured |
| `scenario` | title (shown as "Case"), summary, objectives, target patterns, the apply-fix button, the best-score line | scenario picker itself (learner can still switch cases only if not locked) |
| `derived` | `LungStressDashboard`, Validation link, the balloon-only monitor tiles | standard monitor tiles (Ppeak, Pplat, PEEP, PEEPi, ΔP, Cstat, Vt, RR, Ve, Ti, I:E, leak, RSBI, P0.1, ΔPocc), alarms, settings, loops |
| `explain` | Explain tab, badge click → explain card, badge hover evidence | — |
| `co2` | `Co2Panel` and the warp control | — |

Preset `bedside` = all six. Badges are already hidden during identification (M8); with `truth` hidden they
stay hidden through the fix phase too and reappear with the debrief.

Outside a quiz the hide set has no effect, so the instructor can preview the case normally.

## 2. Delivery

- **Instructor panel** section "Quiz view": six checkboxes, a "Bedside" preset button, and "Copy quiz link".
  Changes apply immediately to `ctl.view.quizHide`.
- **Quiz link**: `#<scenario-id>?quiz=<comma-separated keys | bedside>`; `src/edu/quiz-view.ts` exports
  `parseQuizHash(hash) → { scenarioId, hide: Set<QuizHideKey>, locked: boolean } | null` and
  `quizLink(scenarioId, hide) → string`. `App.tsx` reads it at load (where `#scenario-id` is read today),
  sets the hide set, marks the session **locked** and shows the quiz tab with a Start button (start is
  still gated on 20 s of simulation as today).

## 3. Locking

`ctl.view.quizLocked` (set only by a quiz link): the Instructor panel is not rendered, the truth toggle is
disabled, the scenario picker is disabled, the export tab hides truth exports. Unlocked on `evaluateQuiz`
(debrief shown, everything revealed) and on `endQuiz`. Locking is a classroom convenience, not security:
the URL is editable, and that is fine.

## 4. Grading (unchanged)

Identification: Jaccard against the truth patterns of the last 60 s. Fix: AI < 10 % over 60 s, ΔP ≤ 15,
Pplat ≤ 30, Vt 4–8 mL/kg, no new severe alarm, plus `quizExtras`. Score as D-015.

## 5. Debrief (new, on submit)

`src/edu/debrief.ts`: `buildDebrief(input) → Debrief` (pure, unit-tested), rendered by a new
`src/ui/DebriefPanel.tsx` inside `QuizPanel` in the `result` phase (replaces the one-line score).

Input, all already on the main thread or added by this work:
- `changes`: the learner's confirmed setting changes since `startQuizFix`, as `{ t, key, from, to }[]`.
  **New**: controller `settingsChangeLog` appended in `applySettings` (confirmed commits only) using the
  current `status.settings` for `from`; reset on scenario load. Injector changes made by the learner
  (instructor panel is hidden when locked, so normally none) are logged the same way.
- `truthPatterns`: `quizTruthPatterns()` at identification time (already stored in `QuizSession`), plus the
  learner's picks, hits and misses.
- `fixGrade` and `identification` from the `QuizSession` result.
- `scenario`: `ScenarioDef` (`fix.note`, `fix.settings`, `fix.injectors`, `targetPatterns`).
- `evidence`: the latest truth `BreathLabel` per pattern → `caseEvidence` / `effortEvidence`
  (`src/edu/cards/index.ts`).

Sections (in this order, each a heading with short paragraphs and lists):
1. **What you changed** — the change list in time order ("PS 16 → 6 at 84 s"), or "no setting changes".
2. **What was happening** — each truth pattern by its card title (`CARDS[p].title`), with the case evidence
   sentence, and the learner's identification marked (found / missed / extra pick).
3. **The recommended fix** — `fix.note`, then key by key: recommended value, learner's final value, and a
   mark: matched (same direction and within the band), partial (same direction), not done, or opposite. A
   line with the outcome: AI before vs after, and the failed checks if any.
4. **Physiology and recognition** — for each truth pattern, the card's mechanism, signature, causes and
   pitfalls (existing card text), and the ranked fixes. No LLM, no free text (D-015).

The debrief is stored with the attempt in the progress store (`ProgressStore`) as a compact summary
(changes, patterns, pass) so the instructor can review it later from the scenario picker; full card text
is not stored.

## 6. Tests first

- `tests/unit/quiz-view.test.ts`: `parseQuizHash` round-trips `quizLink`, accepts `bedside`, ignores
  unknown keys, returns `locked: true` only for `?quiz=`.
- `tests/unit/debrief.test.ts`: change list ordering and formatting; recommended-fix marks for matched,
  partial, not done, opposite; identification marks; missing evidence tolerated; pattern titles come from
  the cards.
- `tests/unit/session.test.ts` or a controller test: `settingsChangeLog` records confirmed commits with
  `from`/`to` and resets on scenario load.
- `tests/e2e/quiz-bedside.spec.ts`: open `/#ineffective-effort?quiz=bedside` → truth toggle disabled,
  no instructor panel, no Explain tab, no lung-stress dashboard, scenario title reads "Case"; start the quiz,
  submit picks, change PS and ETS via the settings panel, evaluate after 60 s → debrief lists the PS change,
  names "Ineffective effort", shows the fix note, and the truth toggle is enabled again.
- Existing `quiz.spec.ts` must keep passing (no hide set → unchanged behaviour).

## 7. Docs

README (quiz section: bedside view and links), D-019 in DECISIONS (what is hidden and why, locking is not
security, debrief is templated), PROGRESS entry, HANDOFF map. No constants change; no snapshot change.
