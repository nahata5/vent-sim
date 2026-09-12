import type { Debrief, FixMark, IdMark } from '../edu/debrief';
import type { FixCheck } from '../edu/quiz';

interface Props {
  d: Debrief;
  checks: FixCheck[];
}

const ID_MARK: Record<IdMark, string> = { found: 'you found it', missed: 'you missed it', extra: 'your pick, not present' };
const FIX_MARK: Record<FixMark, string> = { matched: 'matched', partial: 'partial (right direction)', 'not-done': 'not done', opposite: 'opposite direction' };

/** Debrief (design 2026-09-11 §5, D-019): four templated sections shown when a quiz is evaluated. */
export function DebriefPanel({ d, checks }: Props) {
  return (
    <div class="debrief" data-testid="debrief-panel">
      <section data-testid="debrief-changes">
        <h3>What you changed</h3>
        <ol>
          {d.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
      </section>
      <section data-testid="debrief-happening">
        <h3>What was happening</h3>
        {d.happening.length === 0 && <p class="muted">No dyssynchrony pattern was present in the window.</p>}
        <ul>
          {d.happening.map((h) => (
            <li key={h.id} class={`mark-${h.mark}`} data-testid={`debrief-pattern-${h.id}`}>
              <b>{h.title}</b> <span class="muted mark">· {ID_MARK[h.mark]}</span>
              {h.evidence.length > 0 && <div class="small evidence-case">{h.evidence.join(' ')}</div>}
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="debrief-fix">
        <h3>The recommended fix</h3>
        {d.fix.note ? <p data-testid="debrief-fix-note">{d.fix.note}</p> : <p class="muted">This scenario has no scripted fix.</p>}
        {d.fix.keys.length > 0 && (
          <div class="table-wrap">
          <table class="debrief-keys">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Recommended</th>
                <th>You</th>
                <th>Mark</th>
              </tr>
            </thead>
            <tbody>
              {d.fix.keys.map((x) => (
                <tr key={x.key} class={`mark-${x.mark}`} data-testid={`debrief-key-${x.key}`}>
                  <td>{x.label}</td>
                  <td>{x.recommended}</td>
                  <td>{x.learner}</td>
                  <td class="mark">{FIX_MARK[x.mark]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <p>
          Outcome: AI {d.fix.aiBefore === null ? '—' : `${d.fix.aiBefore.toFixed(0)} %`} before → {d.fix.aiAfter === null ? '—' : `${d.fix.aiAfter.toFixed(0)} %`} after · fix{' '}
          {d.fix.pass ? 'passed' : 'failed'}
          {d.fix.failed.length ? ` · failed: ${d.fix.failed.join('; ')}` : ''}
        </p>
        <ul>
          {checks.map((c) => (
            <li key={c.id} class={c.ok ? '' : 'fail'}>
              {c.ok ? '✓' : '✗'} {c.label}
              {c.value !== null ? `: ${typeof c.value === 'number' ? c.value.toFixed(1) : c.value}` : ''}
              {!c.verified ? ' (not verified: take an inspiratory hold)' : ''}
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="debrief-physiology">
        <h3>Physiology and recognition</h3>
        {d.physiology.map((c) => (
          <article class="card" key={c.id}>
            <h4>{c.title}</h4>
            <p>
              <b>Why it happens.</b> {c.mechanism}
            </p>
            <p>
              <b>Signature.</b> {c.signature}
            </p>
            <div class="two-col">
              <div>
                <b>Causes</b>
                <ul>
                  {c.causes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <b>Pitfalls</b>
                <ul>
                  {c.pitfalls.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
            <b>Fixes, in order</b>
            <ol>
              {c.fixes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </article>
        ))}
      </section>
    </div>
  );
}
