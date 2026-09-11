import { useEffect, useMemo, useState } from 'preact/hooks';
import { APP_VERSION } from '../config/version';
import { SessionController } from './controller';
import { SCENARIOS } from '../edu/scenarios';
import { WaveformCanvas, type PerfStats } from '../ui/WaveformCanvas';
import { BEDSIDE_LOOPS, LoopCanvas, TRUTH_LOOPS } from '../ui/LoopCanvas';
import { SettingsPanel } from '../ui/SettingsPanel';
import { MonitorPanel } from '../ui/MonitorPanel';
import { LungStressDashboard } from '../ui/LungStressDashboard';
import { TimeControls } from '../ui/TimeControls';
import { AlarmBar } from '../ui/AlarmBar';
import { TruthToggle } from '../ui/TruthToggle';
import { ScenarioPicker } from '../ui/ScenarioPicker';
import { defaultBalloon } from '../sim/patient/balloon';

export const DISCLAIMER =
  'VentSim is for education only. It is not a medical device and not a clinical decision aid.';

declare global {
  interface Window {
    __ventsim?: { ctl: SessionController; perf: PerfStats };
  }
}

const DEFAULT_SCENARIO = SCENARIOS[0]?.id ?? 'normal-passive';

export function App() {
  const ctl = useMemo(() => new SessionController(), []);
  const perf = useMemo<PerfStats>(() => ({ frames: 0, drawMs: 0, lastFps: 0 }), []);
  const [, setTick] = useState(0);
  const [showObjectives, setShowObjectives] = useState(true);

  useEffect(() => {
    window.__ventsim = { ctl, perf };
    const unsub = ctl.subscribe(() => setTick((n) => n + 1));
    const fromHash = () => {
      const hash = location.hash.replace(/^#\/?/, '');
      return SCENARIOS.some((s) => s.id === hash) ? hash : DEFAULT_SCENARIO;
    };
    ctl.loadScenario(fromHash());
    const onHash = () => {
      const id = fromHash();
      if (id !== ctl.scenario?.id) ctl.loadScenario(id);
    };
    window.addEventListener('hashchange', onHash);
    // Coarse refresh for the time readout while live.
    const iv = setInterval(() => setTick((n) => n + 1), 500);
    return () => {
      unsub();
      clearInterval(iv);
      window.removeEventListener('hashchange', onHash);
      ctl.worker.terminate();
    };
  }, [ctl, perf]);

  const status = ctl.status;
  const settings = status?.settings ?? null;
  const view = ctl.view;
  const balloonOn = ctl.balloon.enabled;
  const scenario = ctl.scenario;

  const pick = (id: string) => {
    location.hash = id;
    ctl.loadScenario(id);
  };

  return (
    <div class="app-shell">
      <header class="app-header">
        <h1>VentSim</h1>
        <span class="muted small">v{APP_VERSION}</span>
        <ScenarioPicker current={scenario} onPick={pick} />
        <TruthToggle on={view.truth} onChange={(on) => ctl.setTruth(on)} />
        <label class="inline balloon-toggle">
          <input type="checkbox" checked={balloonOn} onChange={(e) => ctl.setBalloon({ ...defaultBalloon(), ...ctl.balloon, enabled: (e.currentTarget).checked })} data-testid="balloon-toggle" />
          <span class="small">Esophageal balloon</span>
        </label>
      </header>
      <AlarmBar active={status?.alarms ?? []} inBackup={status?.inBackup ?? false} pendingCount={status?.pending.length ?? 0} />
      <main class="app-main" data-testid="app-main">
        <aside class="col-left">
          {settings && <SettingsPanel ctl={ctl} settings={settings} pendingOnVent={status?.pending ?? []} />}
        </aside>
        <section class="col-center">
          <TimeControls ctl={ctl} view={view} tLatest={ctl.store.tLatest} tOldest={ctl.store.tOldest} />
          <WaveformCanvas ctl={ctl} truth={view.truth} balloon={balloonOn} perf={perf} />
          <div class="drawer">
            <LoopCanvas ctl={ctl} loops={view.truth ? [...BEDSIDE_LOOPS, ...TRUTH_LOOPS] : BEDSIDE_LOOPS} ecw={ctl.patient?.ecw ?? null} />
            {scenario && (
              <div class="scenario-info" data-testid="scenario-info">
                <button type="button" class="link" onClick={() => setShowObjectives(!showObjectives)} aria-expanded={showObjectives}>
                  {showObjectives ? '▾' : '▸'} {scenario.title}
                </button>
                {showObjectives && (
                  <div class="small">
                    <p>{scenario.summary}</p>
                    <ul>
                      {scenario.objectives.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                    <p class="muted">
                      Phenotype: {scenario.phenotype} · seed {String(scenario.seed)} · {scenario.drive ? 'spontaneous effort' : 'passive'}
                      {scenario.targetPatterns.length ? ` · target: ${scenario.targetPatterns.join(', ')}` : ''}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        <aside class="col-right">
          {settings && (
            <MonitorPanel
              ctl={ctl}
              m={ctl.latestBreath}
              maneuvers={ctl.maneuvers}
              settings={settings}
              rrTotal={ctl.monitor.rrTotal}
              veMinute={ctl.monitor.veMinute}
              busy={status?.phase === 'exp-hold' || status?.phase === 'occlusion'}
            />
          )}
          {settings && (
            <LungStressDashboard
              m={ctl.latestBreath}
              truth={ctl.latestTruth}
              truthOn={view.truth}
              maneuvers={ctl.maneuvers}
              settings={settings}
              balloon={balloonOn}
              rrTotal={ctl.monitor.rrTotal}
            />
          )}
        </aside>
      </main>
      <footer class="app-footer" data-testid="disclaimer">
        {DISCLAIMER}
      </footer>
    </div>
  );
}
