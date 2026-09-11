import type { SessionController, ViewState } from '../app/controller';

interface Props {
  ctl: SessionController;
  view: ViewState;
  tLatest: number;
  tOldest: number;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export function TimeControls({ ctl, view, tLatest, tOldest }: Props) {
  const tView = ctl.tView;
  const min = Number.isFinite(tOldest) ? Math.min(tLatest, tOldest + view.sweep) : 0;
  const max = Number.isFinite(tLatest) ? tLatest : 0;
  return (
    <div class="time-controls" role="toolbar" aria-label="Time controls">
      <button type="button" onClick={() => ctl.togglePause()} data-testid="pause" aria-pressed={view.paused}>
        {view.paused ? '▶ Resume' : '❚❚ Pause'}
      </button>
      <button type="button" onClick={() => ctl.freeze(!view.frozen)} data-testid="freeze" aria-pressed={view.frozen} title="Freeze the display (the simulation keeps running)">
        {view.frozen ? '● Live' : '❄ Freeze'}
      </button>
      <label class="inline">
        <span class="muted small">scroll back</span>
        <input
          type="range"
          min={min}
          max={max}
          step={0.05}
          value={Number.isFinite(tView) ? tView : max}
          disabled={!Number.isFinite(max) || max <= min}
          onInput={(e) => ctl.scrollTo(Number((e.currentTarget).value))}
          aria-label="Scroll back up to 120 seconds"
          data-testid="scrollback"
        />
      </label>
      <label class="inline">
        <span class="muted small">speed</span>
        <select value={view.speed} onChange={(e) => ctl.setSpeed(Number((e.currentTarget).value))} data-testid="speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <label class="inline">
        <span class="muted small">sweep</span>
        <select value={view.sweep} onChange={(e) => ctl.setSweep(Number((e.currentTarget).value))}>
          {[6, 12, 24].map((s) => (
            <option key={s} value={s}>
              {s} s
            </option>
          ))}
        </select>
      </label>
      <span class="sim-time" data-testid="sim-time">
        t = {Number.isFinite(tView) ? tView.toFixed(1) : '0.0'} s{view.frozen && Number.isFinite(tLatest) ? ` (live ${tLatest.toFixed(1)} s)` : ''}
      </span>
    </div>
  );
}
