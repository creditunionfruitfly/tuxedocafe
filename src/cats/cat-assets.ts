import { Bone, SkinnedMesh, type AnimationClip, type Group, type Object3D } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { RestPose, RestTransform } from '../anim/clip-library.ts';
import type { Tier } from '../core/tiers.ts';
import { isPhoneTier } from './lod.ts';

/**
 * Which cat files to load, and loading them. The master mesh, clips and
 * expression curves are authored in parallel (M2-1, M2-2); until they ship,
 * the 65-bone capsule placeholder and procedural stand-in clips stand in.
 * Presence is decided from the build's asset manifest, so nothing 404s.
 */
export const MASTER_LODS: readonly string[] = ['art/cats/cat_master_lod0.glb', 'art/cats/cat_master_lod1.glb', 'art/cats/cat_master_lod2.glb'];
export const CAT_ANIMS = 'art/cats/cat_anims.glb';
export const CAT_EXPRESSIONS = 'art/cats/cat_expressions.json';
export const CAT_PLACEHOLDER = 'art/cats/cat_placeholder_lod0.glb';

export interface CatAssetPlan {
  readonly source: 'master' | 'placeholder';
  /** By LOD level; null where the level is skipped (phones never load LOD0) or missing. */
  readonly lods: readonly (string | null)[];
  readonly anims: string | null;
  readonly expressions: string | null;
}

export function planCatAssets(has: (path: string) => boolean, tier: Tier): CatAssetPlan {
  const lods = MASTER_LODS.map((path, level) => has(path) && !(level === 0 && isPhoneTier(tier) && has(MASTER_LODS[1]!)) ? path : null);
  const master = lods.some(Boolean);
  return {
    source: master ? 'master' : 'placeholder',
    lods: master ? lods : [CAT_PLACEHOLDER, null, null],
    anims: has(CAT_ANIMS) ? CAT_ANIMS : null,
    expressions: has(CAT_EXPRESSIONS) ? CAT_EXPRESSIONS : null,
  };
}

export interface CatTemplate {
  readonly plan: CatAssetPlan;
  /** gltf.scene per LOD level (null when not loaded). */
  readonly lods: readonly (Group | null)[];
  /** Clips from cat_anims.glb (empty until it ships). */
  readonly clips: readonly AnimationClip[];
  /** The skeleton the file clips were authored on (cat_anims.glb's bones). */
  readonly clipRest: RestPose | null;
  readonly expressions: unknown;
}

export function restPoseOfScene(root: Object3D): RestPose {
  const pose = new Map<string, RestTransform>();
  root.traverse(node => { if (node instanceof Bone && !pose.has(node.name)) pose.set(node.name, { position: node.position.clone(), quaternion: node.quaternion.clone() }); });
  return pose;
}

/**
 * The capsule placeholder binds each capsule (parent joint → joint) to the
 * joint at its far end; rebinding it to the parent makes it a rigid link, so
 * IK and clips read correctly on the diagnostic rig. The real mesh is untouched.
 */
export function rigidifyPlaceholder(scene: Object3D): void {
  scene.traverse(node => {
    if (!(node instanceof SkinnedMesh)) return;
    const bones = node.skeleton.bones, parents = bones.map(bone => bones.indexOf(bone.parent as Bone));
    const skinIndex = node.geometry.getAttribute('skinIndex');
    for (let v = 0; v < skinIndex.count; v++) {
      const joint = skinIndex.getX(v), parent = parents[joint] ?? -1;
      if (parent >= 0) skinIndex.setX(v, parent);
    }
    skinIndex.needsUpdate = true;
  });
}

export type LoadGltf = (path: string) => Promise<GLTF>;
export type LoadJson = (path: string) => Promise<unknown>;

export async function loadCatTemplate(plan: CatAssetPlan, loadGltf: LoadGltf, loadJson: LoadJson): Promise<CatTemplate> {
  const [lods, anims, expressions] = await Promise.all([
    Promise.all(plan.lods.map(path => path ? loadGltf(path).then(gltf => gltf.scene) : Promise.resolve(null))),
    plan.anims ? loadGltf(plan.anims) : Promise.resolve(null),
    plan.expressions ? loadJson(plan.expressions).catch(() => null) : Promise.resolve(null),
  ]);
  if (plan.source === 'placeholder') for (const scene of lods) if (scene) rigidifyPlaceholder(scene);
  return { plan, lods, clips: anims?.animations ?? [], clipRest: anims ? restPoseOfScene(anims.scene) : null, expressions };
}
