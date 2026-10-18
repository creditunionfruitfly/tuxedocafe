import { expect, it } from 'vitest';
import { Object3D, Ray, Vector3 } from 'three';
import { createRng } from '../../src/core/rng.ts';
import { EventBus } from '../../src/core/events.ts';
import { Brain } from '../../src/cats/brain.ts';
import { CloseUp } from '../../src/interaction/closeup.ts';
import type { Resident } from '../../src/cats/resident.ts';

const DT = 1 / 30, patron = { x: .6, z: 0 };
const brain = (seed: string, id = 'mochi'): Brain => { const b = new Brain(id, createRng(seed), { x: .6, z: -1.5 }); b.affinity = b.cap * .8; return b; };
it('lets each cat decide whether to stay, on its own seeded terms', () => {
  const choices = Array.from({ length: 40 }, (_, i) => brain(`seed-${i}`).engage(patron));
  expect(choices.some(Boolean)).toBe(true); expect(choices.some(stay => !stay)).toBe(true);
  const shy = new Brain('pixel', createRng('x'), { x: .6, z: -1.5 }); shy.affinity = 0;
  expect(Array.from({ length: 20 }, (_, i) => { const b = new Brain('pixel', createRng(`s${i}`), { x: .6, z: -1.5 }); b.affinity = 0; return b.engage(patron); }).filter(Boolean).length).toBeLessThan(10);
});
it('walks the overstimulation bands: purr, warning, then a swat and a cooldown', () => {
  let b = brain('a'); for (let i = 0; b.engage(patron) === false && i < 50; i++) b = brain(`a${i}`);
  expect(b.engaged).toBe(true);
  const before = b.affinity, seen: string[] = [];
  for (let i = 0; i < 30 * 120 && b.engaged; i++) { b.step(DT, { player: patron, cats: [b] }); const r = b.pet('belly', DT, patron); if (seen.at(-1) !== r) seen.push(r); }
  expect(seen).toEqual(['content', 'warning', 'over']);
  expect(b.affinity).toBeLessThan(before + .05); expect(b.engaged).toBe(false); expect(b.engage(patron)).toBe(false);
});
it('rewards stopping in the warning band and grows the bond toward its cap on liked zones', () => {
  let b = brain('b'); for (let i = 0; !b.engage(patron) && i < 50; i++) b = brain(`b${i}`);
  b.affinity = b.cap * .5; const start = b.affinity;
  for (let i = 0; i < 30 * 3; i++) { b.step(DT, { player: patron, cats: [b] }); b.pet('cheeks', DT, patron); }
  expect(b.affinity).toBeGreaterThan(start); expect(b.affinity).toBeLessThanOrEqual(b.cap);
  b.meter = .7; const warned = b.affinity; b.stopPetting(); expect(b.affinity).toBeGreaterThan(warned);
});
it('picks the nearest cat a tap ray passes through', () => {
  const resident = (x: number, id: string): Resident => { const root = new Object3D(); root.position.set(x, 0, -2); return { id, root, brain: brain(id), step() {}, render() {} } as unknown as Resident; };
  const near = resident(0, 'mochi'), far = resident(0, 'waffles'); far.root.position.z = -4;
  const closeup = new CloseUp(new EventBus(), () => false), ray = new Ray(new Vector3(0, .18, 0), new Vector3(0, 0, -1));
  expect(closeup.pick(ray, [far, near])?.id).toBe('mochi');
  expect(closeup.pick(new Ray(new Vector3(3, .18, 0), new Vector3(0, 0, -1)), [far, near])).toBeNull();
});
