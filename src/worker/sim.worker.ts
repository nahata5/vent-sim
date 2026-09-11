/**
 * Simulation Web Worker: a thin timer shell around SimSession. Wall-clock × speed is accumulated and the
 * session advanced by whole physics steps; sample batches go out as transferable Float32Arrays.
 */
import { SimSession } from './session';
import { BATCH_CHANNELS, type MainToWorker, type WorkerToMain } from './protocol';

const TICK_MS = 20;
/** Cap on simulated time per tick so a background tab does not spiral when it wakes. */
const MAX_SIM_PER_TICK = 0.25;
const STATUS_EVERY_MS = 200;

let session: SimSession | null = null;
let speed = 1;
let paused = false;
let lastWall = 0;
let lastStatus = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const ctx = self as unknown as { postMessage: (m: WorkerToMain, transfer?: Transferable[]) => void };

function post(m: WorkerToMain, transfer?: Transferable[]): void {
  ctx.postMessage(m, transfer);
}

function postStatus(): void {
  if (!session) return;
  post({ type: 'status', status: session.status(), speed, paused });
}

function tick(): void {
  if (!session) return;
  const now = performance.now();
  const wallDt = (now - lastWall) / 1000;
  lastWall = now;
  if (!paused) {
    const simDt = Math.min(MAX_SIM_PER_TICK, wallDt * speed);
    const out = session.advance(simDt);
    if (out.n > 0 || out.events.length || out.breaths.length || out.neural.length) {
      post(
        { type: 'tick', n: out.n, t0: out.t0, t1: out.t1, samples: out.samples, events: out.events, breaths: out.breaths, neural: out.neural },
        [out.samples.buffer],
      );
    }
  }
  if (now - lastStatus >= STATUS_EVERY_MS) {
    lastStatus = now;
    postStatus();
  }
}

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      if (timer !== null) clearInterval(timer);
      session = new SimSession(msg.scenario);
      paused = false;
      lastWall = performance.now();
      lastStatus = 0;
      post({ type: 'ready', fs: session.fs, channels: BATCH_CHANNELS, patient: session.patientSummary(), status: session.status() });
      timer = setInterval(tick, TICK_MS);
      break;
    }
    case 'applySettings':
      session?.applySettings(msg.partial);
      postStatus();
      break;
    case 'setBalloon':
      session?.setBalloon(msg.balloon);
      postStatus();
      break;
    case 'maneuver':
      session?.requestManeuver(msg.kind);
      break;
    case 'inject':
      session?.inject(msg.kind, msg.params);
      postStatus();
      break;
    case 'setPatient':
      session?.setDriveParams(msg.drive);
      break;
    case 'setSpeed':
      speed = Math.min(4, Math.max(0.25, msg.speed));
      postStatus();
      break;
    case 'pause':
      paused = true;
      postStatus();
      break;
    case 'resume':
      paused = false;
      lastWall = performance.now();
      postStatus();
      break;
  }
};
