import { useEffect, useRef, useState } from 'preact/hooks';
import type { SessionController } from '../app/controller';
import { downloadBytes } from '../export/download';
import type { BatchGrid } from '../export/batch';
import type { BatchWorkerIn, BatchWorkerOut } from '../worker/batch.worker';

interface Props {
  ctl: SessionController;
}

/** Export (Spec §10): session CSV/JSON of the retained window and a batch zip generated in a worker. */
export function ExportPanel({ ctl }: Props) {
  const [msg, setMsg] = useState('');
  const [seeds, setSeeds] = useState('1,2');
  const [duration, setDuration] = useState('30');
  const [truth, setTruth] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);
  const say = (o: string, what: string) => setMsg(o === 'downloaded' ? `${what} downloaded` : o === 'copied' ? `${what} copied to the clipboard (downloads blocked)` : `${what}: export failed`);
  const runBatch = () => {
    const grid: BatchGrid = { scenarios: [ctl.scenario?.id ?? 'normal-passive'], seeds: seeds.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)), duration: Math.max(3, Number(duration) || 30), truth };
    const w = new Worker(new URL('../worker/batch.worker.ts', import.meta.url), { type: 'module', name: 'ventsim-batch' });
    workerRef.current = w;
    setProgress({ done: 0, total: grid.scenarios.length * grid.seeds.length });
    w.onmessage = (ev: MessageEvent<BatchWorkerOut>) => {
      const m = ev.data;
      if (m.type === 'progress') setProgress({ done: m.done, total: m.total });
      else if (m.type === 'done') {
        setProgress(null);
        void downloadBytes(`ventsim-batch-${grid.scenarios[0]}.zip`, m.zip, 'application/zip').then((o) => say(o, 'Batch zip'));
        w.terminate();
      } else if (m.type === 'error') {
        setProgress(null);
        setMsg(`batch failed: ${m.message}`);
        w.terminate();
      }
    };
    const msg: BatchWorkerIn = { type: 'run', grid };
    w.postMessage(msg);
  };
  return (
    <div class="export small" data-testid="export-panel">
      <p class="muted">Session exports cover the retained window (last 120 s of signals; labels, maneuvers and CO2 since the start).</p>
      <div class="row">
        <button type="button" onClick={() => void ctl.exportCsv(false).then((o) => say(o, 'CSV'))} data-testid="export-csv">
          CSV (measured)
        </button>
        <button type="button" onClick={() => void ctl.exportCsv(true).then((o) => say(o, 'CSV with truth'))} data-testid="export-csv-truth">
          CSV + truth
        </button>
        <button type="button" onClick={() => void ctl.exportJson().then((o) => say(o, 'JSON'))} data-testid="export-json">
          JSON (labels, evidence, maneuvers)
        </button>
      </div>
      <div class="row">
        <b>Batch</b>
        <label>
          seeds <input value={seeds} onInput={(e) => setSeeds(e.currentTarget.value)} size={8} data-testid="batch-seeds" />
        </label>
        <label>
          s each <input type="number" value={duration} min={3} max={600} onInput={(e) => setDuration(e.currentTarget.value)} data-testid="batch-duration" />
        </label>
        <label class="inline">
          <input type="checkbox" checked={truth} onChange={(e) => setTruth(e.currentTarget.checked)} /> truth channels
        </label>
        <button type="button" class="primary" onClick={runBatch} disabled={progress !== null} data-testid="batch-run">
          {progress ? `running ${progress.done}/${progress.total}…` : 'Generate zip (this scenario × seeds)'}
        </button>
      </div>
      {msg && (
        <span class="muted" data-testid="export-msg">
          {msg}
        </span>
      )}
    </div>
  );
}
