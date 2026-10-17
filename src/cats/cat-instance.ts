import { Color, Material, Mesh, MeshStandardMaterial, Skeleton, SkinnedMesh, Sphere, type Bone, type Group, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CatAnimation } from '../anim/cat-animation.ts';
import { speedFactor } from '../anim/locomotion.ts';
import { CatRig } from '../anim/rig.ts';
import type { EventBus } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import { applyBuild, type BuildResult } from './apply-build.ts';
import { groupOfBone, resolveBuild, type ResidentCatData, type ResolvedBuild } from './builds.ts';
import { templateBase, type CatKit } from './cat-kit.ts';
import { nearestAvailable } from './lod.ts';

/**
 * One resident cat instanced from the shared template: its own bones and one
 * Skeleton for every LOD's skinned meshes (geometry shared with every other
 * cat), its build applied to the skeleton and bind data, static shape morphs,
 * and materials tinted from its model colours (coat textures arrive with M3).
 */
export interface CatInstanceOptions { readonly bus?: EventBus | null; readonly rng: Rng; readonly shadows?: boolean }

/** Extra bounding radius for poses and root motion beyond the bind pose (metres, cat space). */
const CULL_PADDING = .6;
const TINTS: Readonly<Record<string, (model: ResidentCatData['model']) => string | undefined>> = {
  cat_fur: model => model.coat?.palette?.base ?? Object.values(model.coat?.palette ?? {})[0],
  cat_nose_leather: model => model.leather?.nose,
  cat_paw_pads: model => model.leather?.pads,
  cat_eye: model => model.eyes?.iris,
};

export class ResidentCat {
  readonly id: string;
  readonly data: ResidentCatData;
  readonly build: ResolvedBuild;
  readonly buildResult: BuildResult;
  readonly root: Group;
  readonly rig: CatRig;
  readonly skeleton: Skeleton;
  readonly animation: CatAnimation;
  /** Renderable meshes per LOD level (empty arrays for levels not loaded). */
  readonly levels: readonly Mesh[][];
  readonly #materials: Material[];
  readonly #skeletons: Skeleton[];
  level = -1;

  constructor(id: string, data: ResidentCatData, build: ResolvedBuild, buildResult: BuildResult, root: Group, rig: CatRig, skeletons: Skeleton[], animation: CatAnimation, levels: Mesh[][], materials: Material[]) {
    this.id = id; this.data = data; this.build = build; this.buildResult = buildResult; this.root = root; this.rig = rig;
    this.skeleton = skeletons[0]!; this.#skeletons = skeletons; this.animation = animation; this.levels = levels; this.#materials = materials;
  }

  /** Shows the loaded level nearest to `wanted`; returns the level shown. */
  setLevel(wanted: number): number {
    const level = nearestAvailable(wanted, this.levels.map(meshes => meshes.length > 0));
    if (level === this.level) return level;
    this.levels.forEach((meshes, k) => { for (const mesh of meshes) mesh.visible = k === level; });
    this.level = level;
    return level;
  }

  get triangles(): number {
    let count = 0;
    for (const mesh of this.levels[this.level] ?? []) count += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
    return count;
  }

  dispose(): void {
    this.animation.dispose();
    this.root.removeFromParent();
    for (const material of this.#materials) material.dispose();
    for (const skeleton of this.#skeletons) skeleton.dispose();
  }
}

function sameJoints(skeleton: Skeleton, bones: readonly Bone[]): boolean {
  return skeleton.bones.length === bones.length && skeleton.bones.every((bone, i) => bone.name === bones[i]!.name);
}

export function createResidentCat(kit: CatKit, data: ResidentCatData, options: CatInstanceOptions): ResidentCat {
  const template = kit.template, base = templateBase(template);
  const root = cloneSkinned(base.scene) as Group;
  root.name = `cat:${data.id}`; root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
  let primary: SkinnedMesh | null = null;
  root.traverse(node => { if (node instanceof SkinnedMesh && (!primary || node.name === 'cat_body')) primary = node; });
  const bones = (primary as unknown as SkinnedMesh).skeleton.bones;
  const byName = new Map<string, Object3D>(); root.traverse(node => { if (!byName.has(node.name)) byName.set(node.name, node); });
  const skeleton = new Skeleton(bones, base.mesh.skeleton.boneInverses.map(m => m.clone()));
  const extraSkeletons: Skeleton[] = [];
  const bindTo = (mesh: SkinnedMesh, source: Skeleton): void => {
    if (sameJoints(source, bones)) { mesh.bind(skeleton, mesh.bindMatrix); return; }
    const own = new Skeleton(source.bones.map(bone => (byName.get(bone.name) ?? bone) as Bone), source.boneInverses.map(m => m.clone()));
    extraSkeletons.push(own); mesh.bind(own, mesh.bindMatrix);
  };
  // Base level: rebind the clone's skinned meshes onto the one cat skeleton.
  const levels: Mesh[][] = template.lods.map(() => []);
  root.traverse(node => { if (node instanceof Mesh) { levels[base.level]!.push(node); if (node instanceof SkinnedMesh) bindTo(node, node.skeleton); } });
  // Other levels: their meshes join the same bones, under the same-named parents.
  template.lods.forEach((scene, level) => {
    if (!scene || level === base.level) return;
    const meshes: Mesh[] = [];
    scene.traverse(node => { if (node instanceof Mesh) meshes.push(node); });
    for (const source of meshes) {
      const copy = source.clone();
      const parent = source.parent === scene || !source.parent ? root : byName.get(source.parent.name) ?? root;
      parent.add(copy);
      if (source instanceof SkinnedMesh && copy instanceof SkinnedMesh) bindTo(copy, source.skeleton);
      levels[level]!.push(copy);
    }
  });
  // Per-cat materials, tinted from the model colours where a slot names a surface.
  const clones = new Map<Material, Material>(), owned: Material[] = [];
  const tint = (material: Material): Material => {
    const existing = clones.get(material); if (existing) return existing;
    const pick = TINTS[material.name] ?? (template.plan.source === 'placeholder' ? TINTS.cat_fur : undefined);
    const hex = pick?.(data.model);
    if (!hex || !(material instanceof MeshStandardMaterial)) { clones.set(material, material); return material; }
    const copy = material.clone(); copy.color.multiply(new Color(hex)); clones.set(material, copy); owned.push(copy);
    return copy;
  };
  const all = levels.flat();
  for (const mesh of all) {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
    mesh.castShadow = options.shadows ?? false; mesh.receiveShadow = false;
    if (mesh instanceof SkinnedMesh) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const sphere = mesh.geometry.boundingSphere!;
      mesh.boundingSphere = new Sphere(sphere.center.clone(), sphere.radius + CULL_PADDING);
    }
  }
  // Build: skeleton offsets and bind data, then uniform scale at the root.
  const build = resolveBuild(data);
  root.updateMatrixWorld(true);
  const rig = new CatRig(root, bones);
  const rigid = all.filter(mesh => !(mesh instanceof SkinnedMesh) && bones.includes(mesh.parent as Bone));
  const buildResult = applyBuild(rig, build, groupOfBone(), kit.ikChains, [skeleton, ...extraSkeletons], rigid);
  root.scale.setScalar(build.scale);
  rig.captureRest();
  const animation = new CatAnimation({
    id: data.id, rig, clips: kit.bind(rig, buildResult.translationScale), expressions: kit.expressions, rng: options.rng,
    ikChains: kit.ikChains, speedFactor: speedFactor(build.scale, buildResult.legScale), bus: options.bus ?? null, catalog: kit.catalog,
  });
  for (const [morph, weight] of Object.entries(build.morphs)) {
    const index = kit.catalog.morphTargets.indexOf(morph);
    if (index >= 0) animation.staticMorphs[index] = weight;
  }
  for (const mesh of all) animation.addMorphMesh(mesh);
  const cat = new ResidentCat(data.id, data, build, buildResult, root, rig, [skeleton, ...extraSkeletons], animation, levels, owned);
  cat.setLevel(base.level);
  return cat;
}
