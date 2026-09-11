import { useState } from 'preact/hooks';
import type { SessionController } from '../app/controller';
import { PATTERN_IDS, type PatternId } from '../sim/truth/labeler';
import { CARDS } from '../edu/cards';
import { k } from '../config/constants';
import { DebriefPanel } from './DebriefPanel';

interface Props {
  ctl: SessionController;
}

/** Patterns a learner can pick (the truth-only findings are listed last). */
const PICKABLE: PatternId[] = [...PATTERN_IDS];

/** Quiz (Spec §8): identify the patterns with the badges hidden, then fix them within the safety limits. */
export function QuizPanel({ ctl }: Props) {
  const q = ctl.quiz;
  const [picks, setPicks] = useState<Set<PatternId>>(new Set());
  const t = ctl.store.tLatest;
  const toggle = (p: PatternId) => {
    const next = new Set(picks);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setPicks(next);
  };
  const progress = ctl.scenario ? ctl.progress.get(ctl.scenario.id) : null;
  const lastDebrief = progress?.history.at(-1)?.debrief;
  return (
    <div class="quiz" data-testid="quiz-panel" data-phase={q.phase}>
      {q.phase === 'idle' && (
        <div class="small">
          <p>
            Labels hidden, you name the patterns of the last {k('QUIZ_FIX_WINDOW')} s, then you fix them: AI below {k('AI_SEVERE')} % over {k('QUIZ_FIX_WINDOW')} s with ΔP ≤ {k('DP_LIMIT')}, Pplat ≤ {k('PPLAT_LIMIT')}, Vt {k('VT_PBW_LOW')}–{k('VT_PBW_HIGH')} mL/kg and no new severe alarm.
          </p>
          {progress && !ctl.quizHides('scenario') && (
            <p class="muted" data-testid="quiz-progress">
              This scenario: {progress.attempts} attempt{progress.attempts === 1 ? '' : 's'}, best {progress.best}
              {progress.passed ? ', fixed at least once' : ''}.
              {lastDebrief ? ` Last attempt: ${lastDebrief.pass ? 'fixed' : 'not fixed'} — ${lastDebrief.changes.join('; ')}` : ''}
            </p>
          )}
          <button type="button" class="primary" onClick={() => ctl.startQuiz()} data-testid="quiz-start" disabled={t < 20}>
            {t < 20 ? 'Start quiz (wait for 20 s of breaths)' : 'Start quiz'}
          </button>
        </div>
      )}
      {q.phase === 'identify' && (
        <div class="small">
          <p>Which patterns are present in the last {k('QUIZ_FIX_WINDOW')} s? (badges hidden)</p>
          <div class="pick-grid">
            {PICKABLE.map((p) => (
              <label key={p} class="inline">
                <input type="checkbox" checked={picks.has(p)} onChange={() => toggle(p)} data-testid={`quiz-pick-${p}`} />
                <span>{CARDS[p].title}</span>
              </label>
            ))}
          </div>
          <button type="button" class="primary" onClick={() => ctl.submitQuizPicks([...picks])} data-testid="quiz-submit">
            Submit identification
          </button>
        </div>
      )}
      {q.phase === 'identified' && q.identification && (
        <div class="small" data-testid="quiz-identification">
          <p>
            Identification {(q.identification.score * 100).toFixed(0)} %: hits {q.identification.hits.map((p) => CARDS[p].title).join(', ') || 'none'}
            {q.identification.misses.length ? `; missed ${q.identification.misses.map((p) => CARDS[p].title).join(', ')}` : ''}
            {q.identification.falsePositives.length ? `; not present: ${q.identification.falsePositives.map((p) => CARDS[p].title).join(', ')}` : ''}.
          </p>
          <p class="muted">Badges are back. Now change the settings; the {k('QUIZ_FIX_WINDOW')} s window starts when you press the button.</p>
          <button type="button" class="primary" onClick={() => ctl.startQuizFix()} data-testid="quiz-fix">
            Start the fix window
          </button>
        </div>
      )}
      {q.phase === 'fix' && (
        <div class="small" data-testid="quiz-fixing">
          <p>
            Fix window: {Math.max(0, t - q.fixWindowStart).toFixed(0)} / {k('QUIZ_FIX_WINDOW')} s · confirmed setting changes this session {ctl.settingChanges} · live AI {ctl.quizFixInput().ai.toFixed(0)} %
          </p>
          <button type="button" class="primary" onClick={() => ctl.evaluateQuiz()} disabled={!q.fixWindowReady(t)} data-testid="quiz-evaluate">
            {q.fixWindowReady(t) ? 'Evaluate' : 'Evaluate (window not complete)'}
          </button>
        </div>
      )}
      {q.phase === 'done' && q.result && (
        <div class="small" data-testid="quiz-result" data-score={q.result.score} data-pass={q.result.fix.pass ? '1' : '0'}>
          <p>
            <b data-testid="quiz-score">Score {q.result.score}</b> · fix {q.result.fix.pass ? 'passed' : 'failed'} · {q.result.seconds.toFixed(0)} s · {q.result.changes} change{q.result.changes === 1 ? '' : 's'} · identification {((q.identification?.score ?? 0) * 100).toFixed(0)} %
          </p>
          {ctl.lastDebrief ? (
            <DebriefPanel d={ctl.lastDebrief} checks={q.result.fix.checks} />
          ) : (
            <ul>
              {q.result.fix.checks.map((c) => (
                <li key={c.id} class={c.ok ? '' : 'fail'}>
                  {c.ok ? '✓' : '✗'} {c.label}
                  {c.value !== null ? `: ${typeof c.value === 'number' ? c.value.toFixed(1) : c.value}` : ''}
                  {!c.verified ? ' (not verified: take an inspiratory hold)' : ''}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => ctl.endQuiz()} data-testid="quiz-end">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
