// Reads art/rig/skeleton.json and derives everything the clips need from the
// rest pose: limb chains and segment lengths, hinge sides, pad clearance and
// body proportions. Nothing here hard-codes a position, so corrected rest
// poses (same names, order and parents) produce matching clips.
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';

export interface RigBone { name: string; parent: string | null; restPosition: [number, number, number] }
export type LegId = 'LF' | 'RF' | 'LH' | 'RH';
export const LEGS: readonly LegId[] = ['LF', 'RF', 'LH', 'RH'];

export interface LegDef {
  id: LegId; side: 1 | -1; front: boolean;
  /** Bone the leg hangs from (spine_04 or pelvis). */
  girdle: number;
  /** Scapula or hip: the rotatable proximal segment. */
  prox: number;
  /** Analytic two-bone chain: upper/fore/wrist or thigh/shin/hock (M2-0). */
  a: number; b: number; c: number;
  /** Bones from c to the toe joint (metacarpus/metatarsus and digits). */
  distal: number[];
  toe: number; digits: number[];
  L1: number; L2: number;
  /** Rest distance from a to c over L1 + L2 (how extended the chain is at rest). */
  restRatio: number;
  /** Rest hinge axis (world = rest frame) and the side the middle joint bends to. */
  hinge: Vector3; bend: number;
  /** Toe joint height above the floor when standing flat (pad clearance). */
  padY: number;
  restToe: Vector3;
  /** Heel lift that stands the metacarpus / metatarsus at a digitigrade angle (0 if the rest pose already does). */
  stanceHeel: number;
}

/** Digitigrade stance angles of the metacarpus and metatarsus above the floor. */
export const STANCE_META_DEG = { front: 62, hind: 64 };

export interface Measures {
  shoulderH: number; pelvisH: number; legScale: number;
  /** Rest-relative body volumes for floor contact (spine to belly, half width, dorsal skin). */
  depth: number; halfWidth: number; skin: number;
  trunk: number; pelvisZ: number; chestZ: number; headZ: number; headH: number;
  frontReach: number; hindReach: number; tailLen: number;
}

export interface Rig {
  names: string[]; parent: number[]; offset: Vector3[]; restWorld: Vector3[];
  index: (name: string) => number;
  legs: Record<LegId, LegDef>;
  spine: number[]; neck: number[]; tail: number[];
  M: Measures;
}

export interface Pose { q: Quaternion[]; root: Vector3; pelvis: Vector3 }
export interface World { pos: Vector3[]; rot: Quaternion[] }

export const ADULT_SHOULDER_M = 0.30;

export function loadRig(path = process.env.CAT_SKELETON ?? 'art/rig/skeleton.json'): Rig {
  const data = JSON.parse(readFileSync(path, 'utf8')) as { bones: RigBone[] };
  const names = data.bones.map(b => b.name);
  const map = new Map(names.map((n, i) => [n, i]));
  const index = (name: string) => { const i = map.get(name); if (i === undefined) throw new Error(`skeleton has no bone ${name}`); return i; };
  const parent = data.bones.map((b, i) => {
    const p = b.parent === null ? -1 : index(b.parent);
    if (p >= i) throw new Error(`skeleton bone ${b.name} precedes its parent`);
    return p;
  });
  const offset = data.bones.map(b => new Vector3(...b.restPosition));
  const restWorld: Vector3[] = [];
  offset.forEach((o, i) => restWorld.push(parent[i]! < 0 ? o.clone() : restWorld[parent[i]!]!.clone().add(o)));
  const W = (n: string) => restWorld[index(n)]!;

  const leg = (id: LegId): LegDef => {
    const front = id[1] === 'F', side = id[0] === 'L' ? 1 : -1, s = side > 0 ? 'L' : 'R';
    const pre = front ? `front_${s}_` : `hind_${s}_`;
    const chain = front ? ['scapula', 'upper', 'fore', 'wrist', 'paw', 'toe'] : ['hip', 'thigh', 'shin', 'hock', 'metatarsal', 'paw', 'toe'];
    const ids = chain.map(c => index(pre + c));
    const [prox, a, b, c] = ids as [number, number, number, number];
    const distal = ids.slice(3, -1), toe = ids[ids.length - 1]!;
    const A = restWorld[a]!, B = restWorld[b]!, C = restWorld[c]!;
    const L1 = A.distanceTo(B), L2 = B.distanceTo(C);
    const hinge = new Vector3().crossVectors(B.clone().sub(A), C.clone().sub(B));
    if (hinge.length() < 1e-6 * L1 * L2) hinge.set(side, 0, 0); else hinge.normalize();
    const u = C.clone().sub(A).normalize();
    const bend = Math.sign(B.clone().sub(A).dot(new Vector3().crossVectors(hinge, u))) || 1;
    const meta = restWorld[distal[distal.length - 1]!]!.clone().sub(C);
    const metaDeg = Math.atan2(-meta.y, Math.hypot(meta.x, meta.z)) * 180 / Math.PI;
    const stanceHeel = Math.max(0, (front ? STANCE_META_DEG.front : STANCE_META_DEG.hind) - metaDeg) * Math.PI / 180;
    return {
      id, side, front, girdle: parent[prox]!, prox, a, b, c, distal, toe,
      digits: [index(`${pre}digit_inner`), index(`${pre}digit_outer`)],
      L1, L2, restRatio: A.distanceTo(C) / (L1 + L2), hinge, bend, padY: restWorld[toe]!.y, restToe: restWorld[toe]!.clone(), stanceHeel,
    };
  };
  const legs = { LF: leg('LF'), RF: leg('RF'), LH: leg('LH'), RH: leg('RH') };
  const shoulderH = (W('front_L_scapula').y + W('front_R_scapula').y) / 2;
  const tail = Array.from({ length: 12 }, (_, i) => index(`tail_${String(i + 1).padStart(2, '0')}`));
  const reach = (l: LegDef) => l.L1 + l.L2 + restWorld[l.c]!.distanceTo(restWorld[l.toe]!);
  const M: Measures = {
    shoulderH, pelvisH: W('pelvis').y, legScale: shoulderH / ADULT_SHOULDER_M,
    depth: 0.40 * shoulderH, halfWidth: 0.17 * shoulderH, skin: 0.03 * shoulderH,
    trunk: W('pelvis').distanceTo(W('spine_05')), pelvisZ: W('pelvis').z, chestZ: W('spine_04').z,
    headZ: W('head').z, headH: W('head').y,
    frontReach: reach(legs.LF), hindReach: reach(legs.LH),
    tailLen: tail.slice(1).reduce((s, i) => s + offset[i]!.length(), 0),
  };
  return {
    names, parent, offset, restWorld, index, legs,
    spine: ['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05'].map(index),
    neck: ['neck_01', 'neck_02'].map(index), tail, M,
  };
}

export function restPose(rig: Rig): Pose {
  return { q: rig.names.map(() => new Quaternion()), root: new Vector3(), pelvis: rig.offset[rig.index('pelvis')]!.clone() };
}

/** World positions and rotations of every joint. */
export function fk(rig: Rig, pose: Pose): World {
  const pos: Vector3[] = [], rot: Quaternion[] = [];
  const pelvis = rig.index('pelvis');
  for (let i = 0; i < rig.names.length; i++) {
    const p = rig.parent[i]!;
    const local = i === 0 ? pose.root : i === pelvis ? pose.pelvis : rig.offset[i]!;
    if (p < 0) { pos.push(local.clone()); rot.push(pose.q[i]!.clone()); continue; }
    pos.push(local.clone().applyQuaternion(rot[p]!).add(pos[p]!));
    rot.push(rot[p]!.clone().multiply(pose.q[i]!));
  }
  return { pos, rot };
}
