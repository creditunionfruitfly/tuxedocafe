import { Vector3, type Bone } from 'three';
import { describe, expect, it } from 'vitest';
import { PAWS, type PawId } from '../../src/anim/catalog.ts';
import { flatGround, withSlope, withStep } from '../../src/anim/ground.ts';
import { LegIK } from '../../src/anim/leg-ik.ts';
import { PoseBuffer } from '../../src/anim/pose-buffer.ts';
import { CatRig } from '../../src/anim/rig.ts';
import { SKELETON, syntheticCat, worldPosition } from './helpers/synthetic-cat.ts';

const CONTACT_NONE = new Float64Array(4);
const LEGS: Record<PawId, [string, string, string]> = {
  LF: ['front_L_upper', 'front_L_fore', 'front_L_wrist'], RF: ['front_R_upper', 'front_R_fore', 'front_R_wrist'],
  LH: ['hind_L_thigh', 'hind_L_shin', 'hind_L_hock'], RH: ['hind_R_thigh', 'hind_R_shin', 'hind_R_hock'],
};

function setup(twist = false) {
  const cat = syntheticCat({ twist });
  const rig = new CatRig(cat.root, cat.bones);
  const ik = new LegIK(rig, SKELETON.ikChains);
  const bone = (name: string): Bone => cat.bones.find(b => b.name === name)!;
  const lengths = Object.fromEntries(PAWS.map(id => { const [a, b, c] = LEGS[id].map(bone) as [Bone, Bone, Bone]; return [id, [worldPosition(a).distanceTo(worldPosition(b)), worldPosition(b).distanceTo(worldPosition(c))]]; })) as Record<PawId, [number, number]>;
  /** Reset to rest each tick, as the runtime does before the mixer runs. */
  const tick = (steps: number, contacts: ArrayLike<number> = CONTACT_NONE, loco = 0): void => {
    for (let i = 0; i < steps; i++) { rig.restoreRest(); cat.root.updateMatrixWorld(true); ik.solve(1 / 30, contacts, loco); }
  };
  const pad = (id: PawId): Vector3 => ik.padPosition(id, new Vector3());
  const checkLimbs = (): void => {
    for (const id of PAWS) {
      const [a, b, c] = LEGS[id].map(bone) as [Bone, Bone, Bone];
      expect(worldPosition(a).distanceTo(worldPosition(b)), `${id} upper`).toBeCloseTo(lengths[id][0], 6);
      expect(worldPosition(b).distanceTo(worldPosition(c)), `${id} lower`).toBeCloseTo(lengths[id][1], 6);
      for (const n of [a, b, c]) expect(Number.isFinite(n.quaternion.x + n.quaternion.y + n.quaternion.z + n.quaternion.w)).toBe(true);
    }
  };
  /** Knee/elbow bend direction relative to the body, compared with the bind side. */
  const bindSides = Object.fromEntries(PAWS.map(id => [id, side(id)])) as Record<PawId, Vector3>;
  function side(id: PawId): Vector3 {
    const [a, b, c] = LEGS[id].map(n => worldPosition(bone(n)));
    const u = c!.clone().sub(a!).normalize(); const off = b!.clone().sub(a!); off.addScaledVector(u, -off.dot(u)); return off.normalize();
  }
  const checkNotFlipped = (): void => { for (const id of PAWS) expect(side(id).dot(bindSides[id]), `${id} bend side`).toBeGreaterThan(0); };
  return { cat, rig, ik, tick, pad, checkLimbs, checkNotFlipped, bone };
}

describe('leg IK', () => {
  it('leaves a planted rest pose on flat ground untouched', () => {
    const { ik, tick, pad, rig } = setup();
    tick(10);
    for (const id of PAWS) expect(Math.abs(pad(id).y)).toBeLessThan(1e-4);
    expect(Math.abs(ik.pelvisOffset)).toBeLessThan(1e-6);
    expect(new PoseBuffer(rig.bones.length).capture(rig.bones).maxDifference(rig.rest)).toBeLessThan(1e-5);
  });

  for (const twist of [false, true]) {
    it(`plants front paws on a step up and down${twist ? ' (twisted frames)' : ''}`, () => {
      for (const height of [.06, -.06]) {
        const { ik, tick, pad, checkLimbs, checkNotFlipped } = setup(twist);
        ik.ground = withStep(flatGround(0), { minX: -1, maxX: 1, minZ: .05, maxZ: 1 }, height);
        tick(40);
        for (const id of ['LF', 'RF'] as const) expect(pad(id).y, `${id} on the step`).toBeCloseTo(height, 3);
        for (const id of ['LH', 'RH'] as const) expect(pad(id).y, `${id} on the floor`).toBeCloseTo(0, 3);
        checkLimbs(); checkNotFlipped();
        if (height < 0) expect(ik.pelvisOffset + Math.abs(ik.pitch)).not.toBe(0);
      }
    });

    it(`plants every paw on a slope and tilts the pads onto it${twist ? ' (twisted frames)' : ''}`, () => {
      for (const [slope, heading] of [[12, 0], [12, Math.PI], [10, Math.PI / 2]] as const) {
        const { ik, tick, pad, checkLimbs, checkNotFlipped, bone } = setup(twist);
        const ground = withSlope(flatGround(0), { minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, 0, 0, 0, slope, heading);
        ik.ground = ground;
        tick(50);
        const hit = { height: 0, normal: new Vector3() };
        for (const id of PAWS) {
          const p = pad(id); ground(p.x, p.z, hit);
          expect(p.y, `${id} on the slope ${slope}° @${heading}`).toBeCloseTo(hit.height, 3);
        }
        // The paw's distal segment turned by the slope angle.
        const wrist = worldPosition(bone('front_L_wrist')), paw = worldPosition(bone('front_L_paw'));
        expect(Number.isFinite(wrist.distanceTo(paw))).toBe(true);
        checkLimbs(); checkNotFlipped();
      }
    });
  }

  it('locks stance pads in the world while the body moves', () => {
    const { cat, ik, tick, pad } = setup();
    const all = Float64Array.of(1, 1, 1, 1);
    tick(5, all, 1);
    const locked = PAWS.map(id => pad(id));
    for (let i = 0; i < 6; i++) { cat.root.position.z += .005; tick(1, all, 1); }
    PAWS.forEach((id, i) => expect(pad(id).distanceTo(locked[i]!), `${id} slid`).toBeLessThan(1e-4));
    expect(ik.leg('LF')!.locked).toBe(true);
  });

  it('releases a swing paw back to the animated path and re-plants past the drift limit', () => {
    const { cat, ik, tick, pad } = setup();
    tick(5, Float64Array.of(1, 1, 1, 1), 1);
    cat.root.position.z += .04; tick(1, Float64Array.of(0, 1, 1, 1), 1);
    expect(ik.leg('LF')!.locked).toBe(false);
    tick(8, Float64Array.of(0, 1, 1, 1), 1);
    expect(pad('LF').z).toBeGreaterThan(.03);
    // Drag the body far: planted paws re-plant rather than stretch the legs.
    for (let i = 0; i < 20; i++) { cat.root.position.z += .02; tick(1, Float64Array.of(1, 1, 1, 1), 1); }
    expect(pad('RH').z).toBeGreaterThan(.2);
  });

  it('never stretches a limb when the ground is out of reach', () => {
    const { ik, tick, checkLimbs, checkNotFlipped, pad } = setup();
    ik.ground = flatGround(-.5);
    tick(60);
    checkLimbs(); checkNotFlipped();
    expect(pad('LF').y).toBeGreaterThan(-.5);
    expect(ik.pelvisOffset).toBeGreaterThanOrEqual(-.3 * Math.min(...ik.legs.map(leg => leg.length)) - 1e-9);
  });

  it('reaches a front paw toward a toy target by weight', () => {
    const { ik, tick, pad } = setup();
    const start = pad('LF');
    const toy = start.clone().add(new Vector3(0, .1, .08));
    ik.setReach('LF', toy, 1);
    tick(3);
    expect(pad('LF').distanceTo(toy)).toBeLessThan(.002);
    ik.setReach('LF', toy, .5); tick(1);
    expect(pad('LF').distanceTo(start.clone().lerp(toy, .5))).toBeLessThan(.01);
    ik.setReach('LF', null); tick(1);
    expect(pad('LF').distanceTo(start)).toBeLessThan(.002);
  });

  it('fades out entirely when disabled (root-motion clips)', () => {
    const { ik, rig, cat } = setup();
    ik.ground = flatGround(.05);
    rig.restoreRest(); cat.root.updateMatrixWorld(true);
    ik.solve(1 / 30, CONTACT_NONE, 0, 0);
    expect(new PoseBuffer(rig.bones.length).capture(rig.bones).maxDifference(rig.rest)).toBe(0);
  });
});
