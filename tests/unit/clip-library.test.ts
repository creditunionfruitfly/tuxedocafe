import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../src/anim/catalog.ts';
import { ClipLibrary, restPoseOf } from '../../src/anim/clip-library.ts';
import { CatRig } from '../../src/anim/rig.ts';
import { syntheticCat } from './helpers/synthetic-cat.ts';

const turn = (degrees: number): number[] => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), degrees * Math.PI / 180).toArray();

function synthetic() {
  const cat = syntheticCat(), rig = new CatRig(cat.root, cat.bones), rest = restPoseOf(rig);
  const walk = new AnimationClip('cat.loco.walk', 1, [
    new QuaternionKeyframeTrack('head.quaternion', [0, .5, 1], [...turn(0), ...turn(10), ...turn(0)]),
    new VectorKeyframeTrack('pelvis.position', [0, 1], [0, .32, -.22, 0, .30, -.22]),
    new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, .7]),
    new VectorKeyframeTrack('spine_02.scale', [0], [1, 1, 1]),
    new QuaternionKeyframeTrack('not_a_bone.quaternion', [0], turn(5)),
  ]);
  walk.userData = { authoredSpeed: .75, events: [{ t: .5, name: 'sfx:test' }] };
  const tailUp = new AnimationClip('cat.layer.tail_up', 2, [new QuaternionKeyframeTrack('tail_01.quaternion', [0, 2], [...turn(30), ...turn(30)])]);
  const idleRef = new AnimationClip('cat.loco.idle', 1, [new QuaternionKeyframeTrack('head.quaternion', [0, 1], [...turn(20), ...turn(20)])]);
  const lean = new AnimationClip('cat.layer.lean_in', 1, [new QuaternionKeyframeTrack('head.quaternion', [0, 1], [...turn(25), ...turn(25)])]);
  lean.userData = { additiveReference: 'cat.loco.idle' };
  return { rig, library: new ClipLibrary([walk, tailUp, idleRef, lean], rest) };
}

describe('clip library', () => {
  it('binds clips by name, merges extras over the catalog and keeps only bone tracks', () => {
    const { library } = synthetic();
    const walk = library.clips.get('cat.loco.walk')!;
    expect(walk.spec.authoredSpeed).toBe(.75);
    expect(walk.spec.contacts!.LF).toBeDefined();
    expect(walk.spec.events).toEqual([{ t: .5, name: 'sfx:test' }]);
    expect(walk.clip.tracks.map(t => t.name).sort()).toEqual(['head.quaternion', 'pelvis.position']);
    expect(library.missing()).toHaveLength(CATALOG.clips.length - 4);
  });

  it('makes additive clips relative to the rest pose or the named reference', () => {
    const { library } = synthetic();
    const tail = library.clips.get('cat.layer.tail_up')!;
    expect(tail.additive).toBe(true);
    const delta = new Quaternion().fromArray(Array.from(tail.clip.tracks[0]!.values.slice(0, 4)));
    expect(delta.angleTo(new Quaternion().fromArray(turn(30)))).toBeLessThan(1e-3);
    const lean = new Quaternion().fromArray(Array.from(library.clips.get('cat.layer.lean_in')!.clip.tracks[0]!.values.slice(0, 4)));
    expect(lean.angleTo(new Quaternion().fromArray(turn(5)))).toBeLessThan(1e-3);
  });

  it('retargets translation tracks to each cat while sharing rotation tracks', () => {
    const { rig, library } = synthetic();
    rig.require('pelvis').position.y = .2; rig.captureRest();
    const bound = library.bind(rig, bone => bone === 'pelvis' ? .5 : 1);
    const walk = bound.get('cat.loco.walk')!;
    const pelvis = walk.clip.tracks.find(t => t.name === 'pelvis.position')!;
    expect(pelvis.values[1]).toBeCloseTo(.2, 6);
    expect(pelvis.values[4]).toBeCloseTo(.2 - .01, 6);
    expect(walk.clip.tracks.find(t => t.name === 'head.quaternion')).toBe(library.clips.get('cat.loco.walk')!.clip.tracks.find(t => t.name === 'head.quaternion'));
    expect(bound.get('cat.layer.tail_up')!.clip).toBe(library.clips.get('cat.layer.tail_up')!.clip);
    expect(walk.duration).toBe(1);
  });
});
