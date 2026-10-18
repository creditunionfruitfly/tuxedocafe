import { expect, it } from 'vitest';
import catalog from '../../data/animation-catalog.json' with { type: 'json' };
import cats from '../../data/cats.json' with { type: 'json' };
import { createRng } from '../../src/core/rng.ts';
import { ROOM } from '../../src/scenes/collision.ts';
import { walkable } from '../../src/scenes/navigation.ts';
import { Brain, pairOf } from '../../src/cats/brain.ts';
import { residentLod, residentScale, startSpot } from '../../src/cats/resident.ts';

const DT = 1 / 30;
function simulate(seed: string, minutes: number) {
  const world = createRng(seed), placed: { x: number; z: number }[] = [];
  const brains = cats.cats.map(cat => { const rng = world.fork(`cat:${cat.id}`), start = startSpot(rng, placed); placed.push(start); return new Brain(cat.id, rng, start, residentScale(cat.id)); });
  const walker = world.fork('patron'), player = { x: 0, z: 1.5 }, seen = new Set<string>(), trace: number[] = [];
  let goal = { x: 0, z: 0 }, out = 0;
  for (let i = 0; i < minutes * 60 * 30; i++) {
    // A patron who strolls, and sometimes hurries straight at a cat.
    if (i % 300 === 0) { const cat = walker.pick(brains).mover; goal = walker.next() < .5 ? { x: cat.x, z: cat.z } : { x: walker.range(-4, 4), z: walker.range(-1, 2.5) }; }
    const dx = goal.x - player.x, dz = goal.z - player.z, d = Math.hypot(dx, dz), speed = i % 900 < 300 ? 2 : 1;
    if (d > .3) { const nx = player.x + dx / d * speed * DT, nz = player.z + dz / d * speed * DT; if (walkable(nx, nz)) { player.x = nx; player.z = nz; } }
    for (const brain of brains) {
      brain.step(DT, { player, cats: brains });
      const m = brain.mover;
      if (brain.action) seen.add(brain.action); for (const name of [...brain.pulses, ...brain.layers]) seen.add(name);
      const v = m.speed / brain.scale; seen.add(v < .05 ? 'cat.loco.idle' : v < 1.15 ? 'cat.loco.walk' : v < 2.5 ? 'cat.loco.trot' : 'cat.loco.gallop');
      if (m.x < ROOM.minX || m.x > ROOM.maxX || m.z < ROOM.minZ || m.z > ROOM.maxZ) out++;
    }
    if (i % 900 === 0) trace.push(...brains.map(b => Math.round(b.mover.x * 100)));
  }
  return { seen, trace, out, brains };
}

it('plays every non-perk clip in the catalog when behaviour calls for it', () => {
  const { seen, out } = simulate('cafe', 90);
  const missing = catalog.clips.map(clip => clip.name).filter(name => !name.startsWith('cat.perk.') && !seen.has(name));
  expect(missing).toEqual([]);
  expect([...seen].filter(name => name.startsWith('cat.perk.'))).toEqual([]);
  expect(out).toBe(0);
}, 60_000);
it('is deterministic per seed and needs stay in range', { timeout: 30_000 }, () => {
  const a = simulate('cafe', 3), b = simulate('cafe', 3), c = simulate('other', 3);
  expect(b.trace).toEqual(a.trace); expect(c.trace).not.toEqual(a.trace);
  for (const brain of a.brains) { for (const value of Object.values(brain.needs)) expect(value).toBeGreaterThanOrEqual(0); expect(brain.affinity).toBeLessThanOrEqual(brain.cap); }
});
it('reads the pair matrix in either order', () => { expect(pairOf('waffles', 'mochi')).toBe('friendly'); expect(pairOf('pixel', 'juniper')).toBe('tense'); expect(pairOf('mochi', 'pixel')).toBe('neutral'); });
it('places the cast apart on open floor and sizes each cat from its build', () => {
  const taken: { x: number; z: number }[] = [];
  for (let i = 0; i < 8; i++) { const spot = startSpot(createRng('cafe').fork(`cat:${i}`), taken); expect(walkable(spot.x, spot.z)).toBe(true); expect(taken.every(t => Math.hypot(t.x - spot.x, t.z - spot.z) > .8)).toBe(true); taken.push(spot); }
  expect(residentScale('clementine')).toBeCloseTo(.6); expect(residentScale('waffles')).toBeCloseTo(1.06); expect(residentLod('phone')).toBe('lod1');
});
