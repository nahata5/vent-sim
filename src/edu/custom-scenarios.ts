/**
 * "My scenarios" (Spec 2026-09-14 §5.3): validated scenarios pasted into the Instructor editor, kept in
 * localStorage as one versioned JSON document (guarded like the progress store) and listed in the picker.
 */
import { browserStorage, type KeyValueStorage } from './progress';
import { SCENARIOS, type ScenarioDef } from './scenarios';

export const CUSTOM_KEY = 'ventsim.custom.v1';

interface CustomDoc {
  version: 1;
  scenarios: ScenarioDef[];
}

export function isShippedScenario(id: string): boolean {
  return SCENARIOS.some((s) => s.id === id);
}

export class CustomScenarioStore {
  private doc: CustomDoc;
  private storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = browserStorage()) {
    this.storage = storage;
    this.doc = this.load();
  }

  private load(): CustomDoc {
    try {
      const raw = this.storage.getItem(CUSTOM_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CustomDoc>;
        if (parsed.version === 1 && Array.isArray(parsed.scenarios)) return { version: 1, scenarios: parsed.scenarios };
      }
    } catch {
      /* corrupt or blocked: start empty */
    }
    return { version: 1, scenarios: [] };
  }

  private persist(): void {
    try {
      this.storage.setItem(CUSTOM_KEY, JSON.stringify(this.doc));
    } catch {
      /* full or blocked: keep the in-memory copy */
    }
  }

  all(): ScenarioDef[] {
    return this.doc.scenarios.slice();
  }

  get(id: string): ScenarioDef | null {
    return this.doc.scenarios.find((s) => s.id === id) ?? null;
  }

  save(def: ScenarioDef): { ok: true } | { ok: false; error: string } {
    if (isShippedScenario(def.id)) return { ok: false, error: `"${def.id}" is a built-in scenario; choose another id` };
    const i = this.doc.scenarios.findIndex((s) => s.id === def.id);
    if (i >= 0) this.doc.scenarios[i] = def;
    else this.doc.scenarios.push(def);
    this.persist();
    return { ok: true };
  }

  remove(id: string): void {
    this.doc.scenarios = this.doc.scenarios.filter((s) => s.id !== id);
    this.persist();
  }

  exportJson(id: string): string | null {
    const d = this.get(id);
    return d ? JSON.stringify(d, null, 2) : null;
  }
}
