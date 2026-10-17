import { Matrix4, Quaternion, Vector3, type Object3D, type Skeleton } from 'three';
import type { CatRig } from '../anim/rig.ts';
import type { ResolvedBuild } from './builds.ts';

/**
 * Applies a resolved build to one cat's own skeleton (docs/decisions/0004).
 *
 * Every bone gets a deformation G about its joint, in its bind frame:
 * - a chain bone (one continuing child, or a chain end) scales by `length`
 *   along its segment axis and by `girth` across it;
 * - a volume bone (head, jaw, eyes, whiskers, toes: no single continuation)
 *   scales uniformly by length × girth.
 * Child joints move with their parent's G (positions only), so the skin and
 * the joints stay consistent. Each bone's skin is deformed through its own
 * inverse bind matrix (boneInverse := G · boneInverse), never through a bone
 * scale, so girth does not propagate to children and animation stays shear-free.
 * The rest pose is then lowered so the lowest paw pad touches the floor.
 */
export interface BuildResult {
  /** Per rig bone: the bind-frame deformation (linear part only). */
  readonly deformations: readonly Matrix4[];
  /** Average leg length after / before (for authoredSpeed rescaling). */
  readonly legScale: number;
  /** How far the rest pose was lowered to put the pads on the floor (cat space). */
  readonly groundShift: number;
  /** Scale for animated translation offsets of a bone (clip retargeting). */
  translationScale(bone: string): number;
}

export interface LegSpec { readonly root: string; readonly effector: string }

const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _m = new Matrix4(), _toCat = new Matrix4();

function descendants(object: Object3D, bones: Set<Object3D>): number {
  let count = 0;
  for (const child of object.children) if (bones.has(child)) count += 1 + descendants(child, bones);
  return count;
}

/** The segment axis (bone-local unit vector) of each bone, or null for volume bones. */
export function segmentAxes(rig: CatRig): (Vector3 | null)[] {
  const set = new Set(rig.bones), d = rig.rest.data;
  return rig.bones.map((bone, i) => {
    const children = bone.children.filter(child => set.has(child));
    if (children.length === 1) return children[0]!.position.clone().normalize();
    if (children.length > 1) {
      let best: Object3D | null = null, most = -1;
      for (const child of children) { const n = descendants(child, set); if (n > most) { most = n; best = child; } }
      return most >= 2 && best ? best.position.clone().normalize() : null;
    }
    const parent = bone.parent;
    if (!parent || !set.has(parent) || parent.children.filter(child => set.has(child)).length !== 1) return null;
    // A chain end continues its incoming bone, expressed in its own frame.
    return new Vector3(d[i * 7], d[i * 7 + 1], d[i * 7 + 2]).applyQuaternion(_q.set(d[i * 7 + 3]!, d[i * 7 + 4]!, d[i * 7 + 5]!, d[i * 7 + 6]!).invert()).normalize();
  });
}

/** G = L·aaᵀ + g·(I − aaᵀ) for a chain bone, (L·g)·I for a volume bone. */
export function deformation(axis: Vector3 | null, length: number, girth: number, out = new Matrix4()): Matrix4 {
  if (!axis || axis.lengthSq() < 1e-12) return out.makeScale(length * girth, length * girth, length * girth);
  const a = axis, k = length - girth;
  return out.set(
    girth + k * a.x * a.x, k * a.x * a.y, k * a.x * a.z, 0,
    k * a.y * a.x, girth + k * a.y * a.y, k * a.y * a.z, 0,
    k * a.z * a.x, k * a.z * a.y, girth + k * a.z * a.z, 0,
    0, 0, 0, 1,
  );
}

function legLength(rig: CatRig, leg: LegSpec, pads: ReadonlyMap<string, Vector3>): number {
  const root = rig.bone(leg.root), effector = rig.bone(leg.effector);
  if (!root || !effector) return 0;
  let length = 0, node: Object3D | null = effector;
  while (node && node !== root) { length += node.position.length(); node = node.parent; }
  const pad = pads.get(leg.effector);
  return length + (pad ? pad.length() : 0);
}

/**
 * `skeletons` are this cat's own skeletons (their boneInverses already cloned
 * from the template); `rigid` are meshes parented directly to bones (eyes).
 * The rig must be in its template rest pose; call rig.captureRest() afterwards.
 */
export function applyBuild(rig: CatRig, build: ResolvedBuild, groupOf: ReadonlyMap<string, string>, legs: readonly LegSpec[],
  skeletons: readonly Skeleton[] = [], rigid: readonly Object3D[] = []): BuildResult {
  const axes = segmentAxes(rig), d = rig.rest.data;
  const params = (bone: string) => build.groups[groupOf.get(bone) ?? ''] ?? { length: 1, girth: 1 };
  const deformations = rig.bones.map((bone, i) => { const p = params(bone.name); return deformation(axes[i]!, p.length, p.girth); });
  // Pad offsets in each paw's frame, measured on the template bind before anything moves.
  rig.root.updateMatrixWorld(true);
  _toCat.copy(rig.root.matrixWorld).invert();
  const pads = new Map<string, Vector3>();
  for (const leg of legs) {
    const effector = rig.bone(leg.effector); if (!effector) continue;
    _v.setFromMatrixPosition(effector.matrixWorld).applyMatrix4(_toCat); _v.y = 0;
    pads.set(leg.effector, _v.applyMatrix4(rig.root.matrixWorld).applyMatrix4(_m.copy(effector.matrixWorld).invert()).clone());
  }
  const before = legs.map(leg => legLength(rig, leg, pads));
  const ratios = new Map<string, number>();
  rig.bones.forEach((bone, i) => {
    const parent = rig.parentIndex(i);
    const rest = _w.set(d[i * 7]!, d[i * 7 + 1]!, d[i * 7 + 2]!);
    if (parent < 0) return;
    const length = rest.length();
    bone.position.copy(rest).applyMatrix4(deformations[parent]!);
    ratios.set(bone.name, length > 1e-9 ? bone.position.length() / length : 1);
  });
  for (const skeleton of skeletons) skeleton.bones.forEach((bone, j) => {
    const i = rig.index(bone.name);
    if (i >= 0) skeleton.boneInverses[j]!.premultiply(deformations[i]!);
  });
  for (const mesh of rigid) {
    const i = rig.bones.indexOf(mesh.parent!); if (i < 0) continue;
    mesh.updateMatrix(); mesh.matrix.premultiply(deformations[i]!); mesh.matrixAutoUpdate = false;
  }
  // Pads move with their paw's skin (its own G): lower the rest pose onto the floor.
  for (const [name, pad] of pads) { const i = rig.index(name); if (i >= 0) pad.applyMatrix4(deformations[i]!); }
  rig.root.updateMatrixWorld(true);
  let lowest = Infinity;
  for (const leg of legs) {
    const effector = rig.bone(leg.effector), pad = pads.get(leg.effector);
    if (effector && pad) lowest = Math.min(lowest, _v.copy(pad).applyMatrix4(effector.matrixWorld).applyMatrix4(_toCat).y);
  }
  const pelvis = rig.bone('pelvis');
  const groundShift = Number.isFinite(lowest) && pelvis ? lowest : 0;
  if (pelvis && groundShift !== 0) {
    // Cat-space drop, expressed in the pelvis parent's (unscaled) frame.
    _m.multiplyMatrices(_toCat, pelvis.parent!.matrixWorld).decompose(_v, _q, _w);
    pelvis.position.add(_w.set(0, -groundShift, 0).applyQuaternion(_q.invert()));
  }
  const after = legs.map(leg => legLength(rig, leg, pads));
  const legScales = before.map((length, k) => length > 0 ? after[k]! / length : 1);
  const legScale = legScales.length ? legScales.reduce((a, b) => a + b, 0) / legScales.length : 1;
  return {
    deformations, legScale, groundShift,
    translationScale: bone => bone === 'root' || bone === 'pelvis' ? legScale : ratios.get(bone) ?? 1,
  };
}
