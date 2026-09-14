/**
 * Canvas2D sweep renderer for the waveform screen. Pure drawing code (no Preact) so it can be driven
 * from a requestAnimationFrame loop and profiled. Sweep semantics: the cursor at x(tView) moves left to
 * right and overwrites the previous sweep, as on an ICU ventilator screen.
 */
import type { StreamStore } from '../app/StreamStore';
import type { ChannelKey } from '../worker/protocol';
import type { VentEvent } from '../sim/types';

export interface Trace {
  ch: ChannelKey;
  color: string;
  /** Multiply before display (e.g. L/s → L/min, L → mL). */
  scale?: number;
  width?: number;
  dash?: number[];
}

export interface Row {
  id: string;
  label: string;
  unit: string;
  traces: Trace[];
  /** Fixed minimum span shown, in display units, so quiet traces do not zoom into noise. */
  minSpan: number;
  /** Values always included in the range (e.g. 0). */
  include?: number[];
  /** Shade the neural inspiratory time (truth) on this row. */
  neuralBand?: boolean;
  /** Highlight pendelluft (compartment flows of opposite sign). */
  pendelluft?: boolean;
  /** Draw ventilator event markers on this row. */
  markers?: boolean;
}

export interface RowRange {
  lo: number;
  hi: number;
  /** Frames the needed span has been well inside the current range (for shrinking). */
  slack: number;
}

export interface BadgeLabels {
  det: string[];
  truth: string[] | null;
  triggerCause: string;
}

export interface BadgeHit {
  x0: number;
  x1: number;
  index: number;
}

export interface DrawOptions {
  store: StreamStore;
  rows: Row[];
  tView: number;
  sweep: number;
  ranges: Map<string, RowRange>;
  cursorT: number | null;
  showBadges: boolean;
  /** Pattern labels per breath index (detector; truth row when the truth layer is on). */
  badges?: Map<number, BadgeLabels>;
  truthBadges?: boolean;
  /** Filled by the renderer: x extents of every drawn badge (hover hit-testing). */
  badgeHits?: BadgeHit[];
  dpr: number;
}

export const BADGE_STRIP = 18;

/** Short badge codes and colours per pattern (Spec §7 table). */
export const PATTERN_CODES: Record<string, { code: string; color: string; name: string }> = {
  'ineffective-effort': { code: 'IE', color: '#ff8a65', name: 'ineffective effort' },
  'double-trigger': { code: 'DT', color: '#ef5350', name: 'double trigger' },
  'auto-trigger': { code: 'AT', color: '#ba68c8', name: 'auto-trigger' },
  'delayed-trigger': { code: 'dT', color: '#ffd54f', name: 'delayed trigger' },
  'premature-cycling': { code: 'PC', color: '#ffb74d', name: 'premature cycling' },
  'delayed-cycling': { code: 'DC', color: '#4fc3f7', name: 'delayed cycling' },
  'flow-starvation': { code: 'FS', color: '#f06292', name: 'flow starvation' },
  'reverse-trigger': { code: 'RT', color: '#9575cd', name: 'reverse trigger' },
  overshoot: { code: 'OV', color: '#ffee58', name: 'overshoot' },
  'auto-peep': { code: 'AP', color: '#a1887f', name: 'auto-PEEP' },
  leak: { code: 'LK', color: '#80cbc4', name: 'leak' },
  secretions: { code: 'SC', color: '#aed581', name: 'secretions' },
  water: { code: 'WA', color: '#81d4fa', name: 'water' },
  'high-resistance': { code: 'HR', color: '#ff7043', name: 'high resistance' },
  'low-compliance': { code: 'LC', color: '#90a4ae', name: 'low compliance' },
  cough: { code: 'CG', color: '#e57373', name: 'cough' },
  pendelluft: { code: 'PL', color: '#26a69a', name: 'pendelluft' },
  overdistension: { code: 'OD', color: '#ffca28', name: 'overdistension' },
  'tidal-recruitment': { code: 'TR', color: '#4db6ac', name: 'tidal recruitment' },
  'high-effort': { code: 'HE', color: '#ce93d8', name: 'high effort' },
  'low-effort': { code: 'LE', color: '#b0bec5', name: 'low effort' },
};

export function badgeStripHeight(o: Pick<DrawOptions, 'showBadges' | 'truthBadges'>): number {
  return o.showBadges ? (o.truthBadges ? 2 * BADGE_STRIP : BADGE_STRIP) : 0;
}
export const ROW_GAP = 4;
const GAP_FRACTION = 0.015;

function nice(span: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(span)));
  const m = span / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}

/** Update the row's range from the data currently in the window; expands immediately, shrinks slowly. */
export function updateRange(row: Row, store: StreamStore, t0: number, t1: number, r: RowRange): void {
  let lo = Infinity;
  let hi = -Infinity;
  const i0 = Math.max(0, store.indexAt(Math.max(t0, store.tOldest)));
  const i1 = store.indexAt(Math.min(t1, store.tLatest));
  if (i1 < 0) return;
  const step = Math.max(1, Math.floor((i1 - i0) / 600));
  for (const tr of row.traces) {
    const s = tr.scale ?? 1;
    for (let i = i0; i <= i1; i += step) {
      const v = store.read(tr.ch, i) * s;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  for (const v of row.include ?? []) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
  if (hi - lo < row.minSpan) {
    // Quiet trace: keep at least minSpan visible, anchored at zero for non-negative signals.
    if (lo >= 0) hi = lo + row.minSpan;
    else {
      const c = 0.5 * (lo + hi);
      lo = c - 0.5 * row.minSpan;
      hi = c + 0.5 * row.minSpan;
    }
  }
  let span = hi - lo;
  const pad = 0.08 * span;
  lo -= pad;
  hi += pad;
  span = hi - lo;
  const cur = r.hi - r.lo;
  const needExpand = lo < r.lo || hi > r.hi || cur <= 0;
  if (needExpand) {
    const step2 = nice(span / 10);
    r.lo = Math.floor(Math.min(lo, cur > 0 ? r.lo : lo) / step2) * step2;
    r.hi = Math.ceil(Math.max(hi, cur > 0 ? r.hi : hi) / step2) * step2;
    r.slack = 0;
  } else if (span < 0.55 * cur) {
    r.slack += 1;
    if (r.slack > 120) {
      const step2 = nice(span / 10);
      r.lo = Math.floor(lo / step2) * step2;
      r.hi = Math.ceil(hi / step2) * step2;
      r.slack = 0;
    }
  } else {
    r.slack = 0;
  }
}

export function xForT(t: number, tView: number, sweep: number, w: number): number {
  const tSweepStart = Math.floor(tView / sweep) * sweep;
  let dt = t - tSweepStart;
  if (dt < 0) dt += sweep;
  return (dt / sweep) * w;
}

/** Time at pixel x for the current sweep (previous sweep right of the cursor). */
export function tForX(x: number, tView: number, sweep: number, w: number): number {
  const tSweepStart = Math.floor(tView / sweep) * sweep;
  let t = tSweepStart + (x / w) * sweep;
  if (t > tView) t -= sweep;
  return t;
}

const TRIGGER_LETTER: Record<string, string> = { patient: 'P', time: 'T', backup: 'B', manual: 'M' };
const CYCLE_LETTER: Record<string, string> = { time: 'time', volume: 'vol', flow: 'flow', 'ti-max': 'Timax', pressure: 'Psafe', alarm: 'ALARM', manual: 'man' };

export function drawWaveforms(ctx: CanvasRenderingContext2D, w: number, h: number, o: DrawOptions): void {
  const { store, rows, tView, sweep } = o;
  ctx.save();
  ctx.scale(o.dpr, o.dpr);
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, w, h);
  if (store.length === 0 || rows.length === 0 || Number.isNaN(tView)) {
    ctx.restore();
    return;
  }
  const top = badgeStripHeight(o);
  const rowH = (h - top - ROW_GAP * (rows.length - 1)) / rows.length;
  const tSweepStart = Math.floor(tView / sweep) * sweep;
  const tWinLo = tView - sweep;
  const xCursor = xForT(tView, tView, sweep, w);
  const gapPx = GAP_FRACTION * w;

  // Neural bands and holds first (behind traces).
  const holdSpans: Array<[number, number]> = [];
  let openHold: number | null = null;
  for (const e of store.events) {
    if (e.t < tWinLo - 5) continue;
    if (e.type === 'hold-start') openHold = e.t;
    else if (e.type === 'hold-end') {
      holdSpans.push([openHold ?? e.t - 0.01, e.t]);
      openHold = null;
    }
  }
  if (openHold !== null) holdSpans.push([openHold, tView]);

  rows.forEach((row, ri) => {
    const y0 = top + ri * (rowH + ROW_GAP);
    const r = o.ranges.get(row.id) ?? { lo: 0, hi: 1, slack: 0 };
    updateRange(row, store, tWinLo, tView, r);
    o.ranges.set(row.id, r);
    const yFor = (v: number) => y0 + rowH - ((v - r.lo) / (r.hi - r.lo)) * rowH;

    // Row background + grid.
    ctx.fillStyle = '#0e141b';
    ctx.fillRect(0, y0, w, rowH);
    ctx.strokeStyle = '#1c2632';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let s = 0; s <= sweep; s += sweep / 6) {
      const x = Math.round((s / sweep) * w) + 0.5;
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + rowH);
    }
    ctx.stroke();
    // Zero line.
    if (r.lo < 0 && r.hi > 0) {
      ctx.strokeStyle = '#2a3644';
      ctx.beginPath();
      ctx.moveTo(0, Math.round(yFor(0)) + 0.5);
      ctx.lineTo(w, Math.round(yFor(0)) + 0.5);
      ctx.stroke();
    }

    // Shading: holds and neural Ti.
    const shadeSpan = (ta: number, tb: number, color: string) => {
      if (tb < tWinLo || ta > tView) return;
      const a = Math.max(ta, tWinLo);
      const b = Math.min(tb, tView);
      const xa = xForT(a, tView, sweep, w);
      const xb = xForT(b, tView, sweep, w);
      ctx.fillStyle = color;
      if (xb >= xa) ctx.fillRect(xa, y0, xb - xa, rowH);
      else {
        ctx.fillRect(xa, y0, w - xa, rowH);
        ctx.fillRect(0, y0, xb, rowH);
      }
    };
    if (row.markers) for (const [a, b] of holdSpans) shadeSpan(a, b, 'rgba(255, 213, 79, 0.10)');
    if (row.neuralBand) for (const nb of store.neural) shadeSpan(nb.tOnset, nb.tOnset + nb.ti, 'rgba(206, 147, 216, 0.18)');

    // Pendelluft highlight: columns where compartment flows have opposite signs.
    if (row.pendelluft) {
      ctx.fillStyle = 'rgba(239, 83, 80, 0.22)';
      for (let x = 0; x < w; x += 2) {
        const t = tForX(x, tView, sweep, w);
        const i = store.indexAt(t);
        if (i < 0) continue;
        const a = store.read('truth.qND', i);
        const b = store.read('truth.qD', i);
        if ((a < -0.01 && b > 0.01) || (b < -0.01 && a > 0.01)) ctx.fillRect(x, y0, 2, rowH);
      }
    }

    // Traces: one point per pixel column, broken at the cursor gap and at missing data.
    for (const tr of row.traces) {
      const s = tr.scale ?? 1;
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = tr.width ?? 1.6;
      ctx.setLineDash(tr.dash ?? []);
      ctx.beginPath();
      let pen = false;
      for (let x = 0; x < w; x += 1) {
        const inGap = x > xCursor && x < xCursor + gapPx;
        if (inGap) {
          pen = false;
          continue;
        }
        let t = tSweepStart + (x / w) * sweep;
        if (x > xCursor) t -= sweep;
        const i = store.indexAt(t);
        if (i < 0 || t < tWinLo) {
          pen = false;
          continue;
        }
        const v = store.read(tr.ch, i) * s;
        const y = Math.min(y0 + rowH, Math.max(y0, yFor(v)));
        if (!pen) {
          ctx.moveTo(x, y);
          pen = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Event markers: triggers as labeled ticks, cycles as short dashes.
    if (row.markers) {
      ctx.font = '10px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      for (const e of store.events) {
        if (e.t < tWinLo || e.t > tView) continue;
        const x = xForT(e.t, tView, sweep, w);
        if (e.type === 'trigger') {
          ctx.fillStyle = e.cause === 'patient' ? '#66bb6a' : e.cause === 'backup' ? '#ef5350' : '#8b9bb0';
          ctx.beginPath();
          ctx.moveTo(x, y0 + rowH);
          ctx.lineTo(x - 4, y0 + rowH - 7);
          ctx.lineTo(x + 4, y0 + rowH - 7);
          ctx.closePath();
          ctx.fill();
          ctx.fillText(TRIGGER_LETTER[e.cause] ?? '?', x + 5, y0 + rowH - 12);
        } else if (e.type === 'cycle') {
          ctx.strokeStyle = e.cause === 'alarm' ? '#ef5350' : e.cause === 'ti-max' || e.cause === 'pressure' ? '#ffb74d' : '#4a5a6c';
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, y0);
          ctx.lineTo(Math.round(x) + 0.5, y0 + rowH);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (e.type === 'alarm' && e.active) {
          ctx.fillStyle = '#ef5350';
          ctx.fillRect(x - 1, y0, 2, 6);
        }
      }
    }

    // Labels and range.
    ctx.fillStyle = '#8b9bb0';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`${row.label} ${row.unit}`, 6, y0 + 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmt(r.hi), w - 6, y0 + 4);
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmt(r.lo), w - 6, y0 + rowH - 2);
    ctx.textAlign = 'left';
    // Current value.
    const tr0 = row.traces[0];
    if (tr0) {
      const v = store.valueAt(tr0.ch, tView) * (tr0.scale ?? 1);
      if (Number.isFinite(v)) {
        ctx.fillStyle = tr0.color;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(fmt(v), 6, y0 + 18);
      }
    }
    if (row.traces.length > 1) {
      ctx.font = '10px system-ui, sans-serif';
      let lx = 6;
      const ly = y0 + rowH - 13;
      for (const tr of row.traces) {
        ctx.fillStyle = tr.color;
        ctx.fillText(traceName(tr.ch), lx, ly);
        lx += ctx.measureText(traceName(tr.ch)).width + 10;
      }
    }
  });

  // Breath badges above the traces: the detector's pattern codes (trigger letter when none); a second row
  // with the truth labels when the truth layer is on. Badge extents are recorded for hover hit-testing.
  if (o.showBadges) {
    if (o.badgeHits) o.badgeHits.length = 0;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const b of store.breaths) {
      if (b.tStart < tWinLo || b.tStart > tView) continue;
      const x = xForT(b.tStart, tView, sweep, w);
      const lbl = o.badges?.get(b.index);
      const det = lbl?.det ?? [];
      let cx = x;
      if (det.length === 0) {
        const label = TRIGGER_LETTER[b.triggerCause] ?? '?';
        const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = b.triggerCause === 'patient' ? 'rgba(102,187,106,0.25)' : 'rgba(139,155,176,0.2)';
        ctx.fillRect(cx, 2, tw, BADGE_STRIP - 4);
        ctx.fillStyle = '#e6edf3';
        ctx.fillText(label, cx + 4, BADGE_STRIP / 2);
        cx += tw + 2;
      } else {
        for (const p of det) {
          const pc = PATTERN_CODES[p] ?? { code: p.slice(0, 2).toUpperCase(), color: '#e6edf3', name: p };
          const tw = ctx.measureText(pc.code).width + 8;
          ctx.fillStyle = pc.color;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(cx, 2, tw, BADGE_STRIP - 4);
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#0b1016';
          ctx.fillText(pc.code, cx + 4, BADGE_STRIP / 2);
          cx += tw + 2;
        }
      }
      if (o.truthBadges) {
        const truth = lbl?.truth ?? [];
        let tx = x;
        ctx.font = '10px system-ui, sans-serif';
        for (const p of truth) {
          const pc = PATTERN_CODES[p] ?? { code: p.slice(0, 2).toUpperCase(), color: '#e6edf3', name: p };
          const tw = ctx.measureText(pc.code).width + 8;
          ctx.strokeStyle = pc.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(tx + 0.5, BADGE_STRIP + 2.5, tw, BADGE_STRIP - 5);
          ctx.fillStyle = pc.color;
          ctx.fillText(pc.code, tx + 4, BADGE_STRIP * 1.5);
          tx += tw + 2;
        }
        ctx.font = 'bold 10px system-ui, sans-serif';
        cx = Math.max(cx, tx);
      }
      if (o.badgeHits) o.badgeHits.push({ x0: x, x1: Math.max(cx, x + 12), index: b.index });
    }
  }

  // Cursor line and frozen cursor.
  ctx.strokeStyle = '#e6edf3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(xCursor) + 0.5, top);
  ctx.lineTo(Math.round(xCursor) + 0.5, h);
  ctx.stroke();
  if (o.cursorT !== null) {
    const x = xForT(o.cursorT, tView, sweep, w);
    ctx.strokeStyle = '#4fc3f7';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

export function badgeText(trigger: string, cycle: string): string {
  return `${TRIGGER_LETTER[trigger] ?? '?'}·${CYCLE_LETTER[cycle] ?? cycle}`;
}

export function traceName(ch: ChannelKey): string {
  const names: Partial<Record<ChannelKey, string>> = {
    paw: 'Paw',
    flow: 'Flow',
    vol: 'Vol',
    pes: 'Pes',
    'truth.paw': 'Paw true',
    'truth.palv': 'Palv',
    'truth.pmus': 'Pmus',
    'truth.pmusIso': 'Pmus iso',
    'truth.pplND': 'Ppl ND',
    'truth.pplD': 'Ppl D',
    'truth.plND': 'PL ND',
    'truth.plD': 'PL D',
    'truth.qND': 'Q ND',
    'truth.qD': 'Q D',
    'truth.pesTrue': 'Pes true',
    'truth.vlung': 'V lung',
  };
  return names[ch] ?? ch;
}

export function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, '') || '0';
}

export function alarmLabel(e: Extract<VentEvent, { type: 'alarm' }> | string): string {
  const id = typeof e === 'string' ? e : e.alarm;
  const names: Record<string, string> = {
    'high-ppeak': 'High Ppeak',
    'low-vte': 'Low Vte',
    'high-ve': 'High Ve',
    'low-ve': 'Low Ve',
    apnea: 'Apnea → backup',
    'high-rr': 'High RR',
    disconnect: 'Disconnect / low PEEP',
    'high-leak': 'High leak',
    'ti-max': 'Ti max',
    'high-peepi': 'High PEEPi',
    'prvc-limit': 'PRVC: volume not achieved',
  };
  return names[id] ?? id;
}
