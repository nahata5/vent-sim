import type { SessionController } from '../app/controller';
import { PATTERN_CODES } from './waveform-draw';

interface Props {
  ctl: SessionController;
}

/** Explain card (Spec §8): the card for each pattern on the selected (or latest labelled) breath with case-specific evidence. */
export function ExplainCard({ ctl }: Props) {
  const index = ctl.selectedBreath ?? ctl.latestLabelledBreath();
  const ex = index !== null ? ctl.explanationFor(index) : null;
  return (
    <div class="explain" data-testid="explain-card">
      <div class="explain-head small">
        <span class="muted">{ex ? `Breath #${ex.index} at ${ex.tStart.toFixed(1)} s` : 'No labelled breath yet'}</span>
        <button type="button" class="link" onClick={() => ctl.selectBreath(null)} data-testid="explain-latest">
          latest labelled
        </button>
        <span class="muted">· click a badge above the waveforms to open its card</span>
      </div>
      {ex && ex.cards.length === 0 && ex.efforts.length === 0 && <p class="small muted">A synchronous breath: nothing to explain.</p>}
      {ex?.cards.map((c) => (
        <article class="card" key={c.card.id} data-testid={`card-${c.card.id}`}>
          <h3>
            <span class="badge" style={{ background: PATTERN_CODES[c.card.id]?.color ?? '#ccc' }}>{PATTERN_CODES[c.card.id]?.code ?? c.card.id}</span> {c.card.title}
          </h3>
          {c.evidence.length > 0 && (
            <p class="evidence-case" data-testid="card-evidence">
              <b>In this breath:</b> {c.evidence.join(' ')}
            </p>
          )}
          <p>
            <b>What it is.</b> {c.card.definition}
          </p>
          <p>
            <b>Why it happens.</b> {c.card.mechanism}
          </p>
          <p>
            <b>Signature.</b> {c.card.signature}
          </p>
          <div class="two-col">
            <div>
              <b>Fixes, in order</b>
              <ol>
                {c.card.fixes.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ol>
            </div>
            <div>
              <b>Pitfalls</b>
              <ul>
                {c.card.pitfalls.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
          <p class="muted small">Sources: {c.card.citations.join(' · ')}</p>
        </article>
      ))}
      {ex?.efforts.map((lines, i) => (
        <article class="card" key={`ie-${i}`} data-testid="card-ineffective-effort">
          <h3>
            <span class="badge" style={{ background: PATTERN_CODES['ineffective-effort']?.color }}>IE</span> Ineffective effort
          </h3>
          <p class="evidence-case">
            <b>In this breath:</b> {lines.join(' ')}
          </p>
        </article>
      ))}
    </div>
  );
}
