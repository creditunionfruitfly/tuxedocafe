import { expect, it } from 'vitest';
import { createRng } from '../../src/core/rng.ts';
import { walkable } from '../../src/scenes/navigation.ts';
import { blocked, FURNITURE, ROOM } from '../../src/scenes/collision.ts';
import { WALK_SPEED, Wander } from '../../src/cats/wander.ts';
import { residentLod, residentScale, startSpot } from '../../src/cats/resident.ts';

const inside = (cat: Wander) => cat.x > ROOM.minX && cat.x < ROOM.maxX && cat.z > ROOM.minZ && cat.z < ROOM.maxZ && FURNITURE.every(box => !blocked(cat.x, cat.z, box, .15));
const run = (seed: string) => { const cat = new Wander(createRng(seed).fork('cat:mochi'), { x: .6, z: -1.5 }); const trace: number[] = []; for (let i = 0; i < 30 * 120; i++) { cat.step(1 / 30); expect(cat.speed).toBeLessThanOrEqual(WALK_SPEED + 1e-9); expect(inside(cat)).toBe(true); if (i % 30 === 0) trace.push(cat.x, cat.z); } return trace; };
it('wanders the open floor deterministically from its own seed', () => {
  expect(walkable(.6, -1.5)).toBe(true);
  const a = run('cafe'); expect(run('cafe')).toEqual(a); expect(run('other')).not.toEqual(a);
  expect(new Set(a.map(v => v.toFixed(1))).size).toBeGreaterThan(10);
});
it('never picks a stroll target the avoid test rejects', () => {
  const cat = new Wander(createRng('cafe'), { x: .6, z: -1.5 }, { speed: .5, avoid: x => x > 0 });
  for (let i = 0; i < 30 * 60; i++) { cat.step(1 / 30); expect(cat.speed).toBeLessThanOrEqual(.5 + 1e-9); if (cat.target) expect(cat.target.x).toBeLessThanOrEqual(0); }
});
it('places the cast apart on open floor and sizes each cat from its build', () => {
  const taken: { x: number; z: number }[] = [];
  for (let i = 0; i < 8; i++) { const spot = startSpot(createRng('cafe').fork(`cat:${i}`), taken); expect(walkable(spot.x, spot.z)).toBe(true); expect(taken.every(t => Math.hypot(t.x - spot.x, t.z - spot.z) > .8)).toBe(true); taken.push(spot); }
  expect(residentScale('clementine')).toBeCloseTo(.6); expect(residentScale('waffles')).toBeCloseTo(1.06); expect(residentScale('mochi')).toBe(1);
});
it('picks the master LOD for each tier', () => { expect(residentLod('desktop')).toBe('lod0'); expect(residentLod('phone')).toBe('lod1'); expect(residentLod('low')).toBe('lod2'); });
