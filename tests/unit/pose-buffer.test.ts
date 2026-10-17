import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PoseBuffer } from '../../src/anim/pose-buffer.ts';

describe('pose buffer', () => {
  it('captures and restores bit-identical local transforms', () => {
    const bones = [new Object3D(), new Object3D()];
    bones[0]!.position.set(.1, .2, .3); bones[1]!.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 1.234567891234);
    const pose = new PoseBuffer(2).capture(bones);
    const q = bones[1]!.quaternion.clone();
    bones[1]!.quaternion.identity(); bones[0]!.position.set(0, 0, 0);
    pose.apply(bones);
    expect(bones[0]!.position.toArray()).toEqual([.1, .2, .3]);
    expect(bones[1]!.quaternion.equals(q)).toBe(true);
    expect(new PoseBuffer(2).copy(pose).maxDifference(pose)).toBe(0);
  });

  it('interpolates positions linearly and rotations by the shortest arc', () => {
    const bone = new Object3D(), a = new PoseBuffer(1), b = new PoseBuffer(1), scratch = new Float64Array(4);
    a.capture([bone]);
    bone.position.set(1, 0, 0); bone.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    const end = bone.quaternion.clone(); end.set(-end.x, -end.y, -end.z, -end.w); bone.quaternion.copy(end);
    b.capture([bone]);
    PoseBuffer.interpolate(a, b, .5, [bone], scratch);
    expect(bone.position.x).toBeCloseTo(.5, 12);
    expect(bone.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4))).toBeLessThan(1e-9);
  });
});
