import { useEffect, useMemo, useState } from 'preact/hooks';
import snapshotJson from '../validation/snapshot.json';
import type { EmergenceRow, PatternScoreSummary } from '../detector/validation';
import { CORE_PATTERNS } from '../detector/scorer';
import { PATTERN_CODES } from './waveform-draw';
import type { ValidationMessage } from '../worker/validation.worker';

interface Snapshot {
  generatedAt: string;
  commit: string;
  emergence: EmergenceRow[];
  heldOut: PatternScoreSummary[];
  tuning: PatternScoreSummary[];
  targets: Record<string, { sens: number; spec: number }>;
  gridSizes: { tuning: number; heldOut: number };
  suites: Array<{ file: string; what: string }>;
}

const SNAPSHOT = snapshotJson as Snapshot;

const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)} %` : '—');
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');

function Confusion({ s, target }: { s: PatternScoreSummary; target?: { sens: number; spec: number } | undefined }) {
  const name = PATTERN_CODES[s.pattern]?.name ?? s.pattern;
  const okSens = target ? s.sensitivity >= target.sens : true;
  const okSpec = target ? s.specificity >= target.spec : true;
  return (
    <div class={`confusion ${okSens && okSpec ? 'pass' : 'fail'}`} data-testid={`confusion-${s.pattern}`}>
      <h3>
        {name} <span class="muted small">{s.pattern}</span>
      </h3>
      <table class="confusion-table">
        <thead>
          <tr>
            <th></th>
            <th>truth +</th>
            <th>truth −</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>detector +</th>
            <td class="tp">{s.tp}</td>
            <td class="fp">{s.fp}</td>
          </tr>
          <tr>
            <th>detector −</th>
            <td class="fn">{s.fn}</td>
            <td class="tn">{s.tn}</td>
          </tr>
        </tbody>
      </table>
      <div class="small">
        <span class={okSens ? 'ok' : 'bad'}>sensitivity {pct(s.sensitivity)}</span>
        {target ? <span class="muted"> (≥ {pct(target.sens)})</span> : null} ·{' '}
        <span class={okSpec ? 'ok' : 'bad'}>specificity {pct(s.specificity)}</span>
        {target ? <span class="muted"> (≥ {pct(target.spec)})</span> : null}
      </div>
    </div>
  );
}

/** In-app validation (goal "definition of done" 2): analytic suites, emergence matrix, confusion matrices. */
export function ValidationPage() {
  const [emergence, setEmergence] = useState<EmergenceRow[]>(SNAPSHOT.emergence);
  const [heldOut, setHeldOut] = useState<PatternScoreSummary[]>(SNAPSHOT.heldOut);
  const [source, setSource] = useState<string>(`snapshot ${SNAPSHOT.generatedAt.slice(0, 16).replace('T', ' ')} · commit ${SNAPSHOT.commit}`);
  const [progress, setProgress] = useState<string | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  useEffect(() => () => worker?.terminate(), [worker]);

  const recompute = () => {
    if (worker) return;
    const w = new Worker(new URL('../worker/validation.worker.ts', import.meta.url), { type: 'module', name: 'ventsim-validation' });
    const rows: EmergenceRow[] = [];
    w.onmessage = (ev: MessageEvent<ValidationMessage>) => {
      const m = ev.data;
      if (m.type === 'emergence') {
        rows.push(m.row);
        setEmergence([...rows]);
        setProgress(`emergence ${m.done}/${m.total}`);
      } else if (m.type === 'case') {
        setProgress(`held-out case ${m.done}/${m.total} (${m.id})`);
      } else if (m.type === 'scores') {
        setHeldOut(m.heldOut);
      } else if (m.type === 'finished') {
        setProgress(null);
        setSource(`recomputed in this browser in ${(m.ms / 1000).toFixed(0)} s`);
        w.terminate();
        setWorker(null);
      }
    };
    w.postMessage({ type: 'run' });
    setWorker(w);
    setProgress('starting…');
  };

  const core = useMemo(() => CORE_PATTERNS.map((p) => heldOut.find((s) => s.pattern === p)).filter((s): s is PatternScoreSummary => !!s), [heldOut]);
  const other = useMemo(() => heldOut.filter((s) => !CORE_PATTERNS.includes(s.pattern)), [heldOut]);

  return (
    <div class="validation" data-testid="validation-page">
      <p class="muted small">
        {source} · <a href="#">back to the simulator</a>
      </p>
      <section class="panel">
        <h2>Physics and calibration suites (Spec §9.1–9.3)</h2>
        <p class="small muted">Run by Vitest in CI on every push; names and scope listed here, results in the CI log.</p>
        <ul class="small">
          {SNAPSHOT.suites.map((s) => (
            <li key={s.file}>
              <code>{s.file}</code> — {s.what}
            </li>
          ))}
        </ul>
      </section>
      <section class="panel">
        <h2>
          Emergence matrix (Spec §9.4) <span class="muted small">truth labels; fix applied at 60 s; AI over 75–130 s</span>
        </h2>
        <div class="table-wrap">
          <table class="validation-table">
            <thead>
              <tr>
                <th>scenario</th>
                <th>target patterns (fraction ≥ required)</th>
                <th>AI before</th>
                <th>AI after fix (limit)</th>
                <th>result</th>
              </tr>
            </thead>
            <tbody>
              {emergence.map((r) => (
                <tr key={r.id} class={r.pass ? 'pass' : 'fail'} data-testid="emergence-row">
                  <td>{r.id}</td>
                  <td>
                    {r.targets.map((t) => (
                      <span key={t.pattern} class={`target ${t.fraction >= t.required ? 'ok' : 'bad'}`}>
                        {PATTERN_CODES[t.pattern]?.code ?? t.pattern} {pct(t.fraction)} ≥ {pct(t.required)}
                      </span>
                    ))}
                  </td>
                  <td>{f1(r.aiBefore)} %</td>
                  <td>
                    {f1(r.aiAfter)} % ({r.aiLimit} %)
                  </td>
                  <td>{r.pass ? 'pass' : 'FAIL'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <h2>
          Detector on the held-out grid (Spec §9.5) <span class="muted small">{SNAPSHOT.gridSizes.heldOut} cases, seeds ≥ 100, settings and drive perturbed; thresholds tuned on {SNAPSHOT.gridSizes.tuning} disjoint cases</span>
        </h2>
        <p class="small muted">
          Per-breath confusion matrices against the truth labels. Targets: sensitivity ≥ 85 % and specificity ≥ 90 % (reverse trigger ≥ 75 % / 90 %). Delayed cycling's accepted floor is
          80 % (docs/DECISIONS.md D-012).
        </p>
        <div class="confusion-grid">
          {core.map((s) => (
            <Confusion key={s.pattern} s={s} target={SNAPSHOT.targets[s.pattern]} />
          ))}
        </div>
        <details class="small">
          <summary>Non-core patterns (reported, no §9.5 target)</summary>
          <div class="confusion-grid">
            {other.map((s) => (
              <Confusion key={s.pattern} s={s} />
            ))}
          </div>
        </details>
        <p>
          <button type="button" onClick={recompute} disabled={worker !== null} data-testid="recompute">
            Recompute in this browser
          </button>
          {progress ? <span class="muted small"> {progress}</span> : null}
        </p>
      </section>
    </div>
  );
}
