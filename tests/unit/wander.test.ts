import { expect, it } from 'vitest';
import { createRng } from '../../src/core/rng.ts';
import { walkable } from '../../src/scenes/navigation.ts';
import { blocked, FURNITURE, ROOM } from '../../src/scenes/collision.ts';
import { WALK_SPEED, Wander } from '../../src/cats/wander.ts';
import { residentLod } from '../../src/cats/resident.ts';

const run = (seed: string) => { const cat = new Wander(createRng(seed).fork('cat:mochi'), { x: .6, z: -1.5 }); const trace: number[] = []; for (let i = 0; i < 30 * 120; i++) { cat.step(1 / 30); expect(cat.speed).toBeLessThanOrEqual(WALK_SPEED + 1e-9); expect(cat.x > ROOM.minX && cat.x < ROOM.maxX && cat.z > ROOM.minZ && cat.z < ROOM.maxZ && FURNITURE.every(box => !blocked(cat.x, cat.z, box, .15))).toBe(true); if (i % 30 === 0) trace.push(cat.x, cat.z); } return trace; };
it('wanders the open floor deterministically from its own seed', () => {
  expect(walkable(.6, -1.5)).toBe(true);
  const a = run('cafe'); expect(run('cafe')).toEqual(a); expect(run('other')).not.toEqual(a);
  expect(new Set(a.map(v => v.toFixed(1))).size).toBeGreaterThan(10);
});
it('picks the master LOD for each tier', () => { expect(residentLod('desktop')).toBe('lod0'); expect(residentLod('phone')).toBe('lod1'); expect(residentLod('low')).toBe('lod2'); });
