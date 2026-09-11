import { useEffect, useRef } from 'preact/hooks';
import type { SessionController } from '../app/controller';
import type { StreamStore } from '../app/StreamStore';
import type { ChannelKey } from '../worker/protocol';
import { fmt } from './waveform-draw';

export interface LoopDef {
  id: string;
  title: string;
  x: ChannelKey;
  y: ChannelKey;
  xScale?: number;
  yScale?: number;
  xLabel: string;
  yLabel: string;
  color: string;
  /** Second trace on the same axes (e.g. dependent compartment). */
  x2?: ChannelKey;
  y2?: ChannelKey;
  color2?: string;
  /** Campbell diagram: draw the chest-wall relaxation line with slope 1/Ecw from the end-expiratory point. */
  chestWallLine?: boolean;
}

export const BEDSIDE_LOOPS: LoopDef[] = [
  { id: 'pv', title: 'P–V', x: 'paw', y: 'vol', yScale: 1000, xLabel: 'Paw cmH2O', yLabel: 'V mL', color: '#ffd54f' },
  { id: 'fv', title: 'F–V', x: 'vol', y: 'flow', xScale: 1000, yScale: 60, xLabel: 'V mL', yLabel: 'Flow L/min', color: '#4fc3f7' },
];

export const TRUTH_LOOPS: LoopDef[] = [
  {
    id: 'plv',
    title: 'PL–V per compartment',
    x: 'truth.plND',
    y: 'truth.vND',
    yScale: 1000,
    xLabel: 'PL cmH2O',
    yLabel: 'V mL',
    color: '#90caf9',
    x2: 'truth.plD',
    y2: 'truth.vD',
    color2: '#1e88e5',
  },
  { id: 'campbell', title: 'Campbell (Pes–V)', x: 'pes', y: 'truth.vlung', yScale: 1000, xLabel: 'Pes cmH2O', yLabel: 'V mL', color: '#f48fb1', chestWallLine: true },
];

interface Props {
  ctl: SessionController;
  loops: LoopDef[];
  ecw: number | null;
}

function drawLoop(ctx: CanvasRenderingContext2D, w: number, h: number, store: StreamStore, def: LoopDef, tView: number, ecw: number | null): void {
  ctx.fillStyle = '#0e141b';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#8b9bb0';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(def.title, 6, 4);
  const breaths = store.breaths;
  if (store.length === 0) return;
  // Segments: previous complete breath (faded) and the current breath (bright).
  const lastStart = [...store.events].reverse().find((e) => e.type === 'trigger' && e.t <= tView)?.t ?? store.tOldest;
  const prev = breaths.filter((b) => b.tEnd !== null && b.tEnd <= lastStart + 1e-6).at(-1);
  const segs: Array<{ t0: number; t1: number; alpha: number }> = [];
  if (prev && prev.tEnd !== null) segs.push({ t0: prev.tStart, t1: prev.tEnd, alpha: 0.35 });
  segs.push({ t0: lastStart, t1: tView, alpha: 1 });

  const xs = def.xScale ?? 1;
  const ys = def.yScale ?? 1;
  let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
  const traces: Array<{ x: ChannelKey; y: ChannelKey; color: string }> = [{ x: def.x, y: def.y, color: def.color }];
  if (def.x2 && def.y2) traces.push({ x: def.x2, y: def.y2, color: def.color2 ?? def.color });
  for (const s of segs) {
    const i0 = store.indexAt(Math.max(s.t0, store.tOldest));
    const i1 = store.indexAt(Math.min(s.t1, store.tLatest));
    if (i0 < 0 || i1 < 0) continue;
    for (const tr of traces) {
      for (let i = i0; i <= i1; i += 2) {
        const x = store.read(tr.x, i) * xs;
        const y = store.read(tr.y, i) * ys;
        if (x < xlo) xlo = x;
        if (x > xhi) xhi = x;
        if (y < ylo) ylo = y;
        if (y > yhi) yhi = y;
      }
    }
  }
  if (!Number.isFinite(xlo) || !Number.isFinite(ylo)) return;
  xlo = Math.min(xlo, 0);
  ylo = Math.min(ylo, 0);
  const padX = Math.max(1, 0.1 * (xhi - xlo));
  const padY = Math.max(1, 0.1 * (yhi - ylo));
  xlo -= padX;
  xhi += padX;
  ylo -= padY;
  yhi += padY;
  const m = { l: 34, r: 8, t: 18, b: 22 };
  const px = (x: number) => m.l + ((x - xlo) / (xhi - xlo)) * (w - m.l - m.r);
  const py = (y: number) => h - m.b - ((y - ylo) / (yhi - ylo)) * (h - m.t - m.b);
  // Axes.
  ctx.strokeStyle = '#2a3644';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(0) + 0.5, m.t);
  ctx.lineTo(px(0) + 0.5, h - m.b);
  ctx.moveTo(m.l, py(0) + 0.5);
  ctx.lineTo(w - m.r, py(0) + 0.5);
  ctx.stroke();
  ctx.fillStyle = '#8b9bb0';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  ctx.fillText(def.xLabel, w - m.r, h - 4);
  ctx.textAlign = 'left';
  ctx.fillText(fmt(xhi), w - m.r - 30, h - m.b - 2);
  ctx.textBaseline = 'top';
  ctx.fillText(def.yLabel, 4, m.t);
  ctx.fillText(fmt(yhi), 4, m.t + 12);
  // Chest-wall relaxation line (Campbell): from the end-expiratory point with slope 1/Ecw.
  if (def.chestWallLine && ecw && ecw > 0) {
    const iEE = store.indexAt(Math.max(lastStart, store.tOldest));
    if (iEE >= 0) {
      const x0 = store.read(def.x, iEE) * xs;
      const y0 = store.read(def.y, iEE) * ys;
      ctx.strokeStyle = '#8b9bb0';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px(x0), py(y0));
      const dy = yhi - y0;
      ctx.lineTo(px(x0 + (dy / 1000) * ecw), py(yhi));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  for (const s of segs) {
    const i0 = store.indexAt(Math.max(s.t0, store.tOldest));
    const i1 = store.indexAt(Math.min(s.t1, store.tLatest));
    if (i0 < 0 || i1 < 0) continue;
    for (const tr of traces) {
      ctx.globalAlpha = s.alpha;
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const x = px(store.read(tr.x, i) * xs);
        const y = py(store.read(tr.y, i) * ys);
        if (i === i0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

export function LoopCanvas({ ctl, loops, ecw }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const loopsRef = useRef(loops);
  loopsRef.current = loops;
  useEffect(() => {
    const wrap = ref.current;
    if (!wrap) return;
    let raf = 0;
    const loop = () => {
      const canvases = wrap.querySelectorAll('canvas');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvases.forEach((c, i) => {
        const def = loopsRef.current[i];
        if (!def) return;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (w === 0 || h === 0) return;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.save();
        ctx.scale(dpr, dpr);
        drawLoop(ctx, w, h, ctl.store, def, ctl.tView, ecw);
        ctx.restore();
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ctl, ecw]);
  return (
    <div class="loops" ref={ref} data-testid="loops">
      {loops.map((l) => (
        <canvas key={l.id} class="loop-canvas" role="img" aria-label={`${l.title} loop`} />
      ))}
    </div>
  );
}
