import { describe, expect, it } from 'vitest';
import { BUILDS, groupOfBone, residentById, RESIDENTS, resolveBuild } from '../../src/cats/builds.ts';
import { SKELETON } from './helpers/synthetic-cat.ts';

describe('cat builds', () => {
  it('resolves every resident: build scale × model scale, overrides replace, morphs merge', () => {
    expect(RESIDENTS).toHaveLength(8);
    const waffles = resolveBuild(residentById('waffles')!);
    expect(waffles.build).toBe('chunky');
    expect(waffles.scale).toBeCloseTo(1.06, 9);
    expect(waffles.groups.head).toEqual({ length: 1, girth: 1.06 });
    expect(waffles.groups.spine).toEqual({ length: 1, girth: 1.14 });
    expect(waffles.morphs).toEqual({ bodyFat: .85 });
    const pepper = resolveBuild(residentById('pepper')!);
    expect(pepper.scale).toBeCloseTo(.95, 9);
    expect(pepper.groups.ears).toEqual({ length: 1.03, girth: 1 });
    expect(resolveBuild(residentById('biscuit')!).morphs).toEqual({ bodyFat: .25 });
    const clementine = resolveBuild(residentById('clementine')!);
    expect(clementine.scale).toBeCloseTo(.6, 9);
    expect(clementine.morphs).toEqual({ headKitten: 1 });
    expect(resolveBuild({ id: 'x', model: { build: 'nope' } }).build).toBe('adult');
  });

  it('maps every bone group to real skeleton bones', () => {
    const names = new Set(SKELETON.bones.map(b => b.name)), groups = groupOfBone();
    for (const bones of Object.values(BUILDS.groups)) for (const bone of bones) expect(names, bone).toContain(bone);
    expect(groups.get('front_L_fore')).toBe('frontLegs');
    expect(groups.get('root')).toBeUndefined();
  });
});
