// A cat pose described the way an animator thinks (paw targets, trunk angles,
// head gaze, ears, tail shape) and its solve to local bone rotations.
import { Quaternion, Vector3 } from 'three';
import { type Leg, type LegInfo, type V3, defaultLeg, solveLeg } from './legs.ts';
import { AX, AY, AZ, clamp, lerp, qAxis, qBody, qPow } from './math.ts';
import { LEGS, type LegId, type Pose, type Rig, type World, fk, restPose } from './rig.ts';

export type { Leg, V3 };

export interface TailCurve { pts: V3[]; w: number }

export interface Body {
  rootPos: V3; rootYaw: number;
  /** Pelvis offset from rest (root frame) and rotation [pitch up, yaw left, roll left-up]. */
  pelvisOff: V3; pelvis: V3;
  spine: V3[]; neck: V3[]; head: V3;
  /** World head orientation [pitch up, yaw left, roll] and how much it overrides the authored neck/head. */
  gaze: [number, number, number, number];
  jaw: number;
  /** Ear [swivel back, flatten outward, tilt forward]; tips bend [forward, outward]. */
  earL: V3; earR: V3; tipL: [number, number]; tipR: [number, number];
  /** Eye yaw/pitch left then right. */
  eyes: [number, number, number, number];
  /** Whiskers forward (+) / back (-). */
  whisk: number;
  legs: Record<LegId, Leg>;
  /** Tail joints [lift, to the cat's right, twist]. */
  tail: V3[];
  tailCurve: TailCurve | null;
}

export type DeepPartial<T> = T extends (infer U)[] ? (U extends number ? T : DeepPartial<U>[]) : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export function restBody(rig: Rig): Body {
  const z = (): V3 => [0, 0, 0];
  return {
    rootPos: z(), rootYaw: 0, pelvisOff: z(), pelvis: z(),
    spine: Array.from({ length: 5 }, z), neck: [z(), z()], head: z(), gaze: [0, 0, 0, 0], jaw: 0,
    earL: z(), earR: z(), tipL: [0, 0], tipR: [0, 0], eyes: [0, 0, 0, 0], whisk: 0,
    legs: { LF: defaultLeg(rig.legs.LF), RF: defaultLeg(rig.legs.RF), LH: defaultLeg(rig.legs.LH), RH: defaultLeg(rig.legs.RH) },
    tail: Array.from({ length: 12 }, z), tailCurve: null,
  };
}

export const cloneBody = (b: Body): Body => structuredClone(b);

function mixAny(a: unknown, b: unknown, w: number): unknown {
  if (typeof a === 'number') return lerp(a, b as number, w);
  if (Array.isArray(a)) return a.map((x, i) => mixAny(x, (b as unknown[])[i], w));
  if (a && typeof a === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(a)) out[k] = mixAny((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], w);
    return out;
  }
  return w < 0.5 ? a : b;
}

/** Blend two bodies; tail curves fade by weight when only one side has one. */
export function mixBody(a: Body, b: Body, w: number): Body {
  if (w <= 0) return cloneBody(a);
  if (w >= 1) return cloneBody(b);
  const ca = a.tailCurve, cb = b.tailCurve;
  const out = mixAny({ ...a, tailCurve: null }, { ...b, tailCurve: null }, w) as Body;
  if (ca && cb && ca.pts.length === cb.pts.length) out.tailCurve = { pts: mixAny(ca.pts, cb.pts, w) as V3[], w: lerp(ca.w, cb.w, w) };
  else if (ca || cb) {
    const c = (w < 0.5 ? ca : cb) ?? ca ?? cb!;
    out.tailCurve = { pts: c.pts, w: lerp(ca?.w ?? 0, cb?.w ?? 0, w) };
  }
  return out;
}

/** Mirror left/right (authoring a left-side action once and deriving the right). */
export function mirrorBody(b: Body): Body {
  const m = cloneBody(b);
  const mx = (v: V3): V3 => [-v[0], v[1], v[2]];
  const ang = (v: V3): V3 => [v[0], -v[1], -v[2]];
  m.rootPos = mx(b.rootPos); m.rootYaw = -b.rootYaw;
  m.pelvisOff = mx(b.pelvisOff); m.pelvis = ang(b.pelvis);
  m.spine = b.spine.map(ang); m.neck = b.neck.map(ang); m.head = ang(b.head);
  m.gaze = [b.gaze[0], -b.gaze[1], -b.gaze[2], b.gaze[3]];
  m.earL = [...b.earR]; m.earR = [...b.earL]; m.tipL = [...b.tipR]; m.tipR = [...b.tipL];
  m.eyes = [-b.eyes[2], b.eyes[3], -b.eyes[0], b.eyes[1]];
  const leg = (l: Leg): Leg => ({ ...structuredClone(l), toe: mx(l.toe), c: mx(l.c), yaw: -l.yaw });
  m.legs = { LF: leg(b.legs.RF), RF: leg(b.legs.LF), LH: leg(b.legs.RH), RH: leg(b.legs.LH) };
  m.tail = b.tail.map(t => [t[0], -t[1], -t[2]] as V3);
  m.tailCurve = b.tailCurve ? { pts: b.tailCurve.pts.map(mx), w: b.tailCurve.w } : null;
  return m;
}

export const qTail = (t: V3) => qAxis(AY, t[1]).multiply(qAxis(AX, t[0])).multiply(qAxis(AZ, t[2]));

/**
 * Author bends in a common anatomical tail frame, independent of the modelled rest curve.
 * A local rest offset is not a joint axis: each curved rest segment needs its own basis.
 * Accumulate the authored bends first, then convert desired absolute orientations back to locals.
 */
export const TAIL_DIRECTION = new Vector3(0, -Math.sin(10 * Math.PI / 180), -Math.cos(10 * Math.PI / 180));
const tailBases = new WeakMap<Rig, Quaternion[]>();
export function tailRotations(rig: Rig, shape: V3[]): Quaternion[] {
  let bases = tailBases.get(rig);
  if (!bases) {
    bases = rig.tail.map((_, k) => new Quaternion().setFromUnitVectors(
      rig.offset[rig.tail[Math.min(k + 1, rig.tail.length - 1)]!]!.clone().normalize(), TAIL_DIRECTION));
    tailBases.set(rig, bases);
  }
  const authored = new Quaternion();
  let parent = new Quaternion();
  return shape.map((bend, k) => {
    authored.multiply(qTail(bend));
    const absolute = authored.clone().multiply(bases[k]!);
    const local = parent.clone().invert().multiply(absolute).normalize();
    parent = absolute;
    return local;
  });
}

/** Trunk, head, ears, eyes and tail rotations plus translations (no legs). */
export function solveTrunk(rig: Rig, b: Body): Pose {
  const pose = restPose(rig), q = pose.q, I = rig.index;
  pose.root.set(...b.rootPos);
  q[0] = qAxis(AY, b.rootYaw);
  pose.pelvis.add(new Vector3(...b.pelvisOff));
  q[I('pelvis')] = qBody(...b.pelvis);
  rig.spine.forEach((i, k) => { q[i] = qBody(...b.spine[k]!); });
  rig.neck.forEach((i, k) => { q[i] = qBody(...b.neck[k]!); });
  q[I('head')] = qBody(...b.head);
  for (const id of ['LF', 'RF'] as const) {
    const d = rig.legs[id], s = b.legs[id].slide, g = b.legs[id].glide;
    if (s !== 0 || g !== 0) pose.t.set(d.prox, rig.offset[d.prox]!.clone().add(new Vector3(0, s, g)));
  }
  return pose;
}

/** Solve a body description to local rotations plus root, pelvis and scapula translations. */
export function solve(rig: Rig, b: Body, info?: Partial<Record<LegId, LegInfo>>, prior?: Pose): Pose {
  const pose = solveTrunk(rig, b), q = pose.q, I = rig.index;
  q[I('jaw')] = qAxis(AX, b.jaw);
  for (const [s, ear, tip] of [[1, b.earL, b.tipL], [-1, b.earR, b.tipR]] as const) {
    const n = s > 0 ? 'L' : 'R';
    q[I(`ear_${n}_01`)] = qAxis(AZ, -s * ear[1]).multiply(qAxis(AX, ear[2])).multiply(qAxis(AY, s * ear[0]));
    q[I(`ear_${n}_02`)] = qAxis(AX, tip[0]).multiply(qAxis(AZ, -s * tip[1]));
    q[I(`whisker_${n}`)] = qAxis(AY, -s * b.whisk);
  }
  q[I('eye_L')] = qAxis(AY, b.eyes[0]).multiply(qAxis(AX, -b.eyes[1]));
  q[I('eye_R')] = qAxis(AY, b.eyes[2]).multiply(qAxis(AX, -b.eyes[3]));
  const tail = tailRotations(rig, b.tail);
  rig.tail.forEach((i, k) => { q[i] = tail[k]!; });

  let W = fk(rig, pose);
  if (b.gaze[3] > 0) aimHead(rig, pose, W, qAxis(AY, b.rootYaw).multiply(qBody(b.gaze[0], b.gaze[1], b.gaze[2])), clamp(b.gaze[3], 0, 1));
  if (b.tailCurve && b.tailCurve.w > 0) {
    W = fk(rig, pose);
    const locals = followCurve(rig, W, b.tailCurve.pts);
    rig.tail.forEach((i, k) => { q[i] = q[i]!.clone().slerp(locals[k]!, clamp(b.tailCurve!.w, 0, 1)); });
  }
  W = fk(rig, pose);
  for (const id of LEGS) {
    const r = solveLeg(rig, pose, W, rig.legs[id], b.legs[id], prior);
    if (info) info[id] = r;
  }
  return pose;
}

/**
 * Gaze: neck_01, neck_02 and head share (36/34/30 %) the world-space correction that turns the head
 * to the target orientation (root-relative yaw included); w blends from the authored neck/head to it.
 */
function aimHead(rig: Rig, pose: Pose, W: World, target: Quaternion, w: number) {
  const q = pose.q, chain = [rig.neck[0]!, rig.neck[1]!, rig.index('head')], share = [0.36, 0.34, 0.30];
  const parentW = W.rot[rig.parent[chain[0]!]!]!;
  const orig = chain.map(i => q[i]!.clone());
  let remaining = 1;
  for (let k = 0; k < chain.length; k++) {
    const worlds: Quaternion[] = [];
    let acc = parentW.clone();
    for (const i of chain) { acc = acc.clone().multiply(q[i]!); worlds.push(acc); }
    const corr = target.clone().multiply(worlds[chain.length - 1]!.clone().invert());
    const part = qPow(corr, share[k]! / remaining);
    const jointParent = k === 0 ? parentW : worlds[k - 1]!;
    q[chain[k]!] = jointParent.clone().invert().multiply(part).multiply(jointParent).multiply(q[chain[k]!]!);
    remaining -= share[k]!;
  }
  chain.forEach((i, k) => { q[i] = orig[k]!.clone().slerp(q[i]!, w); });
}

/** Lay the tail along a world-space curve starting at tail_01 (wraps, curls, floor contact). */
function followCurve(rig: Rig, W: World, pts: V3[]): Quaternion[] {
  const t0 = rig.tail[0]!, start = W.pos[t0]!;
  const poly = densify([[start.x, start.y, start.z], ...pts]);
  let cur = start.clone(), seg = 0, worldPrev = W.rot[rig.parent[t0]!]!.clone();
  const out: Quaternion[] = [];
  for (let k = 0; k < rig.tail.length; k++) {
    const child = rig.tail[k + 1];
    if (child === undefined) { out.push(new Quaternion()); break; }
    const len = rig.offset[child]!.length();
    let next: Vector3 | null = null;
    for (; seg < poly.length - 1; seg++) {
      const a = poly[seg]!, b2 = poly[seg + 1]!;
      if (b2.distanceTo(cur) >= len) {
        let lo = 0, hi = 1;
        if (a.distanceTo(cur) >= len) hi = 0;
        for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (a.clone().lerp(b2, m).distanceTo(cur) < len) lo = m; else hi = m; }
        next = a.clone().lerp(b2, hi);
        break;
      }
    }
    if (!next) {
      const last = poly[poly.length - 1]!, prev = poly[poly.length - 2]!;
      next = cur.clone().add(last.clone().sub(prev).normalize().multiplyScalar(len));
    }
    const currentDir = rig.offset[child]!.clone().applyQuaternion(worldPrev).normalize();
    const delta = new Quaternion().setFromUnitVectors(currentDir, next.clone().sub(cur).normalize());
    const Wk = delta.multiply(worldPrev);
    out.push(worldPrev.clone().invert().multiply(Wk));
    worldPrev = Wk; cur = next;
  }
  return out;
}

function densify(pts: V3[]): Vector3[] {
  // Chaikin corner cutting (keeping the end points) so authored control polygons give a smooth tail.
  let P = pts.map(p => new Vector3(...p));
  for (let it = 0; it < 2; it++) {
    const Q: Vector3[] = [P[0]!];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i]!, b = P[i + 1]!;
      if (i > 0) Q.push(a.clone().lerp(b, 0.25));
      if (i < P.length - 2) Q.push(a.clone().lerp(b, 0.75));
    }
    Q.push(P[P.length - 1]!);
    P = Q;
  }
  const out: Vector3[] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)]!, p1 = P[i]!, p2 = P[i + 1]!, p3 = P[Math.min(P.length - 1, i + 2)]!;
    for (let s = 0; s < 12; s++) {
      const t = s / 12, t2 = t * t, t3 = t2 * t;
      out.push(new Vector3(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)));
    }
  }
  out.push(P[P.length - 1]!);
  return out;
}

/** World frame of a body part for authoring targets relative to the body (chest or pelvis). */
export function partFrame(rig: Rig, b: Body, bone: string): { pos: Vector3; rot: Quaternion } {
  const W = fk(rig, solveTrunk(rig, b)), i = rig.index(bone);
  return { pos: W.pos[i]!, rot: W.rot[i]! };
}

/** Body-local point (relative to a bone frame) to world. */
export function toWorld(frame: { pos: Vector3; rot: Quaternion }, local: V3): V3 {
  const p = new Vector3(...local).applyQuaternion(frame.rot).add(frame.pos);
  return [p.x, p.y, p.z];
}
