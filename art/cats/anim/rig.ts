// Reads art/rig/skeleton.json and derives everything the clips need from the
// rest pose: limb chains, segment lengths, rest joint angles, pad clearance
// and body proportions. Nothing here hard-codes a joint position, so a
// corrected rest pose (same names, order and parents) produces matching clips.
//
// Bend directions are anatomical, never read from the rest pose: the front
// elbow points backward and the carpus folds the paw back in swing; the hind
// knee (stifle) points forward and the hock (heel) points backward.
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';

export interface RigBone { name: string; parent: string | null; restPosition: [number, number, number] }
export type LegId = 'LF' | 'RF' | 'LH' | 'RH';
export const LEGS: readonly LegId[] = ['LF', 'RF', 'LH', 'RH'];

export interface LegDef {
  id: LegId; side: 1 | -1; front: boolean;
  /** Bone the limb hangs from (spine_04 or pelvis). */
  girdle: number;
  /** Scapula or hip: the proximal segment that rotates (and, for the scapula, slides). */
  prox: number;
  /** Analytic two-bone chain (M2-0): upper/fore/wrist or thigh/shin/hock joints. */
  a: number; b: number; c: number;
  /** Bones sharing the metacarpus / metatarsus world rotation (wrist; hock + metatarsal). */
  meta: number[];
  /** Paw bone (orients the digits), toe bone (claw curl) and the two digit bones. */
  paw: number; toe: number; digits: [number, number];
  /** Segment lengths: proximal (scapula / hip), upper, middle, metapodial axis (c to paw joint), digits. */
  Ls: number; L1: number; L2: number; Lm: number; Ld: number;
  /** Rest metapodial axis (c to paw joint) and digit vector (paw joint to toe joint), world. */
  metaVec: Vector3; digVec: Vector3;
  /** Rest angles below horizontal (rad) of the metapodial axis and the digits. */
  metaRestPitch: number; digRestPitch: number;
  /** Rest signed angle (about +X) from the middle segment to the metapodial axis, and from that axis to the digits. */
  cRest: number; dRest: number;
  /**
   * Bend side of the middle joint along (lateral x limb axis): +1 points it backward (elbow, or a heel), -1 forward
   * (knee). Read from the rest pose when it is clearly bent, otherwise the anatomical default (elbow back, knee forward).
   */
  bendSign: 1 | -1;
  /** Rest angle of the middle segment (forearm / shank) from vertical, + distal end forward. */
  foreRest: number;
  /** Toe joint height above the floor when the pads are flat (pad clearance). */
  padY: number;
  restToe: Vector3;
  /**
   * Standing metapodial pitch (rad below horizontal) for this rig: near the digitigrade ideal
   * (66° fore, 60° hind) while keeping the two-bone chain at a natural extension.
   */
  stanceMeta: number;
  /** How much swing flexion the rig's foot affords (1 for a short digitigrade foot, less for a long one). */
  flexScale: number;
}

/** Digitigrade ideals (rad below horizontal) and natural standing elbow / knee interior angles. */
export const DIGITIGRADE = { metaF: 66 * Math.PI / 180, metaH: 60 * Math.PI / 180, midF: 140 * Math.PI / 180, midH: 105 * Math.PI / 180 };

export interface Measures {
  /** Scapula-top height (withers joint) and the rest pelvis height. */
  shoulderH: number; pelvisH: number;
  /** Shoulder height relative to the 0.30 m adult the catalog speaks of (used only for pose offsets). */
  legScale: number;
  /** Body volumes for floor contact: spine to belly, half width, dorsal skin. */
  depth: number; halfWidth: number; skin: number;
  /** Rest girdle spacing (pelvis to spine_04) and trunk length (pelvis to spine_05). */
  girdle: number; trunk: number;
  pelvisZ: number; chestZ: number; headZ: number; headH: number;
  tailLen: number;
}

export interface Rig {
  names: string[]; parent: number[]; offset: Vector3[]; restWorld: Vector3[];
  index: (name: string) => number;
  legs: Record<LegId, LegDef>;
  spine: number[]; neck: number[]; tail: number[];
  /**
   * Tail neutral: local rotations that take the rest tail (whatever its modelled curve) to a straight tail
   * leaving the pelvis along tailDir. Clips author tail bends against this neutral, so a re-posed rest tail
   * changes no carriage.
   */
  tailNeutral: Quaternion[]; tailDir: Vector3;
  M: Measures;
}

/** Neutral tail carriage: straight, backward and this far below horizontal (a relaxed, slightly lowered tail). */
const TAIL_NEUTRAL_PITCH = 10 * Math.PI / 180;

/** Local rotations plus translations: root, pelvis, and optional per-bone overrides (scapula slide). */
export interface Pose { q: Quaternion[]; root: Vector3; pelvis: Vector3; t: Map<number, Vector3> }
export interface World { pos: Vector3[]; rot: Quaternion[] }

export const ADULT_SHOULDER_M = 0.30;
const X = new Vector3(1, 0, 0);

/** Signed angle from u to v about axis n (right-handed). */
export function signedAngle(u: Vector3, v: Vector3, n: Vector3) {
  const c = new Vector3().crossVectors(u, v);
  return Math.atan2(c.dot(n), u.dot(v));
}

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
  const pitchBelow = (v: Vector3) => Math.atan2(-v.y, Math.hypot(v.x, v.z));

  const leg = (id: LegId): LegDef => {
    const front = id[1] === 'F', side = id[0] === 'L' ? 1 : -1, s = side > 0 ? 'L' : 'R';
    const pre = front ? `front_${s}_` : `hind_${s}_`;
    const I = (n: string) => index(pre + n);
    const prox = I(front ? 'scapula' : 'hip'), a = I(front ? 'upper' : 'thigh'), b = I(front ? 'fore' : 'shin'), c = I(front ? 'wrist' : 'hock');
    const meta = front ? [c] : [c, I('metatarsal')];
    const paw = I('paw'), toe = I('toe');
    const A = restWorld[a]!, B = restWorld[b]!, C = restWorld[c]!, P = restWorld[paw]!, T = restWorld[toe]!;
    const metaVec = P.clone().sub(C), digVec = T.clone().sub(P);
    const mid = C.clone().sub(B).normalize();
    const restBend = B.clone().sub(A).cross(C.clone().sub(A)).x; // < 0: middle joint behind the A-C line
    const interior = Math.PI - B.clone().sub(A).angleTo(mid);
    const bendSign: 1 | -1 = interior < 170 * Math.PI / 180 ? (restBend < 0 ? 1 : -1) : front ? 1 : -1;
    return {
      id, side, front, girdle: parent[prox]!, prox, a, b, c, meta, paw, toe, digits: [I('digit_inner'), I('digit_outer')],
      Ls: restWorld[prox]!.distanceTo(A), L1: A.distanceTo(B), L2: B.distanceTo(C), Lm: metaVec.length(), Ld: digVec.length(),
      metaVec, digVec, metaRestPitch: pitchBelow(metaVec), digRestPitch: pitchBelow(digVec),
      cRest: signedAngle(mid, metaVec.clone().normalize(), X), dRest: signedAngle(metaVec.clone().normalize(), digVec.clone().normalize(), X),
      bendSign, foreRest: Math.atan2(mid.z, -mid.y), padY: T.y, restToe: T.clone(), stanceMeta: 0,
      flexScale: Math.min(1, Math.max(0.35, 0.36 / ((metaVec.length() + digVec.length()) / (A.distanceTo(B) + B.distanceTo(C))))),
    };
  };
  const stanceMeta = (d: LegDef) => {
    const A = restWorld[d.a]!, B = restWorld[d.b]!, C = restWorld[d.c]!;
    const ideal = d.front ? DIGITIGRADE.metaF : DIGITIGRADE.metaH;
    // A rest pose that already stands digitigrade (middle joint on its anatomical side, metapodial steep) is the
    // modeller's own standing posture: keep most of it.
    void B; void C;
    const anatomical = d.bendSign === (d.front ? 1 : -1);
    const plausible = anatomical && d.metaRestPitch > 45 * Math.PI / 180 && d.metaRestPitch < 85 * Math.PI / 180;
    if (plausible) return 0.7 * d.metaRestPitch + 0.3 * ideal;
    // Otherwise search near the ideal for a pitch that keeps the elbow / knee at a natural standing angle.
    const want = d.front ? DIGITIGRADE.midF : DIGITIGRADE.midH;
    const dWant = Math.sqrt(d.L1 * d.L1 + d.L2 * d.L2 - 2 * d.L1 * d.L2 * Math.cos(want));
    let best = ideal, bestCost = Infinity;
    for (let deg = 10; deg <= 85; deg += 0.25) {
      const p = deg * Math.PI / 180;
      const cy = d.padY + d.Ld * Math.sin(d.digRestPitch) + d.Lm * Math.sin(p);
      const cz = d.restToe.z - d.Ld * Math.cos(d.digRestPitch) - d.Lm * Math.cos(p);
      const dist = Math.hypot(A.y - cy, A.z - cz);
      const cost = ((dist - dWant) / (0.05 * (d.L1 + d.L2))) ** 2 + ((p - ideal) / 0.6) ** 2;
      if (cost < bestCost) { bestCost = cost; best = p; }
    }
    return best;
  };
  const legs = { LF: leg('LF'), RF: leg('RF'), LH: leg('LH'), RH: leg('RH') };
  for (const d of Object.values(legs)) d.stanceMeta = stanceMeta(d);
  const shoulderH = (W('front_L_scapula').y + W('front_R_scapula').y) / 2;
  const tail = Array.from({ length: 12 }, (_, i) => index(`tail_${String(i + 1).padStart(2, '0')}`));
  const M: Measures = {
    shoulderH, pelvisH: W('pelvis').y, legScale: shoulderH / ADULT_SHOULDER_M,
    depth: 0.40 * shoulderH, skin: 0.03 * shoulderH,
    halfWidth: Math.max(0.19 * shoulderH, 1.05 * Math.max(Math.abs(W('hind_L_hip').x), Math.abs(W('front_L_scapula').x))),
    girdle: W('pelvis').distanceTo(W('spine_04')), trunk: W('pelvis').distanceTo(W('spine_05')),
    pelvisZ: W('pelvis').z, chestZ: W('spine_04').z, headZ: W('head').z, headH: W('head').y,
    tailLen: tail.slice(1).reduce((sum, i) => sum + offset[i]!.length(), 0),
  };
  // Rest rotations are identity, so the pelvis frame is the rest world frame.
  const tailDir = new Vector3(0, -Math.sin(TAIL_NEUTRAL_PITCH), -Math.cos(TAIL_NEUTRAL_PITCH));
  const tailNeutral: Quaternion[] = [];
  let prev = new Quaternion();
  tail.forEach((_, k) => {
    const child = tail[k + 1];
    const S = child === undefined ? prev.clone() : new Quaternion().setFromUnitVectors(offset[child]!.clone().normalize(), tailDir);
    tailNeutral.push(prev.clone().invert().multiply(S));
    prev = S;
  });
  return {
    names, parent, offset, restWorld, index, legs,
    spine: ['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05'].map(index),
    neck: ['neck_01', 'neck_02'].map(index), tail, tailNeutral, tailDir, M,
  };
}

export function restPose(rig: Rig): Pose {
  return { q: rig.names.map(() => new Quaternion()), root: new Vector3(), pelvis: rig.offset[rig.index('pelvis')]!.clone(), t: new Map() };
}

export const clonePose = (p: Pose): Pose => ({
  q: p.q.map(q => q.clone()), root: p.root.clone(), pelvis: p.pelvis.clone(),
  t: new Map([...p.t].map(([k, v]) => [k, v.clone()])),
});

/** Local translation of bone i in a pose. */
export function localT(rig: Rig, pose: Pose, i: number): Vector3 {
  if (i === 0) return pose.root;
  if (i === 1 && rig.names[1] === 'pelvis') return pose.pelvis;
  return pose.t.get(i) ?? rig.offset[i]!;
}

/** World positions and rotations of every joint. */
export function fk(rig: Rig, pose: Pose): World {
  const pos: Vector3[] = [], rot: Quaternion[] = [];
  const pelvis = rig.index('pelvis');
  for (let i = 0; i < rig.names.length; i++) {
    const p = rig.parent[i]!;
    const local = i === 0 ? pose.root : i === pelvis ? pose.pelvis : pose.t.get(i) ?? rig.offset[i]!;
    if (p < 0) { pos.push(local.clone()); rot.push(pose.q[i]!.clone()); continue; }
    pos.push(local.clone().applyQuaternion(rot[p]!).add(pos[p]!));
    rot.push(rot[p]!.clone().multiply(pose.q[i]!));
  }
  return { pos, rot };
}
