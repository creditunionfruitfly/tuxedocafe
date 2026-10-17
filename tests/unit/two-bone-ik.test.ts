import { Bone, Group, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { rotationBetweenFrames, solveTwoBone, TwoBoneChain } from '../../src/anim/two-bone-ik.ts';
import { syntheticCat, worldPosition } from './helpers/synthetic-cat.ts';

/** A leg-like chain: hip at the origin, knee bent forward, ankle below. */
function chain(options: { straight?: boolean; twist?: boolean } = {}) {
  const root = new Group(), hip = new Bone(), knee = new Bone(), ankle = new Bone(), toe = new Bone();
  root.add(hip); hip.add(knee); knee.add(ankle); ankle.add(toe);
  hip.position.set(0, 1, 0);
  knee.position.set(0, -.5, options.straight ? 0 : .1);
  ankle.position.set(0, -.5, options.straight ? 0 : -.1);
  toe.position.set(0, -.05, .1);
  if (options.twist) {
    // Arbitrary rest frames with the same joint positions.
    const qh = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), .9), qk = new Quaternion().setFromAxisAngle(new Vector3(-2, 1, .5).normalize(), -1.1);
    hip.quaternion.copy(qh);
    knee.position.applyQuaternion(qh.clone().invert()); knee.quaternion.copy(qh.clone().invert().multiply(qk));
    ankle.position.applyQuaternion(qk.clone().invert());
    ankle.quaternion.copy(qk.clone().invert());
  }
  root.updateMatrixWorld(true);
  return { root, hip, knee, ankle, ik: new TwoBoneChain(hip, knee, ankle, undefined, new Vector3(0, 0, 1)) };
}

const lengths = (a: Bone, b: Bone, c: Bone): [number, number] => [worldPosition(a).distanceTo(worldPosition(b)), worldPosition(b).distanceTo(worldPosition(c))];
/** Signed bend: positive when the knee sits on the bind bend side (+Z here). */
const bendSide = (a: Bone, b: Bone, c: Bone): number => {
  const pa = worldPosition(a), pb = worldPosition(b), pc = worldPosition(c), u = pc.clone().sub(pa).normalize();
  const off = pb.clone().sub(pa); off.addScaledVector(u, -off.dot(u)); return off.z;
};
const finite = (...bones: Bone[]): boolean => bones.every(b => [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w].every(Number.isFinite));

describe('two-bone IK', () => {
  for (const twist of [false, true]) {
    describe(twist ? 'with arbitrary rest frames' : 'with identity rest frames', () => {
      it('reaches reachable targets exactly and keeps segment lengths', () => {
        const { hip, knee, ankle, ik } = chain({ twist });
        const before = lengths(hip, knee, ankle);
        for (const target of [new Vector3(.2, .3, .1), new Vector3(-.1, .45, -.2), new Vector3(0, .7, .3), new Vector3(.3, .2, 0)]) {
          expect(solveTwoBone(ik, target)).toBe(true);
          expect(worldPosition(ankle).distanceTo(target)).toBeLessThan(1e-5);
          const after = lengths(hip, knee, ankle);
          expect(after[0]).toBeCloseTo(before[0], 6); expect(after[1]).toBeCloseTo(before[1], 6);
          expect(bendSide(hip, knee, ankle)).toBeGreaterThan(0);
          expect(finite(hip, knee, ankle)).toBe(true);
        }
      });

      it('points at unreachable targets with a straight limb and never stretches', () => {
        const { hip, knee, ankle, ik } = chain({ twist });
        const [upper, lower] = lengths(hip, knee, ankle);
        const target = new Vector3(.4, -1.5, .8);
        expect(solveTwoBone(ik, target)).toBe(false);
        const reach = worldPosition(ankle).distanceTo(worldPosition(hip));
        expect(reach).toBeLessThanOrEqual(upper + lower + 1e-9);
        expect(reach).toBeGreaterThan((upper + lower) * .999);
        const direction = target.clone().sub(worldPosition(hip)).normalize();
        expect(worldPosition(ankle).sub(worldPosition(hip)).normalize().dot(direction)).toBeGreaterThan(.9999);
        expect(lengths(hip, knee, ankle)[0]).toBeCloseTo(upper, 6);
      });

      it('clamps targets inside the minimum fold instead of inverting the knee', () => {
        const { hip, knee, ankle, ik } = chain({ twist });
        solveTwoBone(ik, new Vector3(0, 1, .001));
        const pa = worldPosition(hip), pb = worldPosition(knee), pc = worldPosition(ankle);
        const interior = pb.clone().sub(pa).angleTo(pc.clone().sub(pb));
        expect(Math.PI - interior).toBeGreaterThanOrEqual(22 * Math.PI / 180 - 1e-4);
        expect(finite(hip, knee, ankle)).toBe(true);
        expect(bendSide(hip, knee, ankle)).toBeGreaterThan(0);
      });

      it('handles a target exactly at full reach and at the root without NaNs', () => {
        const { hip, knee, ankle, ik } = chain({ twist });
        const [upper, lower] = lengths(hip, knee, ankle);
        solveTwoBone(ik, new Vector3(0, 1 - upper - lower, 0));
        expect(worldPosition(ankle).y).toBeCloseTo(1 - upper - lower, 4);
        solveTwoBone(ik, new Vector3(0, 1, 0));
        expect(finite(hip, knee, ankle)).toBe(true);
      });

      it('follows pole changes on the anatomical side and refuses to flip', () => {
        const { hip, knee, ankle, ik } = chain({ twist });
        const target = new Vector3(0, .35, .05);
        solveTwoBone(ik, target, new Vector3(.5, .6, .5));
        expect(worldPosition(knee).x).toBeGreaterThan(.02);
        solveTwoBone(ik, target, new Vector3(-.5, .6, .5));
        expect(worldPosition(knee).x).toBeLessThan(-.02);
        // A pole straight behind the leg would invert the knee: the swivel stops at its limit.
        solveTwoBone(ik, target, new Vector3(0, .6, -2));
        expect(bendSide(hip, knee, ankle)).toBeGreaterThan(0);
        expect(worldPosition(ankle).distanceTo(target)).toBeLessThan(1e-5);
      });
    });
  }

  it('bends a straight bind limb toward the fallback direction', () => {
    const { hip, knee, ankle, ik } = chain({ straight: true });
    solveTwoBone(ik, new Vector3(0, .3, 0));
    expect(worldPosition(knee).z).toBeGreaterThan(.05);
    expect(finite(hip, knee, ankle)).toBe(true);
  });

  it('reproduces the current pose when the target is where the end already is', () => {
    const { hip, knee, ankle, ik } = chain({ twist: true });
    const before = [hip.quaternion.clone(), knee.quaternion.clone()];
    solveTwoBone(ik, worldPosition(ankle));
    expect(hip.quaternion.angleTo(before[0]!)).toBeLessThan(1e-5);
    expect(knee.quaternion.angleTo(before[1]!)).toBeLessThan(1e-5);
  });

  it('solves every cat leg chain of the shared skeleton, including twisted frames', () => {
    for (const twist of [false, true]) {
      const { bones } = syntheticCat({ twist });
      const by = (name: string): Bone => bones.find(b => b.name === name)!;
      for (const [a, b, c] of [['front_L_upper', 'front_L_fore', 'front_L_wrist'], ['hind_R_thigh', 'hind_R_shin', 'hind_R_hock']] as const) {
        const ik = new TwoBoneChain(by(a), by(b), by(c));
        const target = worldPosition(by(c)).add(new Vector3(0, .04, .02));
        expect(solveTwoBone(ik, target)).toBe(true);
        expect(worldPosition(by(c)).distanceTo(target)).toBeLessThan(1e-5);
      }
    }
  });

  it('maps one frame onto another', () => {
    const q = rotationBetweenFrames(new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Quaternion());
    expect(new Vector3(1, 0, 0).applyQuaternion(q).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-9);
    expect(new Vector3(0, 1, 0).applyQuaternion(q).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-9);
  });
});
