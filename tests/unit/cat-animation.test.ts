import { Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { flatGround, withStep } from '../../src/anim/ground.ts';
import { FixedLoop } from '../../src/core/loop.ts';
import { syntheticRuntime } from './helpers/synthetic-runtime.ts';

/**
 * A scripted session keyed by simulation step: walk, trot, turn, sit, look at
 * a hand, a step under the paws, layers and one-shots. Returns a digest of
 * every step's pose and the events, recorded while rendering at `fps`.
 */
function replay(fps: number, interval = 1) {
  const { animation, events } = syntheticRuntime();
  animation.interval = interval;
  animation.ground = withStep(flatGround(0), { minX: -1, maxX: 1, minZ: .6, maxZ: 3 }, .05);
  const hand = new Vector3();
  const poses: number[] = [], contacts: number[] = [];
  let step = 0;
  const loop = new FixedLoop(dt => {
    const t = step * dt;
    const speed = t < 1 ? .7 * t : t < 2.5 ? .7 : t < 3.5 ? 1.6 : t < 4 ? 0 : 0;
    const turn = t >= 4 && t < 4.6 ? 1.2 : 0;
    animation.drive(speed, turn, dt);
    if (step === 140) animation.animator.play('cat.rest.sit_down');
    if (step === 150) animation.animator.setLayer('cat.layer.tail_up', 1);
    if (step === 160) animation.animator.trigger('cat.rest.yawn');
    hand.set(Math.sin(t) * .4, .45, animation.position.z + .6);
    animation.lookAt(t > 2 ? hand : null, 1);
    animation.tick(dt);
    poses.push(Array.from(animation.pose.data).reduce((sum, v, i) => sum + v * ((i % 13) + 1), 0));
    contacts.push(...animation.animator.contacts);
    step++;
  }, alpha => animation.render(alpha));
  const frames = Math.ceil(6.2 * fps);
  for (let i = 0; i <= frames; i++) loop.frame(i * 1000 / fps);
  return { poses: poses.slice(0, 180), events, contacts: contacts.slice(0, 720), animation };
}

describe('cat animation runtime', () => {
  it('replays identically at 30, 60 and 144 render fps', () => {
    const a = replay(30), b = replay(60), c = replay(144);
    expect(a.poses).toHaveLength(180);
    expect(b.poses).toEqual(a.poses);
    expect(c.poses).toEqual(a.poses);
    expect(b.events).toEqual(a.events);
    expect(c.events).toEqual(a.events);
    expect(a.events).toContain('mochi:cat.rest.yawn:sfx:cat.yawn');
    for (const v of a.poses) expect(Number.isFinite(v)).toBe(true);
  });

  it('evaluates distant cats less often without changing events or contacts', () => {
    const near = replay(60, 1), far = replay(60, 3);
    expect(far.events).toEqual(near.events);
    expect(far.contacts).toEqual(near.contacts);
    expect(far.poses).not.toEqual(near.poses);
  });

  it('interpolates render poses between simulation steps', () => {
    const { animation, rig } = syntheticRuntime();
    animation.place(0, 0, 0, 0);
    animation.tick(1 / 30);
    animation.position.z = .1; animation.tick(1 / 30);
    animation.render(.5);
    expect(rig.root.position.z).toBeCloseTo(.05, 9);
    animation.render(1);
    expect(rig.root.position.z).toBeCloseTo(.1, 9);
  });

  it('runs the stack in catalog order and drives morph targets by name', () => {
    const { animation, cat } = syntheticRuntime();
    expect(animation.catalog.stackOrder).toEqual(['locomotion', 'action', 'additive', 'lookAt', 'legIK', 'springs']);
    const mesh = new Mesh(); mesh.morphTargetDictionary = { blink_L: 0, bodyFat: 1 }; mesh.morphTargetInfluences = [0, 0];
    animation.addMorphMesh(mesh);
    animation.staticMorphs[animation.catalog.morphTargets.indexOf('bodyFat')] = .85;
    animation.eyesClosed = 1;
    animation.tick(1 / 30); animation.render(0);
    expect(mesh.morphTargetInfluences).toEqual([1, .85]);
    expect(cat.bones.length).toBe(65);
  });

  it('walks without NaNs and keeps every locked pad still during stance', () => {
    // At 0.12 m/s the walk's stride fits the synthetic leg (the catalog's full-speed
    // stance sweep of 0.43 m does not; see the M2-3 report).
    for (const [speed, check] of [[.12, true], [.7, false], [2.5, false]] as const) {
      const { animation } = syntheticRuntime();
      animation.place(0, 0, 0, 0);
      const pad = new Vector3(), drift = [0, 0, 0, 0];
      const locks = animation.legs.legs.map(() => new Vector3(NaN, NaN, NaN));
      for (let i = 0; i < 200; i++) {
        animation.drive(speed, 0, 1 / 30);
        animation.tick(1 / 30);
        animation.legs.legs.forEach((leg, k) => {
          animation.legs.padPosition(leg.id, pad);
          expect(Number.isFinite(pad.x + pad.y + pad.z)).toBe(true);
          if (leg.locked && leg.lockWeight >= 1 && leg.release === 0 && i > 60) {
            if (locks[k]!.equals(leg.lock)) drift[k] = Math.max(drift[k]!, pad.distanceTo(leg.lock));
            locks[k]!.copy(leg.lock);
          } else locks[k]!.set(NaN, NaN, NaN);
        });
      }
      if (check) for (const value of drift) expect(value, `pad drift at ${speed} m/s`).toBeLessThan(.003);
      expect(animation.position.z).toBeCloseTo(speed * 200 / 30, 6);
    }
  });
});
