import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { LOOK_LINKS, LookAt } from '../../src/anim/look-at.ts';
import { CatRig } from '../../src/anim/rig.ts';
import { syntheticCat, worldPosition } from './helpers/synthetic-cat.ts';

function setup(twist = false) {
  const cat = syntheticCat({ twist });
  const rig = new CatRig(cat.root, cat.bones);
  const look = new LookAt(rig);
  const head = rig.require('head');
  const forward = (): Vector3 => {
    const q = head.getWorldQuaternion(new Quaternion());
    return new Vector3(0, 0, 1).applyQuaternion(rig.restQuaternionCat(rig.index('head'), new Quaternion()).invert()).applyQuaternion(q);
  };
  /** Rest pose each step, then look-at, as in the runtime. */
  const run = (steps: number): void => { for (let i = 0; i < steps; i++) { rig.restoreRest(); cat.root.updateMatrixWorld(true); look.solve(1 / 30); } };
  return { cat, rig, look, head, forward, run };
}

const eulerOf = (bone: Object3D): Euler => new Euler().setFromQuaternion(bone.quaternion);

describe('look-at (CCD spine and neck)', () => {
  for (const twist of [false, true]) {
    it(`turns the head toward a target within every per-link limit${twist ? ' (twisted frames)' : ''}`, () => {
      const { rig, look, head, forward, run } = setup(twist);
      const rest = LOOK_LINKS.map(link => eulerOf(rig.require(link.bone)));
      const headPos = worldPosition(head), target = headPos.clone().add(new Vector3(.6, .1, .5));
      const before = forward().angleTo(target.clone().sub(headPos));
      look.setTarget(target, 1);
      run(40);
      expect(look.weight).toBeGreaterThan(.99);
      const after = forward().angleTo(target.clone().sub(worldPosition(head)));
      expect(after).toBeLessThan(before * .5);
      LOOK_LINKS.forEach((link, i) => {
        const now = eulerOf(rig.require(link.bone)), was = rest[i]!;
        const limit = Math.max(link.yawDeg, link.pitchDeg, link.rollDeg) * Math.PI / 180 + 1e-6;
        for (const axis of ['x', 'y', 'z'] as const) expect(Math.abs(now[axis] - was[axis]), `${link.bone}.${axis}`).toBeLessThanOrEqual(limit);
      });
    });
  }

  it('looks at a target straight ahead without disturbing the pose much and aims the eyes', () => {
    const { rig, look, head, run } = setup();
    const eye = rig.require('eye_L');
    const target = worldPosition(head).add(new Vector3(.25, -.05, 1));
    look.setTarget(target, 1); run(30);
    const eyeForward = new Vector3(0, 0, 1).applyQuaternion(eye.getWorldQuaternion(new Quaternion()));
    expect(eyeForward.angleTo(target.clone().sub(worldPosition(eye)))).toBeLessThan(.05);
  });

  it('does nothing at zero weight and fades out for targets behind the cat', () => {
    const { rig, look, head, run } = setup();
    look.setTarget(worldPosition(head).add(new Vector3(.3, 0, .3)), 0); run(10);
    expect(rig.require('head').quaternion.w).toBe(1);
    look.setTarget(worldPosition(head).add(new Vector3(0, 0, -1)), 1); run(10);
    expect(look.weight).toBe(0);
    expect(rig.require('neck_01').quaternion.w).toBe(1);
  });

  it('keeps the effector out of the 65-bone skeleton', () => {
    const { rig, look } = setup();
    expect(rig.bones.length).toBe(65);
    expect(look.effector.parent).toBe(rig.require('head'));
    expect(look.links.map(l => l.name)).toEqual(LOOK_LINKS.map(l => l.bone));
  });
});
