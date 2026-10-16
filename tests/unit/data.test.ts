import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (file: string): unknown => JSON.parse(readFileSync(`data/${file}`, 'utf8'));

interface Cat {
  id: string;
  name: string;
  age: 'kitten' | 'adult' | 'senior';
  catnipResponder: boolean;
  harness: 'onceBonded' | 'never';
  traits: Record<string, number>;
  likedZones?: string[];
  dislikedZones?: string[];
  maxAffinityRange: [number, number];
  voicePitch: number;
}

const cats = load('cats.json') as { zones: string[]; defaults: { likedZones: string[]; dislikedZones: string[] }; cats: Cat[] };

describe('data/cats.json', () => {
  it('holds the eight resident cats from the README roster', () => {
    expect(cats.cats.map((cat) => cat.name)).toEqual([
      'Mochi', 'Waffles', 'Pepper', 'Biscuit', 'Clementine', 'Juniper', 'Pixel', 'Duchess',
    ]);
    expect(new Set(cats.cats.map((cat) => cat.id)).size).toBe(cats.cats.length);
  });

  it('keeps every trait and affinity range inside 0..1', () => {
    for (const cat of cats.cats) {
      for (const [trait, value] of Object.entries(cat.traits)) {
        expect(value, `${cat.id}.${trait}`).toBeGreaterThanOrEqual(0);
        expect(value, `${cat.id}.${trait}`).toBeLessThanOrEqual(1);
      }
      const [low, high] = cat.maxAffinityRange;
      expect(low, `${cat.id} range`).toBeGreaterThanOrEqual(0.2);
      expect(high, `${cat.id} range`).toBeLessThanOrEqual(1);
      expect(low, `${cat.id} range`).toBeLessThan(high);
    }
  });

  it('names only known petting zones', () => {
    const zones = new Set(cats.zones);
    const used = [cats.defaults, ...cats.cats].flatMap((entry) => [...(entry.likedZones ?? []), ...(entry.dislikedZones ?? [])]);
    for (const zone of used) expect(zones, zone).toContain(zone);
  });

  it('follows the catnip and harness rules', () => {
    for (const cat of cats.cats.filter((c) => c.age === 'kitten')) {
      expect(cat.catnipResponder, `${cat.id} is too young for catnip`).toBe(false);
      expect(cat.harness, `${cat.id} is too young for walks`).toBe('never');
    }
    const adults = cats.cats.filter((c) => c.age !== 'kitten');
    const responders = adults.filter((c) => c.catnipResponder).length / adults.length;
    expect(responders).toBeGreaterThanOrEqual(0.6);
    expect(responders).toBeLessThan(1);
  });
});

describe('data/economy.json', () => {
  const economy = load('economy.json') as {
    chores: Record<string, { pays: number }>;
    perks: Record<string, { cost: number }>;
  };

  it('pays C$1–3 per chore and charges C$5–20 per perk (decision D14)', () => {
    for (const { pays } of Object.values(economy.chores)) expect(pays).toBeGreaterThanOrEqual(1);
    for (const { pays } of Object.values(economy.chores)) expect(pays).toBeLessThanOrEqual(3);
    for (const { cost } of Object.values(economy.perks)) expect(cost).toBeGreaterThanOrEqual(5);
    for (const { cost } of Object.values(economy.perks)) expect(cost).toBeLessThanOrEqual(20);
  });
});

describe('data/flags.json', () => {
  it('lists flags with unique ids and a milestone each', () => {
    const { flags } = load('flags.json') as { flags: { id: string; milestone: string; description: string }[] };
    expect(new Set(flags.map((flag) => flag.id)).size).toBe(flags.length);
    for (const flag of flags) {
      expect(flag.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(flag.milestone).toMatch(/^M\d+$/);
      expect(flag.description.length).toBeGreaterThan(0);
    }
  });
});
