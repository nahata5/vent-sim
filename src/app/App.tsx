import { APP_VERSION } from '../config/version';

export const DISCLAIMER =
  'VentSim is for education only. It is not a medical device and not a clinical decision aid.';

export function App() {
  return (
    <div class="app-shell">
      <header class="app-header">
        <h1>VentSim</h1>
        <span class="muted">v{APP_VERSION}</span>
      </header>
      <main class="app-main" data-testid="app-main">
        <p class="muted">Simulator scaffold. Physics arrives in M1.</p>
      </main>
      <footer class="app-footer" data-testid="disclaimer">
        {DISCLAIMER}
      </footer>
    </div>
  );
}
