import { useState } from 'preact/hooks';
import type { SessionController } from '../app/controller';
import { CARDS } from '../edu/cards';
import type { PatternId } from '../sim/truth/labeler';
import { downloadBytes } from '../export/download';
import { QUIZ_HIDE_KEYS, QUIZ_HIDE_LABELS, bedsideHide, quizLink, type QuizHideKey } from '../edu/quiz-view';
import { parseScenarioText } from '../edu/scenario-schema';
import { AUTHORING_PROMPT, EXAMPLE_SCENARIO } from '../edu/authoring';
import type { ScenarioDef } from '../edu/scenarios';

interface Props {
  ctl: SessionController;
}

function num(v: string, fallback: number): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

const ATTEMPTS_SHOWN = 20;

/** Instructor mode (Spec §8): live patient controls and a scenario editor with JSON import/export. */
export function InstructorPanel({ ctl }: Props) {
  const [open, setOpen] = useState(false);
  const drive = ctl.scenario?.drive ?? null;
  const [rate, setRate] = useState(String(drive?.rate ?? 15));
  const [ti, setTi] = useState(String(drive?.ti ?? 1));
  const [pmax, setPmax] = useState(String(drive?.pmax ?? 8));
  const [entrain, setEntrain] = useState(drive?.entrainment ? String(drive.entrainment.ratio) : '0');
  const [rScale, setRScale] = useState('1');
  const [eScale, setEScale] = useState('1');
  const [el, setEl] = useState(String(ctl.patient?.el ?? 10));
  const [ecw, setEcw] = useState(String(ctl.patient?.ecw ?? 5));
  const [gainPmax, setGainPmax] = useState('0.06');
  const [vco2, setVco2] = useState('200');
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const custom = ctl.customScenarios.all();
  const validate = (): ScenarioDef | null => {
    const r = parseScenarioText(json);
    setErrors(r.errors);
    setWarnings(r.warnings);
    if (r.def) setMsg(`valid: "${r.def.title}"${r.warnings.length ? ` (${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''})` : ''}`);
    else setMsg(`invalid: ${r.errors.length} problem${r.errors.length > 1 ? 's' : ''}`);
    return r.def;
  };
  const co2 = ctl.status?.co2 ?? null;
  const currentJson = () => JSON.stringify(ctl.scenario ?? {}, null, 2);
  const link = quizLink(ctl.scenario?.id ?? '', ctl.view.quizHide, `${location.origin}${location.pathname}`);
  // Stored quiz attempts across scenarios, newest first (D-019 follow-up: the instructor's review of the debrief summaries).
  const attempts = Object.entries(ctl.progress.all())
    .flatMap(([id, p]) => p.history.map((a) => ({ id, ...a })))
    .sort((a, b) => b.at - a.at)
    .slice(0, ATTEMPTS_SHOWN);
  const titleOf = (id: string) => ctl.findScenario(id)?.title ?? id;
  return (
    <section class="panel instructor" aria-label="Instructor mode" data-testid="instructor-panel">
      <h2>
        <button type="button" class="link" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="instructor-toggle">
          {open ? '▾' : '▸'} Instructor
        </button>
      </h2>
      {open && (
        <div class="small instructor-body">
          <div class="row">
            <b>Drive</b>
            <label>
              rate <input type="number" value={rate} min={4} max={60} onInput={(e) => setRate(e.currentTarget.value)} data-testid="instr-rate" />
            </label>
            <label>
              Ti <input type="number" step="0.1" value={ti} min={0.4} max={2.5} onInput={(e) => setTi(e.currentTarget.value)} />
            </label>
            <label>
              Pmax <input type="number" value={pmax} min={0} max={40} onInput={(e) => setPmax(e.currentTarget.value)} data-testid="instr-pmax" />
            </label>
            <label>
              entrain
              <select value={entrain} onChange={(e) => setEntrain(e.currentTarget.value)}>
                <option value="0">off</option>
                <option value="1">1:1</option>
                <option value="2">1:2</option>
                <option value="3">1:3</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                const ratio = Number(entrain) as 0 | 1 | 2 | 3;
                ctl.setDrive({ rate: num(rate, 15), ti: num(ti, 1), pmax: num(pmax, 8), entrainment: ratio === 0 ? null : { ratio, delay: 0.4, jitter: 0.03 } });
                setMsg('drive applied');
              }}
              data-testid="instr-apply-drive"
              disabled={!ctl.patient?.hasDrive}
              title={ctl.patient?.hasDrive ? 'Apply to the running patient' : 'This scenario is passive (no neural drive)'}
            >
              apply
            </button>
          </div>
          <div class="row">
            <b>Mechanics</b>
            <label>
              R × <input type="number" step="0.1" min={0.2} max={5} value={rScale} onInput={(e) => setRScale(e.currentTarget.value)} data-testid="instr-rscale" />
            </label>
            <label>
              EL × <input type="number" step="0.1" min={0.2} max={5} value={eScale} onInput={(e) => setEScale(e.currentTarget.value)} />
            </label>
            <button type="button" onClick={() => ctl.setPatientScale({ rScale: num(rScale, 1), eScale: num(eScale, 1) })} data-testid="instr-apply-mech">
              apply
            </button>
          </div>
          <div class="row">
            <b>Elastance</b>
            <label>
              EL cmH2O/L <input type="number" step="1" min={1} max={80} value={el} onInput={(e) => setEl(e.currentTarget.value)} data-testid="instr-el" />
            </label>
            <label>
              Ecw cmH2O/L <input type="number" step="1" min={0} max={40} value={ecw} onInput={(e) => setEcw(e.currentTarget.value)} data-testid="instr-ecw" />
            </label>
            <button
              type="button"
              onClick={() => {
                ctl.setMechanics({ el: num(el, ctl.patient?.el ?? 10), ecw: num(ecw, ctl.patient?.ecw ?? 5) });
                setMsg('elastance applied live (patient rebuilt at its current volume)');
              }}
              data-testid="instr-apply-el"
              title="Live: the lung is rebuilt at its current volume; a recruitable lung keeps its open set"
            >
              apply
            </button>
            <span class="muted small">
              now EL {ctl.patient?.el.toFixed(1) ?? '—'} · Ecw {ctl.patient?.ecw.toFixed(1) ?? '—'}
            </span>
          </div>
          {co2 && (
            <div class="row">
              <b>CO2 loop</b>
              <label>
                Pmax gain /mmHg <input type="number" step="0.01" min={0} max={0.3} value={gainPmax} onInput={(e) => setGainPmax(e.currentTarget.value)} />
              </label>
              <label>
                VCO2 mL/min <input type="number" min={100} max={400} value={vco2} onInput={(e) => setVco2(e.currentTarget.value)} />
              </label>
              <button type="button" onClick={() => ctl.setGas({ gainPmax: num(gainPmax, 0.06), vco2: num(vco2, 200) })}>
                apply
              </button>
            </div>
          )}
          <div class="row quizview" data-testid="quizview">
            <b>Quiz view</b>
            <span class="muted">Hidden from the learner while a quiz runs (or while a quiz link is locked):</span>
            {QUIZ_HIDE_KEYS.map((key) => (
              <label class="inline" key={key} title={QUIZ_HIDE_LABELS[key]}>
                <input
                  type="checkbox"
                  checked={ctl.view.quizHide.has(key)}
                  onChange={(e) => {
                    const next = new Set<QuizHideKey>(ctl.view.quizHide);
                    if (e.currentTarget.checked) next.add(key);
                    else next.delete(key);
                    ctl.setQuizHide(next);
                  }}
                  data-testid={`quizview-${key}`}
                />
                <span>{key}</span>
              </label>
            ))}
            <button type="button" onClick={() => ctl.setQuizHide(bedsideHide())} data-testid="quizview-bedside">
              Bedside
            </button>
            <button type="button" onClick={() => ctl.setQuizHide([])} data-testid="quizview-none">
              Show all
            </button>
            <input type="text" readOnly value={link} aria-label="Locked quiz link" data-testid="quizview-link" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              onClick={() => {
                const clip = navigator.clipboard;
                if (!clip) {
                  setMsg('copy blocked: select the link field and copy it');
                  return;
                }
                void clip
                  .writeText(link)
                  .then(() => setMsg('quiz link copied'))
                  .catch(() => setMsg('copy blocked: select the link field and copy it'));
              }}
              data-testid="quizview-copy"
            >
              Copy quiz link
            </button>
          </div>
          {attempts.length > 0 && (
            <div class="row attempts" data-testid="instr-attempts">
              <b>Quiz attempts</b>
              <span class="muted">stored in this browser, newest first</span>
              <div class="table-wrap">
                <table class="attempts-table">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>When</th>
                      <th>Score</th>
                      <th>Fix</th>
                      <th>Patterns</th>
                      <th>Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a) => (
                      <tr key={`${a.id}-${a.at}`} data-testid="instr-attempt">
                        <td>{titleOf(a.id)}</td>
                        <td>{new Date(a.at).toLocaleString()}</td>
                        <td>{a.score}</td>
                        <td>{a.fixPassed ? 'passed' : 'failed'}</td>
                        <td>{a.debrief ? a.debrief.patterns.map((p) => CARDS[p as PatternId]?.title ?? p).join(', ') || 'none' : '—'}</td>
                        <td>{a.debrief ? a.debrief.changes.join('; ') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div class="row editor">
            <b>Scenario editor</b>
            <span class="muted">
              Write your own: copy the authoring prompt into your LLM, answer its questions, paste the JSON here, validate, save.
              See docs/SCENARIO_AUTHORING.md.
            </span>
            <div>
              <button
                type="button"
                onClick={() => {
                  setShowPrompt(true);
                  const clip = navigator.clipboard;
                  if (!clip) {
                    setMsg('copy blocked: select the prompt field and copy it');
                    return;
                  }
                  void clip
                    .writeText(AUTHORING_PROMPT)
                    .then(() => setMsg('authoring prompt copied'))
                    .catch(() => setMsg('copy blocked: select the prompt field and copy it'));
                }}
                data-testid="author-copy-prompt"
              >
                Copy authoring prompt
              </button>
              <button type="button" onClick={() => { setJson(JSON.stringify(EXAMPLE_SCENARIO, null, 2)); setErrors([]); setWarnings([]); setMsg('example loaded; edit it or validate as is'); }} data-testid="author-load-example">
                Load example
              </button>
              <button type="button" onClick={() => setJson(currentJson())} data-testid="instr-current">
                load current
              </button>
            </div>
            {showPrompt && (
              <textarea readOnly value={AUTHORING_PROMPT} rows={6} aria-label="Authoring prompt" data-testid="author-prompt-field" onFocus={(e) => e.currentTarget.select()} spellcheck={false} />
            )}
            <textarea value={json} onInput={(e) => setJson(e.currentTarget.value)} placeholder="Scenario JSON (load the example or the current scenario to start)" rows={8} data-testid="instr-json" spellcheck={false} />
            <div>
              <button type="button" onClick={() => void validate()} data-testid="author-validate">
                Validate
              </button>
              <button
                type="button"
                class="primary"
                onClick={() => {
                  const def = validate();
                  if (!def) return;
                  const r = ctl.customScenarios.save(def);
                  if (!r.ok) {
                    setErrors([r.error]);
                    setMsg('not saved');
                    return;
                  }
                  ctl.loadScenario(def.id);
                  location.hash = def.id;
                  setMsg(`saved and loaded "${def.title}"`);
                }}
                data-testid="author-save"
              >
                Save to My scenarios
              </button>
              <button
                type="button"
                onClick={() => {
                  const def = validate();
                  if (def) {
                    ctl.loadScenarioDef(def);
                    setMsg(`running "${def.title}" (not saved)`);
                  }
                }}
                data-testid="instr-load"
              >
                run without saving
              </button>
              <button type="button" onClick={() => void downloadBytes(`${ctl.scenario?.id ?? 'scenario'}.json`, json || currentJson(), 'application/json')} data-testid="instr-export">
                export
              </button>
              <label class="inline">
                import
                <input type="file" accept="application/json,.json" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (!f) return; void f.text().then((txt) => setJson(txt)); }} data-testid="instr-import" />
              </label>
            </div>
            {errors.length > 0 && (
              <ul class="author-errors" data-testid="author-errors">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            {warnings.length > 0 && (
              <ul class="author-warnings muted" data-testid="author-warnings">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            {msg && (
              <span class="muted" data-testid="instr-msg">
                {msg}
              </span>
            )}
          </div>
          {custom.length > 0 && (
            <div class="row custom-list" data-testid="custom-list">
              <b>My scenarios</b>
              <span class="muted">saved in this browser</span>
              <ul>
                {custom.map((s) => (
                  <li key={s.id} data-testid="custom-row">
                    <span>{s.title}</span>
                    <button type="button" onClick={() => { ctl.loadScenario(s.id); location.hash = s.id; }} data-testid="custom-load">load</button>
                    <button type="button" onClick={() => setJson(ctl.customScenarios.exportJson(s.id) ?? '')} data-testid="custom-export">edit</button>
                    <button
                      type="button"
                      onClick={() => {
                        ctl.customScenarios.remove(s.id);
                        ctl.refresh();
                        setMsg(`removed "${s.title}"`);
                      }}
                      data-testid="custom-delete"
                    >
                      delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
