/**
 * Learner progress (Spec §8): attempts and best scores per scenario, stored as one JSON document in
 * localStorage under a versioned key. Every storage access is wrapped so a blocked, full or absent
 * storage degrades to an in-memory record for the session.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface QuizAttempt {
  score: number;
  identification: number;
  fixPassed: boolean;
  seconds: number;
  changes: number;
  /** Epoch ms. */
  at: number;
}

export interface ScenarioProgress {
  attempts: number;
  best: number;
  passed: boolean;
  lastAt: number;
  history: QuizAttempt[];
}

interface ProgressDoc {
  version: 1;
  scenarios: Record<string, ScenarioProgress>;
}

export const PROGRESS_KEY = 'ventsim.progress.v1';
const HISTORY_MAX = 10;

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** `localStorage` when it exists and works, otherwise memory. */
export function browserStorage(): KeyValueStorage {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (ls) {
      ls.getItem(PROGRESS_KEY);
      return ls;
    }
  } catch {
    /* blocked */
  }
  return memoryStorage();
}

export class ProgressStore {
  private doc: ProgressDoc;
  private storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = browserStorage()) {
    this.storage = storage;
    this.doc = this.load();
  }

  private load(): ProgressDoc {
    try {
      const raw = this.storage.getItem(PROGRESS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ProgressDoc>;
        if (parsed && parsed.version === 1 && parsed.scenarios && typeof parsed.scenarios === 'object') return { version: 1, scenarios: parsed.scenarios };
      }
    } catch {
      /* corrupt or blocked: start fresh */
    }
    return { version: 1, scenarios: {} };
  }

  private save(): void {
    try {
      this.storage.setItem(PROGRESS_KEY, JSON.stringify(this.doc));
    } catch {
      // Quota or blocked storage: keep the in-memory document and switch to memory for the session.
      const mem = memoryStorage();
      try {
        mem.setItem(PROGRESS_KEY, JSON.stringify(this.doc));
        this.storage = mem;
      } catch {
        /* unreachable */
      }
    }
  }

  record(scenarioId: string, attempt: QuizAttempt): ScenarioProgress {
    const cur = this.doc.scenarios[scenarioId] ?? { attempts: 0, best: 0, passed: false, lastAt: 0, history: [] };
    const next: ScenarioProgress = {
      attempts: cur.attempts + 1,
      best: Math.max(cur.best, attempt.score),
      passed: cur.passed || attempt.fixPassed,
      lastAt: attempt.at,
      history: [...cur.history, attempt].slice(-HISTORY_MAX),
    };
    this.doc.scenarios[scenarioId] = next;
    this.save();
    return next;
  }

  get(scenarioId: string): ScenarioProgress | null {
    return this.doc.scenarios[scenarioId] ?? null;
  }

  all(): Record<string, ScenarioProgress> {
    return { ...this.doc.scenarios };
  }

  summary(): { scenarios: number; passed: number; attempts: number } {
    const list = Object.values(this.doc.scenarios);
    return { scenarios: list.length, passed: list.filter((s) => s.passed).length, attempts: list.reduce((s, x) => s + x.attempts, 0) };
  }

  reset(): void {
    this.doc = { version: 1, scenarios: {} };
    try {
      this.storage.removeItem(PROGRESS_KEY);
    } catch {
      /* blocked */
    }
  }
}
