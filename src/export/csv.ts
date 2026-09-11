/**
 * Session CSV (Spec §10): device-rate measured signals with the breath id and ventilator phase, plus
 * optional truth channels. One row per device sample; works over the live ring buffers and over a
 * headless result through the same reader shape.
 */
import { PHASE_CODE } from '../sim/channels';
import type { HeadlessResult } from '../sim/headless';
import type { BreathRecord } from '../sim/types';
import type { ChannelKey } from '../worker/protocol';

export const CSV_MEASURED_COLUMNS = ['t', 'paw', 'flow', 'vol', 'pes', 'breath_id', 'phase'] as const;
export const CSV_TRUTH_COLUMNS = ['pmus', 'palv', 'pplND', 'pplD', 'pesTrue', 'plND', 'plD', 'qND', 'qD', 'vlung'] as const;

const PHASE_NAME: Record<number, string> = Object.fromEntries(Object.entries(PHASE_CODE).map(([name, code]) => [code, name]));

export interface CsvSource {
  n: number;
  fs: number;
  get(ch: ChannelKey, i: number): number;
  breaths: BreathRecord[];
  truth: boolean;
}

export function sessionCsv(src: CsvSource): string {
  const header = src.truth ? [...CSV_MEASURED_COLUMNS, ...CSV_TRUTH_COLUMNS] : [...CSV_MEASURED_COLUMNS];
  const lines: string[] = [header.join(',')];
  const breaths = [...src.breaths].sort((a, b) => a.tStart - b.tStart);
  let bi = 0;
  for (let i = 0; i < src.n; i++) {
    const t = src.get('t', i);
    while (bi + 1 < breaths.length && (breaths[bi + 1]?.tStart ?? Infinity) <= t) bi += 1;
    const b = breaths[bi];
    const inBreath = b !== undefined && b.tStart <= t && (b.tEnd === null || t < b.tEnd);
    const row = [
      t.toFixed(3),
      src.get('paw', i).toFixed(2),
      (src.get('flow', i) * 60).toFixed(2),
      (src.get('vol', i) * 1000).toFixed(1),
      src.get('pes', i).toFixed(2),
      inBreath ? String(b.index) : '',
      PHASE_NAME[Math.round(src.get('truth.phase', i))] ?? '',
    ];
    if (src.truth) {
      row.push(
        src.get('truth.pmus', i).toFixed(2),
        src.get('truth.palv', i).toFixed(2),
        src.get('truth.pplND', i).toFixed(2),
        src.get('truth.pplD', i).toFixed(2),
        src.get('truth.pesTrue', i).toFixed(2),
        src.get('truth.plND', i).toFixed(2),
        src.get('truth.plD', i).toFixed(2),
        (src.get('truth.qND', i) * 60).toFixed(2),
        (src.get('truth.qD', i) * 60).toFixed(2),
        (src.get('truth.vlung', i) * 1000).toFixed(1),
      );
    }
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

export function csvFromHeadless(res: HeadlessResult, opts: { truth: boolean }): string {
  const measured: Record<string, Float32Array> = { t: res.t, paw: res.paw, flow: res.flow, vol: res.vol, pes: res.pes };
  const get = (ch: ChannelKey, i: number): number => {
    const m = measured[ch];
    if (m) return m[i] ?? 0;
    return res.truth[ch.slice(6) as keyof typeof res.truth]?.[i] ?? 0;
  };
  return sessionCsv({ n: res.t.length, fs: res.fs, get, breaths: res.breaths, truth: opts.truth });
}
