import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CatRig } from '../../src/anim/rig.ts';
import { SKELETON, syntheticCat } from './helpers/synthetic-cat.ts';

describe('cat rig', () => {
  it('indexes the 65 shared bones and measures the rest pose in cat space', () => {
    const cat = syntheticCat({ twist: true });
    cat.root.position.set(3, 1, -2); cat.root.scale.setScalar(.6); cat.root.rotation.y = 1;
    const rig = new CatRig(cat.root, cat.bones);
    expect(rig.bones.length).toBe(65);
    expect(rig.names).toEqual(SKELETON.bones.map(b => b.name));
    expect(rig.index('tail_12')).toBe(64);
    expect(rig.bone('nope')).toBeNull();
    expect(() => rig.require('nope')).toThrow(/no bone/);
    // Cat space ignores the root's placement and scale: pelvis rest is skeleton.json's.
    expect(rig.restPositionCat(rig.index('pelvis'), new Vector3()).distanceTo(new Vector3(0, .32, -.22))).toBeLessThan(1e-9);
    expect(rig.restQuaternionCat(0, new Quaternion()).w).toBeDefined();
    expect(rig.childIndices(rig.index('spine_04')).map(i => rig.names[i])).toEqual(['spine_05', 'front_L_scapula', 'front_R_scapula']);
    expect(rig.parentIndex(rig.index('neck_01'))).toBe(rig.index('spine_05'));
  });

  it('restores the captured rest pose', () => {
    const cat = syntheticCat();
    const rig = new CatRig(cat.root, cat.bones);
    rig.require('head').rotation.x = 1; rig.require('pelvis').position.y = 0;
    rig.restoreRest();
    expect(rig.require('head').quaternion.w).toBe(1);
    expect(rig.require('pelvis').position.y).toBeCloseTo(.32, 12);
  });
});
