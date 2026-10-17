import { Vector3, type SkinnedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { CatRig } from '../../src/anim/rig.ts';
import { applyBuild, deformation, segmentAxes } from '../../src/cats/apply-build.ts';
import { groupOfBone, residentById, resolveBuild, type ResolvedBuild } from '../../src/cats/builds.ts';
import { SKELETON, syntheticCat, worldPosition } from './helpers/synthetic-cat.ts';

const LEGS = SKELETON.ikChains.map(chain => ({ root: chain.root, effector: chain.effector }));

function built(build: ResolvedBuild, twist = false) {
  const cat = syntheticCat({ mesh: true, twist }), mesh = cat.mesh as SkinnedMesh;
  const rig = new CatRig(cat.root, cat.bones);
  const before = cat.bones.map(b => b.position.clone());
  const vertex = (bone: string, k: number): Vector3 => mesh.getVertexPosition(cat.bones.findIndex(b => b.name === bone) * 4 + k, new Vector3());
  const offsets = (bone: string): number[] => [1, 2, 3].map(k => vertex(bone, k).distanceTo(vertex(bone, 0)));
  const restOffsets = new Map(cat.bones.map(b => [b.name, offsets(b.name)]));
  const result = applyBuild(rig, build, groupOfBone(), LEGS, [mesh.skeleton]);
  rig.captureRest(); cat.root.updateMatrixWorld(true);
  return { cat, rig, result, before, offsets, restOffsets, index: (name: string) => cat.bones.findIndex(b => b.name === name) };
}

const uniform = (groups: Record<string, { length?: number; girth?: number }>): ResolvedBuild => {
  const all: Record<string, { length: number; girth: number }> = {};
  for (const g of ['pelvis', 'spine', 'neck', 'head', 'ears', 'eyes', 'whiskers', 'frontLegs', 'hindLegs', 'paws', 'tail']) all[g] = { length: groups[g]?.length ?? 1, girth: groups[g]?.girth ?? 1 };
  return { cat: 'test', build: 'test', scale: 1, groups: all, morphs: {} };
};

describe('build application', () => {
  it('builds deformations along and across the segment axis', () => {
    const g = deformation(new Vector3(0, 0, 1), 1.1, 1.3);
    expect(new Vector3(0, 0, 1).applyMatrix4(g).toArray()).toEqual([0, 0, 1.1]);
    expect(new Vector3(1, 0, 0).applyMatrix4(g).x).toBeCloseTo(1.3, 12);
    expect(new Vector3(1, 1, 1).applyMatrix4(deformation(null, 1.2, 1.1)).x).toBeCloseTo(1.32, 12);
  });

  it('classifies chain and volume bones from the skeleton topology', () => {
    const cat = syntheticCat(), rig = new CatRig(cat.root, cat.bones), axes = segmentAxes(rig);
    const axis = (name: string) => axes[rig.index(name)];
    expect(axis('spine_04')!.angleTo(rig.require('spine_05').position)).toBeLessThan(1e-6);
    expect(axis('pelvis')!.angleTo(rig.require('spine_01').position)).toBeLessThan(1e-6);
    expect(axis('tail_12')!.angleTo(rig.require('tail_12').position)).toBeLessThan(1e-6);
    for (const volume of ['head', 'jaw', 'eye_L', 'whisker_R', 'front_L_toe', 'hind_R_digit_outer']) expect(axis(volume), volume).toBeNull();
  });

  for (const twist of [false, true]) {
    it(`scales segment lengths by group length${twist ? ' (twisted frames)' : ''}`, () => {
      const { cat, before, index } = built(uniform({ frontLegs: { length: .9 }, tail: { length: 1.2 } }), twist);
      for (const name of ['front_L_upper', 'front_L_fore', 'front_L_wrist', 'front_L_paw', 'front_R_fore']) expect(cat.bones[index(name)]!.position.length(), name).toBeCloseTo(before[index(name)]!.length() * .9, 9);
      expect(cat.bones[index('tail_05')]!.position.length()).toBeCloseTo(before[index('tail_05')]!.length() * 1.2, 9);
      expect(cat.bones[index('front_L_scapula')]!.position.length()).toBeCloseTo(before[index('front_L_scapula')]!.length(), 9);
    });

    it(`widens the skin across a group's bones without passing girth to children${twist ? ' (twisted frames)' : ''}`, () => {
      const { offsets, restOffsets } = built(uniform({ spine: { girth: 1.14 } }), twist);
      // spine_03's ±X vertices sit across its segment (the spine runs along +Z).
      expect(offsets('spine_03')[0]).toBeCloseTo(restOffsets.get('spine_03')![0]! * 1.14, 6);
      expect(offsets('spine_03')[1]).toBeCloseTo(restOffsets.get('spine_03')![1]! * 1.14, 6);
      for (const child of ['neck_01', 'front_L_scapula', 'front_L_upper']) expect(offsets(child)[0], child).toBeCloseTo(restOffsets.get(child)![0]!, 6);
    });
  }

  it('scales volume bones uniformly and keeps the eyes in the scaled skull', () => {
    const { cat, before, offsets, restOffsets, index } = built(uniform({ head: { length: 1.08, girth: 1.2 }, eyes: { girth: 1.15 } }));
    expect(offsets('head')[0]).toBeCloseTo(restOffsets.get('head')![0]! * 1.296, 6);
    expect(cat.bones[index('eye_L')]!.position.length()).toBeCloseTo(before[index('eye_L')]!.length() * 1.296, 9);
    expect(offsets('eye_L')[0]).toBeCloseTo(restOffsets.get('eye_L')![0]! * 1.15, 6);
  });

  it('puts the lowest pad on the floor and reports leg scale for speed rescaling', () => {
    const kitten = resolveBuild(residentById('clementine')!);
    const { cat, result, rig } = built(kitten);
    expect(result.legScale).toBeCloseTo(.9, 1);
    expect(result.groundShift).toBeGreaterThan(.01);
    const toCat = cat.root.matrixWorld.clone().invert();
    const pads = LEGS.map(leg => worldPosition(rig.require(leg.effector)).applyMatrix4(toCat).y);
    expect(Math.min(...pads)).toBeGreaterThan(-.01);
    expect(result.translationScale('pelvis')).toBe(result.legScale);
    expect(result.translationScale('tail_04')).toBeCloseTo(.8, 9);
    expect(result.translationScale('nope')).toBe(1);
  });

  it('leaves the adult reference build untouched', () => {
    const { cat, before, result } = built(resolveBuild(residentById('mochi')!));
    cat.bones.forEach((bone, i) => expect(bone.position.distanceTo(before[i]!)).toBeLessThan(1e-12));
    expect(result.legScale).toBeCloseTo(1, 12);
    expect(Math.abs(result.groundShift)).toBeLessThan(1e-9);
  });
});
