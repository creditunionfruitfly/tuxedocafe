import { SkinnedMesh, type Object3D } from 'three';
import skeleton from '../../art/rig/skeleton.json' with { type: 'json' };
import { CATALOG, type Catalog } from '../anim/catalog.ts';
import { ClipLibrary, restPoseOf, type BoundClip } from '../anim/clip-library.ts';
import { parseExpressions, type ExpressionLibrary } from '../anim/expressions.ts';
import type { IkChainSpec } from '../anim/leg-ik.ts';
import { CatRig } from '../anim/rig.ts';
import { standInClips } from '../anim/stand-in-clips.ts';
import type { CatTemplate } from './cat-assets.ts';

/**
 * Everything the resident cats share: the loaded template, the clip
 * libraries (file clips first, stand-ins for whatever the file lacks), the
 * expression curves and the skeleton's IK chains.
 */
export const IK_CHAINS = (skeleton as { ikChains: IkChainSpec[] }).ikChains;

export interface CatKit {
  readonly template: CatTemplate;
  readonly catalog: Catalog;
  readonly expressions: ExpressionLibrary;
  readonly ikChains: readonly IkChainSpec[];
  /** Names of catalogued clips played by procedural stand-ins. */
  readonly standIns: readonly string[];
  /** Every clip, bound to one cat's rig. */
  bind(rig: CatRig, translationScale: (bone: string) => number): Map<string, BoundClip>;
}

/** The base (most detailed loaded) LOD scene and its primary skinned mesh. */
export function templateBase(template: CatTemplate): { scene: Object3D; mesh: SkinnedMesh; level: number } {
  const level = template.lods.findIndex(Boolean), scene = template.lods[level];
  if (!scene) throw new Error('No cat mesh loaded');
  let mesh: SkinnedMesh | null = null;
  scene.traverse(node => { if (node instanceof SkinnedMesh && (!mesh || node.name === 'cat_body')) mesh = node; });
  if (!mesh) throw new Error('The cat mesh has no skin');
  return { scene, mesh, level };
}

export function createCatKit(template: CatTemplate, catalog: Catalog = CATALOG): CatKit {
  const { scene, mesh } = templateBase(template);
  scene.updateMatrixWorld(true);
  const rig = new CatRig(scene, (mesh as SkinnedMesh).skeleton.bones);
  const files = new ClipLibrary(template.clips, template.clipRest ?? restPoseOf(rig), catalog);
  const missing = files.missing();
  const standIns = new ClipLibrary(standInClips(catalog, rig, missing), restPoseOf(rig), catalog);
  return {
    template, catalog, expressions: parseExpressions(template.expressions, catalog), ikChains: IK_CHAINS, standIns: missing,
    bind: (target, scale) => new Map([...standIns.bind(target, scale), ...files.bind(target, scale)]),
  };
}
