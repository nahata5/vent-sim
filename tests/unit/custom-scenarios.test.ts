import { describe, expect, it } from 'vitest';
import { CUSTOM_KEY, CustomScenarioStore } from '@/edu/custom-scenarios';
import { EXAMPLE_SCENARIO } from '@/edu/authoring';
import type { KeyValueStorage } from '@/edu/progress';

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('custom scenario store', () => {
  it('saves, lists in insertion order, overwrites by id, exports and removes; persists as one JSON document', () => {
    const s = memoryStorage();
    const store = new CustomScenarioStore(s);
    expect(store.all()).toEqual([]);
    expect(store.save(EXAMPLE_SCENARIO)).toEqual({ ok: true });
    expect(store.save({ ...EXAMPLE_SCENARIO, id: 'second', title: 'Second' })).toEqual({ ok: true });
    expect(store.all().map((d) => d.id)).toEqual([EXAMPLE_SCENARIO.id, 'second']);
    expect(store.save({ ...EXAMPLE_SCENARIO, title: 'Renamed' })).toEqual({ ok: true });
    expect(store.get(EXAMPLE_SCENARIO.id)?.title).toBe('Renamed');
    expect(store.all()).toHaveLength(2);
    expect((JSON.parse(store.exportJson('second') ?? '{}') as { title: string }).title).toBe('Second');
    expect(store.exportJson('nope')).toBeNull();
    const again = new CustomScenarioStore(s);
    expect(again.all()).toHaveLength(2);
    expect((JSON.parse(s.map.get(CUSTOM_KEY) ?? '{}') as { version: number }).version).toBe(1);
    again.remove('second');
    expect(again.all().map((d) => d.id)).toEqual([EXAMPLE_SCENARIO.id]);
  });

  it('refuses an id that belongs to a shipped scenario', () => {
    const store = new CustomScenarioStore(memoryStorage());
    const r = store.save({ ...EXAMPLE_SCENARIO, id: 'copd' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/"copd" is a built-in scenario/);
    expect(store.all()).toEqual([]);
  });

  it('survives a corrupt document and a throwing storage', () => {
    const s = memoryStorage();
    s.map.set(CUSTOM_KEY, '{not json');
    expect(new CustomScenarioStore(s).all()).toEqual([]);
    const throwing: KeyValueStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    const store = new CustomScenarioStore(throwing);
    expect(store.save(EXAMPLE_SCENARIO)).toEqual({ ok: true });
    expect(store.all()).toHaveLength(1);
  });
});
