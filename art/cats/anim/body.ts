// A cat pose described the way an animator thinks (paw targets, body angles,
// head gaze, tail shape) and its solve to local bone rotations. Legs use an
// analytic two-bone solve (upper/fore/wrist, thigh/shin/hock) after the
// scapula or hip takes its share of the swing; the distal paw is posed
// from the toe contact upward so planted pads stay exactly where they are put.
import { Quaternion, Vector3 } from 'three';
import { AX, AY, AZ, type V3, clamp, frameQuat, lerp, qAxis, qBody, qPow, wrapPi } from './math.ts';
import { LEGS, type LegDef, type LegId, type Pose, type Rig, type World, fk, restPose } from './rig.ts';

export interface Leg {
  /** World target of the toe joint (the digital pads). */
  toe: V3;
  /** Metacarpus / metatarsus rotation about the paw's lateral axis; + lifts the wrist or hock. */
  heel: number;
  /** Digits (paw bone) pitch; + flexes the digits down and back. */
  toeP: number;
  /** Toe bone flex (claw curl). */
  curl: number;
  spread: number;
  /** World heading of the paw (+ left). */
  yaw: number;
  /** Toe-out, + outward for that side. */
  out: number;
  /** Sole turned inward (+). */
  roll: number;
  /** Extra scapula / hip pitch (+ retracts). */
  swing: number;
  /** Share of the limb's swing taken by the scapula / hip. */
  share: number;
  /** Twist of the hinge plane about the limb axis, + puts the elbow or knee outward. */
  abduct: number;
  /** Preferred elbow / knee extension relative to rest (1 = rest, < 1 more flexed) and its weight. */
  flex: number; comfort: number;
  /** Optional direct target for the wrist / hock joint, blended by cw. */
  c: V3; cw: number;
}

export interface TailCurve { pts: V3[]; w: number }

export interface Body {
  rootPos: V3; rootYaw: number;
  /** Pelvis offset from rest (root frame) and rotation [pitch up, yaw left, roll left-up]. */
  pelvisOff: V3; pelvis: V3;
  spine: V3[]; neck: V3[]; head: V3;
  /** World head orientation [pitch up, yaw left, roll] and how much it overrides the authored neck. */
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

export function restLeg(rig: Rig, id: LegId): Leg {
  const d = rig.legs[id], t = rig.restWorld[d.toe]!;
  return { toe: [t.x, t.y, t.z], heel: 0, toeP: 0, curl: 0, spread: 0, yaw: 0, out: 0, roll: 0, swing: 0,
    share: d.front ? 0.45 : 0.35, abduct: 0, flex: 1, comfort: 1, c: [0, 0, 0], cw: 0 };
}

export function restBody(rig: Rig): Body {
  const z = (): V3 => [0, 0, 0];
  return {
    rootPos: z(), rootYaw: 0, pelvisOff: z(), pelvis: z(),
    spine: Array.from({ length: 5 }, z), neck: [z(), z()], head: z(), gaze: [0, 0, 0, 0], jaw: 0,
    earL: z(), earR: z(), tipL: [0, 0], tipR: [0, 0], eyes: [0, 0, 0, 0], whisk: 0,
    legs: { LF: restLeg(rig, 'LF'), RF: restLeg(rig, 'RF'), LH: restLeg(rig, 'LH'), RH: restLeg(rig, 'RH') },
    tail: Array.from({ length: 12 }, z), tailCurve: null,
  };
}

export const cloneBody = (b: Body): Body => structuredClone(b);

/** Deep merge of a partial description onto a body (arrays of numbers replace, arrays of objects merge by index). */
export function apply<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (over === null || typeof over !== 'object') return over as T;
  if (Array.isArray(over)) {
    if (!Array.isArray(base) || over.every(x => typeof x === 'number')) return over as T;
    return base.map((x, i) => apply(x, over[i])) as T;
  }
  if (base === null || typeof base !== 'object') return over as T;
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = apply(out[k], v);
  return out as T;
}

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

export interface SolveInfo { reachError: number; reachRatio: number }

export const qTail = (t: V3) => qAxis(AY, t[1]).multiply(qAxis(AX, t[0])).multiply(qAxis(AZ, t[2]));

/** Solve a body description to local rotations plus root and pelvis translations. */
export function solve(rig: Rig, b: Body, info?: Record<LegId, SolveInfo>): Pose {
  const pose = restPose(rig), q = pose.q, I = rig.index;
  pose.root.set(...b.rootPos);
  q[0] = qAxis(AY, b.rootYaw);
  pose.pelvis.add(new Vector3(...b.pelvisOff));
  q[I('pelvis')] = qBody(...b.pelvis);
  rig.spine.forEach((i, k) => { q[i] = qBody(...b.spine[k]!); });
  rig.neck.forEach((i, k) => { q[i] = qBody(...b.neck[k]!); });
  q[I('head')] = qBody(...b.head);
  q[I('jaw')] = qAxis(AX, b.jaw);
  for (const [s, ear, tip] of [[1, b.earL, b.tipL], [-1, b.earR, b.tipR]] as const) {
    const n = s > 0 ? 'L' : 'R';
    q[I(`ear_${n}_01`)] = qAxis(AZ, -s * ear[1]).multiply(qAxis(AX, ear[2])).multiply(qAxis(AY, s * ear[0]));
    q[I(`ear_${n}_02`)] = qAxis(AX, tip[0]).multiply(qAxis(AZ, -s * tip[1]));
    q[I(`whisker_${n}`)] = qAxis(AY, -s * b.whisk);
  }
  q[I('eye_L')] = qAxis(AY, b.eyes[0]).multiply(qAxis(AX, -b.eyes[1]));
  q[I('eye_R')] = qAxis(AY, b.eyes[2]).multiply(qAxis(AX, -b.eyes[3]));
  rig.tail.forEach((i, k) => { q[i] = qTail(b.tail[k]!); });

  let W = fk(rig, pose);
  if (b.gaze[3] > 0) {
    const s5 = W.rot[I('spine_05')]!;
    const Qd = s5.clone().invert().multiply(qBody(b.gaze[0], b.gaze[1], b.gaze[2]));
    const chain = [rig.neck[0]!, rig.neck[1]!, I('head')], share = [0.36, 0.34, 0.30];
    chain.forEach((i, k) => { q[i] = q[i]!.clone().slerp(qPow(Qd, share[k]!).multiply(q[i]!), clamp(b.gaze[3], 0, 1)); });
  }
  if (b.tailCurve && b.tailCurve.w > 0) {
    const locals = followCurve(rig, W, b.tailCurve.pts);
    rig.tail.forEach((i, k) => { q[i] = q[i]!.clone().slerp(locals[k]!, clamp(b.tailCurve!.w, 0, 1)); });
  }
  W = fk(rig, pose);
  for (const id of LEGS) {
    const r = solveLeg(rig, q, W, rig.legs[id], b.legs[id]);
    if (info) info[id] = r;
  }
  return pose;
}

const _v = new Vector3();

function solveLeg(rig: Rig, q: Quaternion[], W: World, d: LegDef, L: Leg): SolveInfo {
  const G = W.rot[d.girdle]!, P0 = W.pos[d.prox]!, s = d.side;
  const Rf = qAxis(AY, L.yaw + s * L.out).multiply(qAxis(AZ, -s * L.roll));
  const Rheel = Rf.clone().multiply(qAxis(AX, L.heel));
  const Rdig = Rf.clone().multiply(qAxis(AX, L.toeP));
  const Rtoe = Rf.clone().multiply(qAxis(AX, L.toeP + L.curl));
  const nd = d.distal.length;
  const distRot = d.distal.map((_, k) => (k === nd - 1 ? Rdig : Rheel));
  const J = new Vector3(...L.toe);
  for (let k = nd - 1; k >= 0; k--) {
    const child = k === nd - 1 ? d.toe : d.distal[k + 1]!;
    J.sub(_v.copy(rig.offset[child]!).applyQuaternion(distRot[k]!));
  }
  const Cstar = L.cw > 0 ? J.clone().lerp(new Vector3(...L.c), clamp(L.cw, 0, 1)) : J.clone();

  // Proximal share of the limb swing, measured about the girdle's lateral axis.
  const Ginv = G.clone().invert();
  const rest = rig.restWorld[d.c]!.clone().sub(rig.restWorld[d.prox]!);
  const cur = Cstar.clone().sub(P0).applyQuaternion(Ginv);
  const dTheta = wrapPi(Math.atan2(cur.z, cur.y) - Math.atan2(rest.z, rest.y));
  const offA = rig.offset[d.a]!;
  const Lsum = d.L1 + d.L2, hi = 0.995 * Lsum, lo = Math.abs(d.L1 - d.L2) + 0.08 * Lsum;
  const dist = (alpha: number) => P0.clone().add(offA.clone().applyQuaternion(G.clone().multiply(qAxis(AX, alpha)))).distanceTo(Cstar);
  // The scapula / hip takes its share of the swing, then turns further where that keeps the
  // elbow or knee near its rest flexion (scaled by flex); reach limits are hard constraints.
  const aShare = L.share * dTheta + L.swing, comfort = d.restRatio * L.flex * Lsum, step = 0.5 * Math.PI / 180;
  const cost = (a: number) => {
    const e = dist(a), reach = e > hi ? e - hi : e < lo ? lo - e : 0;
    return 1e4 * reach * reach / (Lsum * Lsum) + L.comfort * ((e - comfort) / Lsum) ** 2 + 0.1 * (a - aShare) ** 2;
  };
  let alpha = aShare, best = Infinity;
  for (let k = -60; k <= 60; k++) { const a = aShare + k * step, c = cost(a); if (c < best) { best = c; alpha = a; } }
  // Parabolic refinement so the girdle angle varies smoothly between frames.
  const cm = cost(alpha - step), cp = cost(alpha + step), den = cm - 2 * best + cp;
  if (den > 1e-12) alpha += clamp(0.5 * (cm - cp) / den, -1, 1) * step;
  const Rprox = qAxis(AX, alpha), Wprox = G.clone().multiply(Rprox);
  q[d.prox] = Rprox;
  const A = P0.clone().add(offA.clone().applyQuaternion(Wprox));
  const D = Cstar.clone().sub(A), raw = D.length();
  // Never fold a knee flat: a swing paw that would need it simply stays a little lower.
  const dc = clamp(raw, Math.abs(d.L1 - d.L2) + 0.06 * Lsum, Lsum * (1 - 1e-7));
  const u = D.normalize();
  const n = d.hinge.clone().applyQuaternion(Wprox).applyQuaternion(qAxis(u, s * L.abduct));
  const vdir = new Vector3().crossVectors(n, u);
  if (vdir.lengthSq() < 1e-10) vdir.set(0, 0, -1).applyQuaternion(Wprox).cross(u);
  vdir.normalize().multiplyScalar(d.bend);
  const cosA = clamp((d.L1 * d.L1 + dc * dc - d.L2 * d.L2) / (2 * d.L1 * dc), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const B = A.clone().addScaledVector(u, d.L1 * cosA).addScaledVector(vdir, d.L1 * sinA);
  const C = A.clone().addScaledVector(u, dc);
  const rA = rig.restWorld[d.a]!, rB = rig.restWorld[d.b]!, rC = rig.restWorld[d.c]!;
  const Wa = frameQuat(B.clone().sub(A), n).multiply(frameQuat(rB.clone().sub(rA), d.hinge).invert());
  const Wb = frameQuat(C.clone().sub(B), n).multiply(frameQuat(rC.clone().sub(rB), d.hinge).invert());
  q[d.a] = Wprox.clone().invert().multiply(Wa);
  q[d.b] = Wa.clone().invert().multiply(Wb);
  let parentW = Wb;
  d.distal.forEach((bone, k) => { q[bone] = parentW.clone().invert().multiply(distRot[k]!); parentW = distRot[k]!; });
  q[d.toe] = parentW.clone().invert().multiply(Rtoe);
  q[d.digits[0]!] = qAxis(AY, -s * L.spread);
  q[d.digits[1]!] = qAxis(AY, s * L.spread);
  return { reachError: C.distanceTo(Cstar), reachRatio: raw / Lsum };
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
  const P = pts.map(p => new Vector3(...p)), out: Vector3[] = [];
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
  const pose = solveTrunk(rig, b);
  const W = fk(rig, pose), i = rig.index(bone);
  return { pos: W.pos[i]!, rot: W.rot[i]! };
}

/** Trunk-only solve (no legs) for frames and gaze. */
export function solveTrunk(rig: Rig, b: Body): Pose {
  const pose = restPose(rig), q = pose.q, I = rig.index;
  pose.root.set(...b.rootPos); q[0] = qAxis(AY, b.rootYaw);
  pose.pelvis.add(new Vector3(...b.pelvisOff)); q[I('pelvis')] = qBody(...b.pelvis);
  rig.spine.forEach((i, k) => { q[i] = qBody(...b.spine[k]!); });
  rig.neck.forEach((i, k) => { q[i] = qBody(...b.neck[k]!); });
  q[I('head')] = qBody(...b.head);
  return pose;
}

/** Body-local point (relative to a bone) to world. */
export function toWorld(frame: { pos: Vector3; rot: Quaternion }, local: V3): V3 {
  const p = new Vector3(...local).applyQuaternion(frame.rot).add(frame.pos);
  return [p.x, p.y, p.z];
}
