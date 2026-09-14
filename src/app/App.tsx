import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import { InjectorPanel } from '../ui/InjectorPanel';
import { ValidationPage } from '../ui/ValidationPage';
import { Co2Panel } from '../ui/Co2Panel';
import { ExplainCard } from '../ui/ExplainCard';
import { QuizPanel } from '../ui/QuizPanel';
import { InstructorPanel } from '../ui/InstructorPanel';
import { ExportPanel } from '../ui/ExportPanel';
import { HelpDialog, HELP_SEEN_KEY } from '../ui/HelpDialog';
import { browserStorage } from '../edu/progress';
import type { DrawerTab } from './controller';
import { defaultBalloon } from '../sim/patient/balloon';
import type { BadgeHit } from '../ui/waveform-draw';
import { parseQuizHash } from '../edu/quiz-view';
import { usePhoneLayout } from '../ui/breakpoints';

/** Phone layout (D-020): one panel at a time below the pinned waveforms, chosen from the bottom tab bar. */
type MobileTab = 'vent' | 'monitor' | 'loops' | 'learn';
const MOBILE_TABS: Array<[MobileTab, string]> = [
  ['vent', 'Vent'],
  ['monitor', 'Monitor'],
  ['loops', 'Loops'],
  ['learn', 'Learn'],
];

export const DISCLAIMER =
  'VentSim is for education only. It is not a medical device and not a clinical decision aid.';

declare global {
  interface Window {
    __ventsim?: { ctl: SessionController; perf: PerfStats; hits: BadgeHit[] };
  }
}

const DEFAULT_SCENARIO = SCENARIOS[0]?.id ?? 'normal-passive';
const VALIDATION_HASH = 'validation';

/** Page part of the hash: `#copd?quiz=bedside` → `copd`; `#validation` → `validation`. */
function hashPage(): string {
  return location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
}

export function App() {
  const ctl = useMemo(() => new SessionController(), []);
  const perf = useMemo<PerfStats>(() => ({ frames: 0, drawMs: 0, lastFps: 0 }), []);
  const hits = useMemo<BadgeHit[]>(() => [], []);
  const [, setTick] = useState(0);
  const [showObjectives, setShowObjectives] = useState(true);
  const [page, setPage] = useState(hashPage());
  const [fixApplied, setFixApplied] = useState(false);
  const [help, setHelp] = useState<boolean>(() => {
    try {
      return browserStorage().getItem(HELP_SEEN_KEY) === null;
    } catch {
      return false;
    }
  });
  const closeHelp = () => {
    setHelp(false);
    try {
      browserStorage().setItem(HELP_SEEN_KEY, '1');
    } catch {
      /* blocked */
    }
  };
  const phone = usePhoneLayout();
  const [mtab, setMtab] = useState<MobileTab>('vent');
  // When the controller opens a drawer tab on its own (badge tap → Explain, quiz start → Quiz), the phone shows Learn.
  const prevDrawerTab = useRef(ctl.view.drawerTab);
  useEffect(() => {
    if (prevDrawerTab.current !== ctl.view.drawerTab) {
      prevDrawerTab.current = ctl.view.drawerTab;
      if (phone) setMtab('learn');
    }
  });

  useEffect(() => {
    window.__ventsim = { ctl, perf, hits };
    const unsub = ctl.subscribe(() => setTick((n) => n + 1));
    const fromHash = () => {
      const hash = hashPage();
      return ctl.hasScenario(hash) ? hash : DEFAULT_SCENARIO;
    };
    // A quiz link (`#<id>?quiz=…`, D-019) applies its hide set and locks the session.
    const applyQuizLink = () => {
      const info = parseQuizHash(location.hash);
      if (info?.locked && info.scenarioId === ctl.scenario?.id) ctl.lockQuiz(info.hide);
    };
    if (hashPage() !== VALIDATION_HASH) {
      try {
        ctl.loadScenario(fromHash());
      } catch {
        // A stale hash (e.g. a deleted custom scenario link) points at an id that no longer resolves.
        ctl.loadScenario(DEFAULT_SCENARIO);
      }
      applyQuizLink();
    }
    const onHash = () => {
      setPage(hashPage());
      if (hashPage() === VALIDATION_HASH) return;
      const id = fromHash();
      if (id !== ctl.scenario?.id) {
        setFixApplied(false);
        try {
          ctl.loadScenario(id);
        } catch {
          ctl.loadScenario(DEFAULT_SCENARIO);
        }
      }
      applyQuizLink();
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
  }, [ctl, perf, hits]);

  const status = ctl.status;
  const settings = status?.settings ?? null;
  const view = ctl.view;
  const balloonOn = ctl.balloon.enabled;
  const scenario = ctl.scenario;
  // Bedside quiz view (D-019): what is hidden right now (only while a quiz runs or the session is locked).
  const hideTruth = ctl.quizHides('truth');
  const hidePes = ctl.quizHides('pes');
  const hideScenario = ctl.quizHides('scenario');
  const hideDerived = ctl.quizHides('derived');
  const hideExplain = ctl.quizHides('explain');
  const hideCo2 = ctl.quizHides('co2');
  const locked = view.quizLocked;
  const truthOn = view.truth && !hideTruth;
  const pesOn = balloonOn && !hidePes;
  const tabs = (['scenario', 'explain', 'quiz', 'export'] as DrawerTab[]).filter((t) => !(hideExplain && t === 'explain'));

  // Header controls on the desktop and tablet; the top of the Vent tab on a phone (D-020).
  const toggles = (
    <>
      <TruthToggle on={truthOn} onChange={(on) => ctl.setTruth(on)} disabled={locked || hideTruth} />
      <label class="inline balloon-toggle">
        <input type="checkbox" checked={balloonOn} onChange={(e) => ctl.setBalloon({ ...defaultBalloon(), ...ctl.balloon, enabled: (e.currentTarget).checked })} data-testid="balloon-toggle" />
        <span class="small">Esophageal balloon</span>
      </label>
    </>
  );
  const co2Panel = status?.co2 && !hideCo2 ? <Co2Panel co2={status.co2} onWarp={(w) => ctl.setWarp(w)} /> : null;

  const pick = (id: string) => {
    location.hash = id;
    setPage(id);
    setFixApplied(false);
    ctl.loadScenario(id);
  };

  if (page === VALIDATION_HASH) {
    return (
      <div class="app-shell">
        <header class="app-header">
          <h1>VentSim</h1>
          <span class="muted small">v{APP_VERSION} · validation</span>
        </header>
        <ValidationPage />
        <footer class="app-footer" data-testid="disclaimer">
          {DISCLAIMER}
        </footer>
      </div>
    );
  }

  return (
    <div class="app-shell">
      <header class="app-header">
        <h1>VentSim</h1>
        <button type="button" class="link help-open" onClick={() => setHelp(true)} aria-label="How to use VentSim" title="How to use VentSim" data-testid="help-open">
          ?
        </button>
        {!phone && <span class="muted small">v{APP_VERSION}</span>}
        <ScenarioPicker current={scenario} onPick={pick} progress={ctl.progress.all()} custom={ctl.customScenarios.all()} disabled={locked} mask={hideScenario} />
        {!phone && toggles}
        {!phone && !hideDerived && (
          <a class="small muted" href="#validation" data-testid="validation-link">
            Validation
          </a>
        )}
      </header>
      <AlarmBar active={status?.alarms ?? []} inBackup={status?.inBackup ?? false} pendingCount={status?.pending.length ?? 0} />
      <main class="app-main" data-testid="app-main" data-mtab={phone ? mtab : undefined}>
        <aside class="col-left">
          {phone && (
            <div class="panel view-toggles" data-testid="view-toggles">
              {toggles}
            </div>
          )}
          {settings && <SettingsPanel ctl={ctl} settings={settings} pendingOnVent={status?.pending ?? []} />}
          {status && <InjectorPanel ctl={ctl} active={status.injectors} />}
          {!phone && co2Panel}
          {status && !locked && <InstructorPanel ctl={ctl} />}
        </aside>
        <section class="col-center">
          <TimeControls ctl={ctl} view={view} tLatest={ctl.store.tLatest} tOldest={ctl.store.tOldest} />
          <WaveformCanvas ctl={ctl} truth={truthOn} balloon={pesOn} perf={perf} hits={hits} />
          <div class="drawer">
            <LoopCanvas ctl={ctl} loops={truthOn ? [...BEDSIDE_LOOPS, ...TRUTH_LOOPS] : BEDSIDE_LOOPS} ecw={ctl.patient?.ecw ?? null} />
            <div class="drawer-pane" data-testid="drawer-pane">
              <div class="tabs" role="tablist">
                {tabs.map((tab) => (
                  <button type="button" key={tab} role="tab" aria-selected={view.drawerTab === tab} class={view.drawerTab === tab ? 'active' : ''} onClick={() => ctl.setDrawerTab(tab)} data-testid={`tab-${tab}`}>
                    {tab === 'scenario' ? 'Scenario' : tab === 'explain' ? 'Explain' : tab === 'quiz' ? 'Quiz' : 'Export'}
                  </button>
                ))}
              </div>
              {view.drawerTab === 'scenario' && scenario && (
                <div class="scenario-info" data-testid="scenario-info">
                  {hideScenario && <p class="small muted">Case · scenario details are hidden for this quiz.</p>}
                  {!hideScenario && (
                    <button type="button" class="link" onClick={() => setShowObjectives(!showObjectives)} aria-expanded={showObjectives}>
                      {showObjectives ? '▾' : '▸'} {scenario.title}
                    </button>
                  )}
                  {!hideScenario && showObjectives && (
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
                      {scenario.fix && (
                        <div class="scenario-fix">
                          <button
                            type="button"
                            class="primary"
                            disabled={fixApplied}
                            data-testid="apply-fix"
                            onClick={() => {
                              if (scenario.fix) ctl.applyFix(scenario.fix);
                              setFixApplied(true);
                            }}
                          >
                            {fixApplied ? 'Fix applied' : 'Apply suggested fix'}
                          </button>
                          <span class="muted">{scenario.fix.note}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {view.drawerTab === 'explain' && !hideExplain && <ExplainCard ctl={ctl} />}
              {view.drawerTab === 'quiz' && <QuizPanel ctl={ctl} />}
              {view.drawerTab === 'export' && <ExportPanel ctl={ctl} hideTruth={locked} validationLink={phone && !hideDerived} />}
            </div>
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
              ai={ctl.ai}
              spo2={ctl.latestSpo2}
              hideBalloonTiles={hidePes || hideDerived}
              simv={settings?.mode === 'SIMV' ? ctl.simvRates() : null}
              prvcDp={status?.prvcDp ?? null}
            />
          )}
          {settings && !hideDerived && (
            <LungStressDashboard
              m={ctl.latestBreath}
              truth={ctl.latestTruth}
              recruit={ctl.latestRecruit}
              truthOn={truthOn}
              maneuvers={ctl.maneuvers}
              settings={settings}
              balloon={pesOn}
              rrTotal={ctl.monitor.rrTotal}
            />
          )}
          {phone && co2Panel}
        </aside>
        {phone && (
          <nav class="mobile-tabs" role="tablist" aria-label="Panels" data-testid="mobile-tabs">
            {MOBILE_TABS.map(([id, label]) => (
              <button type="button" key={id} role="tab" aria-selected={mtab === id} onClick={() => setMtab(id)} data-testid={`mtab-${id}`}>
                {label}
              </button>
            ))}
          </nav>
        )}
      </main>
      <footer class="app-footer" data-testid="disclaimer">
        {DISCLAIMER}
      </footer>
      <HelpDialog open={help} onClose={closeHelp} />
    </div>
  );
}
