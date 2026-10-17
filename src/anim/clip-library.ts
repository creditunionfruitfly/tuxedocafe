import { AnimationClip, AnimationUtils, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type KeyframeTrack } from 'three';
import { CATALOG, parseClipSpec, rawCatalogClip, type Catalog, type ClipSpec } from './catalog.ts';
import type { CatRig } from './rig.ts';

/**
 * Clips bound by name from cat_anims.glb (or the procedural stand-ins), with
 * their glTF extras merged over the catalog. Additive clips become additive
 * against the reference their extras name (default: the rest pose). Bone
 * rotations are shared by every cat; translation tracks are retargeted per
 * cat (bind) so a kitten's shorter legs get a proportionally smaller pelvis
 * bob and a skeleton with corrected rest offsets still lines up.
 */
export interface RestTransform { readonly position: Vector3; readonly quaternion: Quaternion }
export type RestPose = ReadonlyMap<string, RestTransform>;
export interface LibraryClip { readonly spec: ClipSpec; readonly clip: AnimationClip; readonly additive: boolean }
export interface BoundClip extends LibraryClip { readonly duration: number }

/** The skeleton's root bone: locomotion clips are in place, so its tracks are dropped there. */
export const ROOT_BONE = 'root';

export function restPoseOf(rig: CatRig): RestPose {
  const pose = new Map<string, RestTransform>(), d = rig.rest.data;
  rig.names.forEach((name, i) => pose.set(name, {
    position: new Vector3(d[i * 7], d[i * 7 + 1], d[i * 7 + 2]),
    quaternion: new Quaternion(d[i * 7 + 3], d[i * 7 + 4], d[i * 7 + 5], d[i * 7 + 6]),
  }));
  return pose;
}

const trackBone = (track: KeyframeTrack): string => track.name.slice(0, track.name.lastIndexOf('.'));
const trackProperty = (track: KeyframeTrack): string => track.name.slice(track.name.lastIndexOf('.') + 1);

/** One key per track holding the rest value, for makeClipAdditive. */
function restReference(clip: AnimationClip, rest: RestPose): AnimationClip {
  const tracks: KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const value = rest.get(trackBone(track)); if (!value) continue;
    const property = trackProperty(track);
    if (property === 'quaternion') tracks.push(new QuaternionKeyframeTrack(track.name, [0], value.quaternion.toArray()));
    else if (property === 'position') tracks.push(new VectorKeyframeTrack(track.name, [0], value.position.toArray()));
  }
  return new AnimationClip(`${clip.name}:rest`, 0, tracks);
}

export class ClipLibrary {
  readonly clips: ReadonlyMap<string, LibraryClip>;
  readonly rest: RestPose;
  readonly catalog: Catalog;

  /** `rest` is the skeleton the clips were authored on (cat_anims.glb's own bones). */
  constructor(source: readonly AnimationClip[], rest: RestPose, catalog: Catalog = CATALOG) {
    this.rest = rest; this.catalog = catalog;
    const byName = new Map(source.map(clip => [clip.name, clip]));
    const clips = new Map<string, LibraryClip>();
    for (const original of source) {
      const spec = parseClipSpec(original.name, rawCatalogClip(original.name), original.userData as Record<string, unknown>, catalog.fps, original.duration);
      // Bone tracks only: no scale (girth lives in the bind data), nothing for unknown nodes,
      // and no root motion on in-place locomotion.
      const tracks = original.tracks.filter(track => {
        const bone = trackBone(track), property = trackProperty(track);
        if (!rest.has(bone) || (property !== 'quaternion' && property !== 'position')) return false;
        return !(spec.layer === 'locomotion' && bone === ROOT_BONE);
      });
      let clip = new AnimationClip(original.name, original.duration, tracks);
      clip.userData = original.userData;
      const additive = spec.layer === 'additive';
      if (additive) {
        clip = clip.clone();
        const reference = spec.additiveReference;
        const referenceClip = reference.kind === 'clip' && byName.has(reference.clip) ? byName.get(reference.clip)! : null;
        if (referenceClip) AnimationUtils.makeClipAdditive(clip, Math.round((reference.kind === 'clip' ? reference.time : 0) * catalog.fps), referenceClip, catalog.fps);
        else AnimationUtils.makeClipAdditive(clip, 0, restReference(clip, rest), catalog.fps);
      }
      clips.set(original.name, { spec, clip, additive });
    }
    this.clips = clips;
  }

  /** Catalogued clips this library lacks. */
  missing(): string[] { return this.catalog.clips.map(c => c.name).filter(name => !this.clips.has(name)); }

  /**
   * Per-cat clips. `translationScale(bone)` scales animated offsets from rest
   * (the build's length factor for that joint; leg length for root and pelvis).
   */
  bind(rig: CatRig, translationScale: (bone: string) => number): Map<string, BoundClip> {
    const bound = new Map<string, BoundClip>(), d = rig.rest.data;
    for (const [name, entry] of this.clips) {
      const { clip, additive } = entry;
      let perCat: AnimationClip = clip;
      if (clip.tracks.some(track => trackProperty(track) === 'position')) {
        perCat = new AnimationClip(clip.name, clip.duration, clip.tracks.map(track => {
          if (trackProperty(track) !== 'position') return track;
          const bone = trackBone(track), index = rig.index(bone), source = this.rest.get(bone);
          if (index < 0 || !source) return track;
          const k = translationScale(bone), values = new Float32Array(track.values.length);
          for (let i = 0; i < values.length; i += 3) for (let axis = 0; axis < 3; axis++) {
            const restSource = source.position.getComponent(axis), restCat = d[index * 7 + axis]!;
            values[i + axis] = additive ? track.values[i + axis]! * k : restCat + (track.values[i + axis]! - restSource) * k;
          }
          return new VectorKeyframeTrack(track.name, track.times, values);
        }));
        perCat.userData = clip.userData;
      }
      bound.set(name, { ...entry, clip: perCat, duration: clip.duration > 0 ? clip.duration : entry.spec.durationS });
    }
    return bound;
  }
}
