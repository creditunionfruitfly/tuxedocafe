import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../../src/core/rng.ts';

describe('createRng', () => {
  it('repeats exactly for the same seed', () => {
    const a = createRng('save:4f2a');
    const b = createRng('save:4f2a');
    expect(Array.from({ length: 8 }, () => a.next())).toEqual(Array.from({ length: 8 }, () => b.next()));
  });

  it('differs for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('stays in [0, 1) with a mean near 0.5', () => {
    const rng = createRng(42);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 20_000).toBeCloseTo(0.5, 1);
  });

  it('keeps int() inside its inclusive bounds and reaches both ends', () => {
    const rng = createRng('dice');
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(rng.int(1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(() => rng.int(3, 1)).toThrow(RangeError);
  });

  it('gives forks their own streams that ignore calls on the parent', () => {
    const parent = createRng('world');
    const mochiFirst = parent.fork('cat:mochi').next();
    parent.next();
    parent.next();
    expect(parent.fork('cat:mochi').next()).toBe(mochiFirst);
    expect(parent.fork('cat:pixel').next()).not.toBe(mochiFirst);
  });

  it('draws exponential waits with the requested mean', () => {
    const rng = createRng('waits');
    let sum = 0;
    for (let i = 0; i < 20_000; i++) sum += rng.exponential(180);
    expect(sum / 20_000).toBeGreaterThan(170);
    expect(sum / 20_000).toBeLessThan(190);
  });

  it('refuses to pick from an empty list', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });
});

describe('hashSeed', () => {
  it('is stable across runs and platforms', () => {
    expect(hashSeed('tuxedo')).toBe(hashSeed('tuxedo'));
    expect(hashSeed('')).toBe(0x811c9dc5);
  });
});
