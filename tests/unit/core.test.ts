import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EventBus } from '../../src/core/events.ts';
import { FixedLoop } from '../../src/core/loop.ts';
import { parseFlags } from '../../src/core/flags.ts';
import { SaveStore, migrateSave, storageKey } from '../../src/core/storage.ts';
describe('engine core', () => {
  it('removes event subscriptions without stray listeners', () => {
    const bus = new EventBus<{ n: number }>(); let n = 0;
    const off = bus.on('n', value => n += value); bus.emit('n', 2); off(); bus.emit('n', 4); expect(n).toBe(2);
  });
  it('runs 30 fixed steps per second at any render rate and bounds catch-up', () => {
    for (const fps of [30, 60, 144]) { let n = 0; const loop = new FixedLoop(() => n++, () => {}); for (let i = 0; i <= fps; i++) loop.frame(i * 1000 / fps); expect(n).toBe(30); }
    let n = 0; const loop = new FixedLoop(() => n++, () => {}); loop.frame(0); loop.frame(10000); expect(n).toBe(5);
    loop.paused = true; loop.frame(20000); expect(n).toBe(5);
  });
  it('only enables known query flags', () => { const warnings: string[] = []; expect([...parseFlags(['a'], '?flags=a,b', message => warnings.push(message))]).toEqual(['a']); expect(warnings).toHaveLength(1); });
  it('migrates once per version and rejects newer saves', () => {
    expect(migrateSave({ schemaVersion: 0 }, 1, { 0: s => ({ ...s, schemaVersion: 1, ok: true }) })).toMatchObject({ schemaVersion: 1, ok: true });
    expect(() => migrateSave({ schemaVersion: 2 }, 1, {})).toThrow();
  });
  it('backs up corrupt saves in the channel and recovers when storage is blocked', async () => {
    const memory = new Map<string, string>(); const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
    const corrupt = readFileSync(new URL('../fixtures/saves/corrupt.json', import.meta.url), 'utf8'); memory.set(storageKey('m1', 'visit'), corrupt);
    const store = new SaveStore('m1', storage, () => ({ schemaVersion: 1, ok: true })); expect(await store.load('visit')).toMatchObject({ ok: true }); expect(memory.get(storageKey('m1', 'visit:backup'))).toBe(corrupt);
    expect(storageKey('main', 'visit')).not.toBe(storageKey('m1', 'visit'));
    const blocked = new SaveStore('pr', { getItem: () => { throw 0; }, setItem: () => { throw 0; } }, () => ({ schemaVersion: 1, ok: false })); await blocked.save('visit', { schemaVersion: 1, ok: true }); expect(await blocked.load('visit')).toMatchObject({ ok: true });
  });
});
