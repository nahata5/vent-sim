import { useEffect, useRef, useState } from 'preact/hooks';
import type { SessionController } from '../app/controller';
import { badgeStripHeight, drawWaveforms, fmt, PATTERN_CODES, tForX, traceName, type BadgeHit, type BadgeLabels, type Row, type RowRange } from './waveform-draw';
import { BATCH_CHANNELS, type ChannelKey } from '../worker/protocol';

export const MEASURED_ROWS: Row[] = [
  { id: 'paw', label: 'Paw', unit: 'cmH2O', traces: [{ ch: 'paw', color: '#ffd54f' }], minSpan: 20, include: [0], markers: true },
  { id: 'flow', label: 'Flow', unit: 'L/min', traces: [{ ch: 'flow', color: '#4fc3f7', scale: 60 }], minSpan: 60, include: [0] },
  { id: 'vol', label: 'Volume', unit: 'mL', traces: [{ ch: 'vol', color: '#81c784', scale: 1000 }], minSpan: 500, include: [0] },
];

export const TRUTH_ROWS: Row[] = [
  {
    id: 'pmus',
    label: 'Pmus (true)',
    unit: 'cmH2O',
    traces: [
      { ch: 'truth.pmus', color: '#ce93d8' },
      { ch: 'truth.pmusIso', color: '#ce93d8', dash: [3, 3], width: 1 },
    ],
    minSpan: 10,
    include: [0],
    neuralBand: true,
  },
  {
    id: 'palv',
    label: 'Paw vs Palv',
    unit: 'cmH2O',
    traces: [
      { ch: 'truth.paw', color: '#ffd54f', width: 1 },
      { ch: 'truth.palv', color: '#ff8a65' },
    ],
    minSpan: 20,
    include: [0],
  },
  {
    id: 'ppl',
    label: 'Ppl ND / D · Pes',
    unit: 'cmH2O',
    traces: [
      { ch: 'truth.pplND', color: '#80cbc4' },
      { ch: 'truth.pplD', color: '#26a69a' },
      { ch: 'pes', color: '#f48fb1', width: 1 },
    ],
    minSpan: 15,
    include: [0],
  },
  {
    id: 'pl',
    label: 'PL ND / D',
    unit: 'cmH2O',
    traces: [
      { ch: 'truth.plND', color: '#90caf9' },
      { ch: 'truth.plD', color: '#1e88e5' },
    ],
    minSpan: 15,
    include: [0],
  },
  {
    id: 'qcomp',
    label: 'Compartment flow ND / D',
    unit: 'L/min',
    traces: [
      { ch: 'truth.qND', color: '#a5d6a7', scale: 60 },
      { ch: 'truth.qD', color: '#43a047', scale: 60 },
    ],
    minSpan: 30,
    include: [0],
    pendelluft: true,
  },
];

const PES_ROW: Row = { id: 'pes', label: 'Pes', unit: 'cmH2O', traces: [{ ch: 'pes', color: '#f48fb1' }], minSpan: 15, include: [0] };

export interface PerfStats {
  frames: number;
  drawMs: number;
  lastFps: number;
}

interface Props {
  ctl: SessionController;
  truth: boolean;
  balloon: boolean;
  perf: PerfStats;
  /** Shared array the renderer fills with badge extents (exposed for tests). */
  hits: BadgeHit[];
}

interface Readout {
  t: number;
  values: Array<{ label: string; value: string }>;
  /** Badge hover: pattern evidence lines (detector) and truth labels. */
  evidence?: Array<{ label: string; text: string; truth: boolean }>;
  x: number;
  y: number;
}

/** Badge labels for the renderer: detector patterns per breath, truth patterns when the layer is on. */
function badgeMap(ctl: SessionController, truth: boolean): Map<number, BadgeLabels> {
  const m = new Map<number, BadgeLabels>();
  for (const [idx, l] of ctl.labels) {
    m.set(idx, { det: l.det?.patterns ?? [], truth: truth ? (l.truth?.patterns ?? []) : null, triggerCause: l.truth?.triggerCause ?? '' });
  }
  return m;
}

const READOUT_CHANNELS: ChannelKey[] = ['paw', 'flow', 'vol', 'pes', 'truth.pmus', 'truth.palv', 'truth.pplND', 'truth.pplD', 'truth.plND', 'truth.plD', 'truth.qND', 'truth.qD'];
const READOUT_SCALE: Partial<Record<ChannelKey, number>> = { flow: 60, vol: 1000, 'truth.qND': 60, 'truth.qD': 60 };

export function WaveformCanvas({ ctl, truth, balloon, perf, hits }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rangesRef = useRef(new Map<string, RowRange>());
  const cursorRef = useRef<number | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const rows = truth ? [...MEASURED_ROWS, ...TRUTH_ROWS] : balloon ? [...MEASURED_ROWS, PES_ROW] : MEASURED_ROWS;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const truthRef = useRef(truth);
  truthRef.current = truth;
  // Badge labels are rebuilt only when the analysis produced a new label map.
  const badgesRef = useRef<{ src: Map<number, unknown> | null; truth: boolean; map: Map<number, BadgeLabels> }>({ src: null, truth: false, map: new Map() });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let lastFpsT = performance.now();
    let framesSinceFps = 0;
    const loop = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const t0 = performance.now();
      const bref = badgesRef.current;
      if (bref.src !== ctl.labels || bref.truth !== truthRef.current) {
        bref.src = ctl.labels;
        bref.truth = truthRef.current;
        bref.map = badgeMap(ctl, truthRef.current);
      }
      drawWaveforms(ctx, w, h, {
        store: ctl.store,
        rows: rowsRef.current,
        tView: ctl.tView,
        sweep: ctl.view.sweep,
        ranges: rangesRef.current,
        cursorT: cursorRef.current,
        showBadges: ctl.view.badges,
        badges: bref.map,
        truthBadges: truthRef.current,
        badgeHits: hits,
        dpr,
      });
      const dt = performance.now() - t0;
      perf.frames += 1;
      perf.drawMs += dt;
      framesSinceFps += 1;
      if (t0 - lastFpsT >= 1000) {
        perf.lastFps = (framesSinceFps * 1000) / (t0 - lastFpsT);
        framesSinceFps = 0;
        lastFpsT = t0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ctl, perf, hits]);

  const onMove = (ev: MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    if (y < badgeStripHeight({ showBadges: ctl.view.badges, truthBadges: truth })) {
      // Badge strip: show the labels and their evidence for the breath under the pointer (not in a bedside quiz, D-019).
      if (ctl.quizHides('explain')) {
        cursorRef.current = null;
        setReadout(null);
        return;
      }
      const hit = hits.find((h) => x >= h.x0 && x <= h.x1);
      const l = hit ? ctl.labels.get(hit.index) : undefined;
      if (!hit || !l) {
        cursorRef.current = null;
        setReadout(null);
        return;
      }
      const evidence: NonNullable<Readout['evidence']> = [];
      for (const p of l.det?.patterns ?? []) evidence.push({ label: PATTERN_CODES[p]?.name ?? p, text: l.det?.evidence[p] ?? '', truth: false });
      if (truth) for (const p of l.truth?.patterns ?? []) evidence.push({ label: PATTERN_CODES[p]?.name ?? p, text: 'truth label', truth: true });
      if (evidence.length === 0) evidence.push({ label: l.truth ? `${l.truth.triggerCause}-triggered breath` : 'breath', text: 'no pattern detected', truth: false });
      cursorRef.current = l.det?.tStart ?? l.truth?.tStart ?? null;
      setReadout({ t: l.det?.tStart ?? l.truth?.tStart ?? NaN, values: [], evidence, x: Math.min(x + 12, rect.width - 350), y: 4 });
      return;
    }
    const t = tForX(x, ctl.tView, ctl.view.sweep, rect.width);
    cursorRef.current = t;
    const store = ctl.store;
    const values: Readout['values'] = [];
    const chans = truth ? READOUT_CHANNELS : balloon ? READOUT_CHANNELS.slice(0, 4) : READOUT_CHANNELS.slice(0, 3);
    for (const ch of chans) {
      if (!BATCH_CHANNELS.includes(ch)) continue;
      const v = store.valueAt(ch, t) * (READOUT_SCALE[ch] ?? 1);
      if (Number.isFinite(v)) values.push({ label: traceName(ch), value: fmt(v) });
    }
    setReadout({ t, values, x: Math.min(x + 12, rect.width - 170), y: Math.min(y + 12, rect.height - 40) });
  };
  const onLeave = () => {
    cursorRef.current = null;
    setReadout(null);
  };
  // A click on a badge opens the explain card for that breath (Spec §8).
  const onClick = (ev: MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap || !ctl.view.badges) return;
    const rect = wrap.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    if (y >= badgeStripHeight({ showBadges: true, truthBadges: truth })) return;
    const hit = hits.find((h) => x >= h.x0 && x <= h.x1);
    if (hit && ctl.labels.has(hit.index)) ctl.selectBreath(hit.index);
  };

  return (
    <div class="wave-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={onLeave} onClick={onClick} data-testid="waveforms">
      <canvas ref={canvasRef} class="wave-canvas" aria-label="Ventilator waveforms: pressure, flow and volume sweeps" role="img" />
      {readout && (
        <div class={`cursor-readout ${readout.evidence ? 'badge-readout' : ''}`} style={{ left: readout.x, top: readout.y }} data-testid="cursor-readout">
          <div class="muted">{Number.isFinite(readout.t) ? `t = ${readout.t.toFixed(2)} s` : ''}</div>
          {readout.values.map((v) => (
            <div key={v.label}>
              <span class="muted">{v.label}</span> {v.value}
            </div>
          ))}
          {readout.evidence?.map((e, i) => (
            <div key={`${e.label}-${i}`} class="evidence">
              <span class={e.truth ? 'muted' : ''}>{e.truth ? 'truth: ' : ''}<b>{e.label}</b></span>
              {e.text ? <div class="small">{e.text}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
