/**
 * Batch worker (Spec §10): runs a scenario × seed grid headless and returns a zip of labeled datasets.
 */
import { runBatch, zipBatch, type BatchGrid } from '../export/batch';

export type BatchWorkerIn = { type: 'run'; grid: BatchGrid };
export type BatchWorkerOut = { type: 'progress'; done: number; total: number } | { type: 'done'; zip: Uint8Array } | { type: 'error'; message: string };

const ctx = self as unknown as { postMessage: (m: BatchWorkerOut, transfer?: Transferable[]) => void; onmessage: ((ev: MessageEvent<BatchWorkerIn>) => void) | null };

ctx.onmessage = (ev) => {
  const m = ev.data;
  if (m.type !== 'run') return;
  runBatch(m.grid, (done, total) => ctx.postMessage({ type: 'progress', done, total }))
    .then((files) => {
      const zip = zipBatch(files);
      ctx.postMessage({ type: 'done', zip }, [zip.buffer]);
    })
    .catch((e: unknown) => ctx.postMessage({ type: 'error', message: (e as Error).message }));
};
