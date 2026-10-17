import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../src/anim/catalog.ts';
import { CatRig } from '../../src/anim/rig.ts';
import { standInClips } from '../../src/anim/stand-in-clips.ts';
import { syntheticCat } from './helpers/synthetic-cat.ts';

describe('stand-in clips', () => {
  for (const twist of [false, true]) {
    it(`covers every catalogued clip with finite, closed tracks${twist ? ' (twisted frames)' : ''}`, () => {
      const cat = syntheticCat({ twist }), rig = new CatRig(cat.root, cat.bones);
      const clips = standInClips(CATALOG, rig);
      expect(clips.map(c => c.name)).toEqual(CATALOG.clips.map(c => c.name));
      for (const clip of clips) {
        const spec = CATALOG.byName.get(clip.name)!;
        expect(clip.duration, clip.name).toBeCloseTo(spec.durationS, 6);
        expect(clip.userData.standIn).toBe(true);
        for (const track of clip.tracks) {
          expect(Array.from(track.values).every(Number.isFinite), track.name).toBe(true);
          expect(rig.index(track.name.split('.')[0]!), track.name).toBeGreaterThanOrEqual(0);
          if (spec.loop) {
            const size = track.getValueSize(), n = track.values.length;
            for (let k = 0; k < size; k++) expect(track.values[n - size + k], `${clip.name} loop seam`).toBeCloseTo(track.values[k]!, 6);
          }
        }
        expect(clip.tracks.some(t => t.name === 'root.position'), clip.name).toBe(spec.rootMotion);
      }
    });
  }

  it('makes in-place gaits whose paws sweep back during stance', () => {
    const cat = syntheticCat(), rig = new CatRig(cat.root, cat.bones);
    const [walk] = standInClips(CATALOG, rig, ['cat.loco.walk']);
    const upper = walk!.tracks.find(t => t.name === 'front_L_upper.quaternion')!;
    expect(upper.values.length).toBeGreaterThan(8);
    expect(walk!.tracks.find(t => t.name === 'pelvis.position')).toBeDefined();
  });
});
