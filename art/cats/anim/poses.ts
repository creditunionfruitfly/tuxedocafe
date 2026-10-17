// Pose library and authoring helpers. Every pose is computed from the rig's
// measured proportions (shoulder height, girdles, limb chains, stance
// pitches) so it adapts to corrected rest poses; nothing here is a
// hard-coded joint position. Offsets scale with M.legScale (0.30 m adult).
import { Vector3 } from 'three';
import { type Body, type Leg, cloneBody, mixBody, partFrame, restBody, solveTrunk, toWorld } from './body.ts';
import { type V3, clamp, curve, lerp, smooth, smoother } from './math.ts';
import { LEGS, type LegId, type Rig, fk } from './rig.ts';

export const STANCE_WIDTH = 0.85;
const DEG = Math.PI / 180;

/** Trunk placement: drops (m) of pelvis and chest, spine arch (+ humps the back), surge (m forward). */
export function setTrunk(rig: Rig, b: Body, o: { pelvisDrop?: number; chestDrop?: number; arch?: number; surge?: number; yaw?: number; roll?: number; lateral?: number; pitch?: number }) {
  const M = rig.M, ph = o.pelvisDrop ?? 0, ch = o.chestDrop ?? 0, arch = o.arch ?? 0;
  const pitch = Math.asin(clamp((ph - ch) / M.girdle, -1, 1)) + arch * 0.5 + (o.pitch ?? 0);
  b.pelvisOff = [o.lateral ?? 0, -ph, o.surge ?? 0];
  b.pelvis = [pitch, o.yaw ?? 0, o.roll ?? 0];
  const w = [0.24, 0.24, 0.2, 0.18, 0.14];
  b.spine = b.spine.map((s, k) => [s[0] - arch * w[k]!, s[1], s[2]] as V3);
  return b;
}

/** Spread a total bend over the five spine joints (pitch up, yaw left, roll). */
export function bendSpine(b: Body, pitch: number, yaw: number, roll = 0, w: readonly number[] = [0.2, 0.2, 0.2, 0.2, 0.2]) {
  b.spine = b.spine.map((s, k) => [s[0] + pitch * w[k]!, s[1] + yaw * w[k]!, s[2] + roll * w[k]!] as V3);
  return b;
}

/** Tail shape as per-joint [lift, toRight, twist]: base angle, spread curvature, tip curl and side sweep. */
export function tailShape(o: { base?: number; lift?: number; tip?: number; side?: number; tipSide?: number; baseSide?: number }): V3[] {
  return Array.from({ length: 12 }, (_, i) => {
    const tipW = smooth((i - 6) / 5);
    return [
      (i === 0 ? (o.base ?? 0) : 0) + (i > 0 ? (o.lift ?? 0) / 11 : 0) + (o.tip ?? 0) * tipW / 3,
      (i === 0 ? (o.baseSide ?? 0) : 0) + (i > 0 ? (o.side ?? 0) / 11 : 0) + (o.tipSide ?? 0) * tipW / 3,
      0,
    ] as V3;
  });
}

/** Relaxed standing tail: base angled down, a soft S with the tip lifting. */
export const standTail = () => tailShape({ base: -0.42, lift: -0.45, tip: 0.6 });

const worldOf = (rig: Rig, b: Body, bone: string) => fk(rig, solveTrunk(rig, b)).pos[rig.index(bone)]!;

/** Standing toe placement: forepaw under a vertical forearm, hind paw just ahead of the hip joint. */
export function standToe(rig: Rig, id: LegId): V3 {
  const d = rig.legs[id], A = rig.restWorld[d.a]!;
  const z = d.front
    ? A.z - d.L1 * Math.sin(25 * DEG) + d.Lm * Math.cos(d.stanceMeta) + d.Ld * Math.cos(d.digRestPitch)
    : A.z + 0.1 * (d.L1 + d.L2);
  return [d.restToe.x * STANCE_WIDTH, d.padY, z];
}

/** Planted stance leg with the rig's digitigrade pitches. */
export function plantLeg(rig: Rig, L: Leg, id: LegId, toe: V3) {
  const d = rig.legs[id];
  L.toe = [...toe]; L.meta = d.stanceMeta; L.dig = d.digRestPitch; L.rel = 0; L.cw = 0;
  L.out = d.front ? 0.05 : 0.08;
  if (d.front) { L.fore = 0.03; L.foreK = 0.5; L.foreW = 1.2; L.share = 0.38; }
  return L;
}

export function standBody(rig: Rig): Body {
  const b = restBody(rig), M = rig.M;
  for (const id of LEGS) plantLeg(rig, b.legs[id], id, standToe(rig, id));
  setTrunk(rig, b, { pelvisDrop: 0.02 * M.shoulderH, chestDrop: 0.03 * M.shoulderH });
  b.gaze = [-0.06, 0, 0, 0.9];
  b.earL = [0.05, 0.02, 0.06]; b.earR = [0.05, 0.02, 0.06];
  b.tail = standTail();
  return b;
}

/** Simple bisection for monotone f(x) = target on [lo, hi]. */
export function solve1d(f: (x: number) => number, target: number, lo: number, hi: number) {
  const flo = f(lo) - target;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2, fm = f(m) - target;
    if (Math.sign(fm) === Math.sign(flo)) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** Metapodial lying on the floor (hock or wrist resting down): pitch that puts the joint a skin's depth up. */
export const flatMeta = (rig: Rig, id: LegId) => {
  const d = rig.legs[id];
  const pawY = d.padY + d.Ld * Math.sin(d.digRestPitch);
  return Math.asin(clamp((0.012 * rig.M.legScale + 0.004 - pawY) / d.Lm, -0.3, 0.6));
};

/** Folded hind leg of a sitting / crouching cat: metatarsus on the floor, knee forward and a little out. */
export function foldHind(rig: Rig, L: Leg, id: LegId) {
  L.meta = flatMeta(rig, id); L.dig = rig.legs[id].digRestPitch; L.rel = 0;
  L.abduct = 0.22; L.out = 0.14; L.share = 0.2; L.foreW = 0.3;
  return L;
}

/** Upright sit: rump on the floor just behind the hocks, metatarsi flat, front legs vertical. */
export function sitBody(rig: Rig, from?: Body): Body {
  const M = rig.M, b = from ? cloneBody(from) : standBody(rig), k = M.legScale;
  for (const id of ['LH', 'RH'] as const) {
    const d = rig.legs[id], L = b.legs[id];
    foldHind(rig, L, id);
    // Paws a metatarsus length ahead of the hock, which sits under the hip.
    L.toe = [d.restToe.x * STANCE_WIDTH * 1.05, d.padY, rig.restWorld[d.a]!.z + d.Lm * 0.95 + d.Ld * 0.8 + 0.01 * k];
  }
  const rest = rig.offset[rig.index('pelvis')]!;
  const hipZ = rig.restWorld[rig.legs.LH.a]!.z;
  const pelvisY = Math.max(0.24 * M.shoulderH, M.halfWidth * 0.9);
  b.pelvisOff = [0, pelvisY - rest.y, (hipZ - 0.02 * k) - rig.restWorld[rig.legs.LH.a]!.z];
  b.spine = [[-0.12, 0, 0], [-0.1, 0, 0], [-0.07, 0, 0], [-0.03, 0, 0], [0.02, 0, 0]];
  // Tilt the pelvis until the shoulder joint sits at the height of a near-straight, vertical foreleg.
  const d = rig.legs.LF;
  const legH = d.padY + d.Ld * Math.sin(d.digRestPitch) + d.Lm * Math.sin(d.stanceMeta) + 0.97 * (d.L1 + d.L2);
  const shoulderAt = (p: number) => { b.pelvis = [p, 0, 0]; return worldOf(rig, b, rig.names[d.a]!).y; };
  b.pelvis = [solve1d(shoulderAt, legH, 0.2, 1.45), 0, 0];
  for (const id of ['LF', 'RF'] as const) {
    const dd = rig.legs[id], A = worldOf(rig, b, rig.names[dd.a]!), L = b.legs[id];
    plantLeg(rig, L, id, [dd.restToe.x * STANCE_WIDTH * 0.9, dd.padY, A.z + dd.Lm * Math.cos(dd.stanceMeta) + dd.Ld * Math.cos(dd.digRestPitch) - 0.005 * k]);
    L.fore = 0; L.foreK = 0.3; L.share = 0.3;
  }
  b.gaze = [-0.04, 0, 0, 1];
  b.earL = [0.05, 0.02, 0.05]; b.earR = [0.05, 0.02, 0.05];
  b.tailCurve = { pts: wrapCurve(rig, b, -1), w: 1 };
  return b;
}

/** Tail lying on the floor from the rump around one side (side = -1 the cat's right) toward the front paws. */
export function wrapCurve(rig: Rig, b: Body, side: number, reach = 1): V3[] {
  const M = rig.M, k = M.legScale;
  const base = worldOf(rig, b, 'tail_01');
  const fz = (b.legs.LF.toe[2] + b.legs.RF.toe[2]) / 2, fx = side * Math.abs(b.legs.LF.toe[0]);
  const y = 0.02 * k, r = 0.07 * k, hx = side * (Math.abs(b.legs.LH.toe[0]) + 0.03 * k);
  // Down off the rump, round the haunch, then forward along the floor to the paws.
  return [
    [base.x, lerp(base.y, y, 0.55), base.z - 0.04 * k],
    [side * 0.012 * k, y + 0.006 * k, base.z - 0.08 * k],
    [hx * 0.8, y, base.z - 0.095 * k],
    [hx + side * r * 0.55, y, base.z - 0.055 * k],
    [hx + side * r * 0.75, y, base.z + 0.01 * k],
    [hx + side * r * 0.65, y, lerp(base.z, fz, 0.5)],
    [fx + side * 0.045 * k, y, lerp(base.z, fz, 0.88 * reach)],
    [fx * 0.4, y, fz + 0.03 * k * reach],
  ];
}

/** Bread-loaf: chest resting on folded forelegs (paws tucked), hind legs folded under, compact and round. */
export function loafBody(rig: Rig): Body {
  const M = rig.M, b = standBody(rig), k = M.legScale;
  const rest = rig.offset[rig.index('pelvis')]!;
  const pelvisY = M.depth * 1.0, chestY = M.depth * 1.08;
  b.pelvisOff = [0, pelvisY - rest.y, 0.015 * k];
  b.pelvis = [Math.asin(clamp((chestY - pelvisY) / M.girdle, -1, 1)) + 0.05, 0, 0];
  b.spine = [[0.04, 0, 0], [-0.01, 0, 0], [-0.04, 0, 0], [-0.04, 0, 0], [0, 0, 0]];
  const chest = partFrame(rig, b, 'spine_04');
  for (const id of ['LF', 'RF'] as const) {
    const d = rig.legs[id], L = b.legs[id];
    // Wrist on the floor under the chest, forearm along the floor, paw folded back under it.
    L.c = [d.side * 0.028 * k, 0.014 * k, chest.pos.z + 0.035 * k]; L.cw = 1;
    L.rel = 1; L.carpus = 150 * DEG; L.digits = 0.5; L.curl = 0.25;
    L.share = 0.25; L.fore = 1.35; L.foreK = 0; L.foreW = 2; L.abduct = 0.35;
  }
  for (const id of ['LH', 'RH'] as const) {
    const d = rig.legs[id], L = b.legs[id];
    foldHind(rig, L, id);
    L.toe = [d.side * (Math.abs(d.restToe.x) * 0.9 + 0.012 * k), d.padY, rig.restWorld[d.a]!.z + b.pelvisOff[2] + d.Lm * 1.05 + d.Ld];
    L.abduct = 0.35; L.out = 0.2;
  }
  b.gaze = [-0.08, 0, 0, 1];
  b.neck = [[-0.12, 0, 0], [0.05, 0, 0]];
  b.earL = [0.12, 0.08, 0]; b.earR = [0.12, 0.08, 0];
  b.tailCurve = { pts: hugCurve(rig, b, -1), w: 1 };
  return b;
}

/** Tail laid tight along one side of a lying body. */
export function hugCurve(rig: Rig, b: Body, side: number): V3[] {
  const k = rig.M.legScale, base = worldOf(rig, b, 'tail_01'), chest = worldOf(rig, b, 'spine_04');
  const y = 0.02 * k, x = side * (rig.M.halfWidth + 0.025 * k);
  return [
    [base.x, lerp(base.y, y, 0.45), base.z - 0.045 * k],
    [side * 0.012 * k, lerp(base.y, y, 0.85), base.z - 0.09 * k],
    [x * 0.55, y, base.z - 0.105 * k],
    [x * 0.95, y, base.z - 0.065 * k],
    [x * 1.08, y, base.z + 0.01 * k],
    [x * 1.08, y, lerp(base.z, chest.z, 0.45)],
    [x * 0.98, y, lerp(base.z, chest.z, 0.85)],
  ];
}

/** Body-frame placement for lying poses: point relative to a trunk bone, lifted to the floor if needed. */
export function bodyPoint(rig: Rig, b: Body, bone: string, local: V3, floor = 0.012): V3 {
  const p = toWorld(partFrame(rig, b, bone), local.map(v => v * rig.M.legScale) as V3);
  p[1] = Math.max(p[1], floor * rig.M.legScale);
  return p;
}

/** Free (off-ground) leg: joint angles relative to the limb, toe aimed at a body-relative point. */
export function freeLeg(L: Leg, toe: V3, carpus: number, digits: number, o: Partial<Leg> = {}) {
  L.toe = [...toe]; L.rel = 1; L.cw = 0; L.carpus = carpus; L.digits = digits;
  Object.assign(L, o);
  return L;
}

/** Lying on the right side (roll + lifts the left side), legs relaxed; stretch 0..1 lengthens everything. */
export function lieSideBody(rig: Rig, roll = 80 * DEG, stretch = 0): Body {
  const M = rig.M, b = standBody(rig), k = M.legScale;
  const rest = rig.offset[rig.index('pelvis')]!;
  b.pelvisOff = [-M.halfWidth * 0.35, M.halfWidth * 1.05 + 0.008 * k - rest.y, 0];
  b.pelvis = [0.02, 0, roll];
  b.spine = [[0.01, 0.02, 0.02], [0.02 - 0.03 * stretch, 0.02, 0], [0.02 - 0.03 * stretch, 0.01, 0], [0.02, 0, -0.02], [0.02, 0, -0.03]];
  b.gaze = [0, 0, 0, 0];
  b.neck = [[0.06 + 0.1 * stretch, -0.1, -0.22], [0.05, -0.1, -0.28]];
  b.head = [0.05, -0.05, -0.32];
  const front = (id: LegId, fwd: number, down: number, out: number) => {
    const L = b.legs[id], d = rig.legs[id];
    freeLeg(L, bodyPoint(rig, b, 'spine_04', [d.side * out, -down, fwd]), (0.7 - 0.6 * stretch), 0.2 - 0.3 * stretch,
      { share: 0.3, fore: 0.6 + 0.6 * stretch, foreK: 0, foreW: 0.6, curl: 0.2, yaw: 0, out: 0 });
  };
  const hind = (id: LegId, fwd: number, down: number, out: number) => {
    const L = b.legs[id], d = rig.legs[id];
    freeLeg(L, bodyPoint(rig, b, 'pelvis', [d.side * out, -down, fwd]), (0.9 - 0.7 * stretch), 0.1 - 0.2 * stretch,
      { share: 0.3, foreW: 0.3, curl: 0.12, yaw: 0, out: 0 });
  };
  front('RF', 0.1 + stretch * 0.12, 0.2, 0.02); front('LF', 0.15 + stretch * 0.1, 0.18, 0.09);
  hind('RH', 0.05 - stretch * 0.14, 0.2, 0.03); hind('LH', 0.09 - stretch * 0.1, 0.17, 0.11);
  b.earL = [0.22, 0.1, -0.05]; b.earR = [0.22, 0.1, -0.05];
  b.tailCurve = null;
  b.tail = tailShape({ base: -0.25, lift: 0.1, side: 0.35, tipSide: 0.4 });
  return b;
}

/** Tight sleeping ring: nearly sternal, spine bent round to bring the nose to the hind paws, tail over the nose. */
export function curlBody(rig: Rig): Body {
  const M = rig.M, b = loafBody(rig), k = M.legScale;
  const rest = rig.offset[rig.index('pelvis')]!;
  b.pelvisOff = [0.02 * k, M.depth * 0.62 - rest.y, 0.02 * k];
  b.pelvis = [0.04, 0.35, 0.42];
  b.spine = [[-0.05, 0.2, 0.03], [-0.06, 0.24, 0.03], [-0.06, 0.26, 0.02], [-0.07, 0.26, 0], [-0.06, 0.24, -0.02]];
  b.neck = [[-0.32, 0.6, -0.18], [-0.38, 0.55, -0.15]];
  b.head = [-0.2, 0.42, -0.25];
  b.gaze = [0, 0, 0, 0];
  const chest = partFrame(rig, b, 'spine_04'), pelv = partFrame(rig, b, 'pelvis');
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id], d = rig.legs[id];
    const c = toWorld(chest, [d.side * 0.03 * k, -M.depth * 0.95, 0.05 * k]);
    L.c = [c[0], Math.max(c[1], 0.014 * k), c[2]]; L.cw = 1; L.rel = 1; L.carpus = 140 * DEG; L.digits = 0.5;
  }
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id], d = rig.legs[id];
    const t = toWorld(pelv, [d.side * 0.05 * k, -M.depth * 0.95, 0.16 * k]);
    L.toe = [t[0], Math.max(t[1], d.padY), t[2]];
    L.rel = 1; L.carpus = 120 * DEG; L.digits = 0.3;
  }
  b.earL = [0.3, 0.2, -0.05]; b.earR = [0.3, 0.2, -0.05];
  b.tailCurve = null;
  return b;
}

// ---------------------------------------------------------------- authoring helpers

export type Key = [number, Body] | [number, Body, (t: number) => number];

/** Blend through keyed bodies; each segment eases with its own curve (default smootherstep). */
export function keyed(t: number, keys: readonly Key[]): Body {
  if (t <= keys[0]![0]) return cloneBody(keys[0]![1]);
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, b0] = keys[i]!, [t1, b1, ease] = keys[i + 1]!;
    if (t <= t1) return mixBody(b0, b1, (ease ?? smoother)((t - t0) / (t1 - t0)));
  }
  return cloneBody(keys[keys.length - 1]![1]);
}

/** Overlapping action: head, ears and tail follow the keyed trunk with their own lag (seconds). */
export function keyedLag(t: number, keys: readonly Key[], lag: { head?: number; tail?: number; ears?: number } = {}): Body {
  const b = keyed(t, keys);
  if (lag.head) { const h = keyed(t - lag.head, keys); b.neck = h.neck; b.head = h.head; b.gaze = h.gaze; b.jaw = h.jaw; b.eyes = h.eyes; }
  if (lag.ears) { const e = keyed(t - lag.ears, keys); b.earL = e.earL; b.earR = e.earR; b.tipL = e.tipL; b.tipR = e.tipR; }
  if (lag.tail) { const tl = keyed(t - lag.tail, keys); b.tail = tl.tail; b.tailCurve = tl.tailCurve; }
  return b;
}

/** Paw path from one floor point to another between t0 and t1: lift sharply, travel low, set down softly. */
export function step(t: number, t0: number, t1: number, from: V3, to: V3, lift: number): { pos: V3; s: number; air: boolean } {
  const s = clamp((t - t0) / (t1 - t0), 0, 1);
  const prog = curve([[0, 0], [0.16, 0.05], [0.5, 0.52], [0.84, 0.96], [1, 1]])(s);
  const h = curve([[0, 0], [0.14, 0.55], [0.38, 1], [0.72, 0.6], [0.92, 0.12], [1, 0]])(s);
  return { pos: [lerp(from[0], to[0], prog), lerp(from[1], to[1], prog) + lift * h, lerp(from[2], to[2], prog)], s, air: s > 0 && s < 1 };
}

/**
 * A stepping paw: planted at both ends, free in the air with the carpus / hock folding (peak flexion `flex`, rad) and
 * the digits curling, so a lifted forepaw folds back instead of dangling stiff.
 */
export function stepLeg(rig: Rig, L: Leg, id: LegId, t: number, t0: number, t1: number, from: V3, to: V3, lift: number, flex = 1.2) {
  const st = step(t, t0, t1, from, to, lift);
  L.toe = st.pos;
  if (st.air) {
    const d = rig.legs[id];
    L.rel = smooth(st.s / 0.15) * (1 - smooth((st.s - 0.8) / 0.18));
    L.carpus = flex * d.flexScale * Math.sin(Math.PI * Math.min(1, st.s * 1.15)) ** 0.8 + (d.front ? -0.25 : 0.9) * (1 - Math.sin(Math.PI * st.s));
    L.digits = d.dRest * (1 - Math.sin(Math.PI * st.s)) + 0.15 * Math.sin(Math.PI * st.s);
    L.curl = 0.2 * Math.sin(Math.PI * st.s);
    L.meta = d.stanceMeta + (d.front ? 0.5 : 0.3) * Math.sin(Math.PI * st.s);
  }
  return st;
}

/** Natural resting breath: quick inhale, slower exhale, short pause. Returns 0..1 inflation. */
export function breath(t: number, period: number) {
  const p = ((t / period) % 1 + 1) % 1;
  return curve([[0, 0], [0.36, 1], [0.48, 0.96], [0.86, 0.04], [1, 0]])(p);
}

/** Breathing in the ribs: spine_02..04 arch slightly with the breath; tiny shoulder rise. */
export function addBreath(b: Body, t: number, period: number, amp: number) {
  const x = breath(t, period) - 0.5;
  b.spine[1]![0] += amp * x; b.spine[2]![0] += amp * 0.6 * x; b.spine[3]![0] -= amp * 0.9 * x; b.spine[4]![0] -= amp * 0.3 * x;
  return b;
}

/** Ear swivel event: one ear turns back and returns (side 1 = left). */
export function earFlick(b: Body, t: number, t0: number, side: 1 | -1, amount = 0.6, dur = 0.5) {
  const w = t < t0 ? 0 : t < t0 + 0.08 ? smooth((t - t0) / 0.08) : Math.max(0, 1 - smooth((t - t0 - 0.08 - dur * 0.4) / (dur * 0.6)));
  const ear = side > 0 ? b.earL : b.earR;
  ear[0] += amount * w; ear[1] += amount * 0.25 * w;
  return b;
}

/** Stance intervals as the complement of each paw's airborne windows. */
export function stanceFromAir(T: number, air: Partial<Record<LegId, [number, number][]>>, legs: readonly LegId[] = LEGS) {
  const out: Partial<Record<LegId, [number, number][]>> = {};
  for (const id of legs) {
    const w = [...(air[id] ?? [])].sort((a, b) => a[0] - b[0]);
    const iv: [number, number][] = [];
    let from = 0;
    for (const [a, b] of w) { if (a > from + 1e-6) iv.push([from, a]); from = b; }
    if (T > from + 1e-6) iv.push([from, T]);
    out[id] = iv;
  }
  return out;
}

/** Head frame helper: world point relative to the head joint. */
export const headPoint = (rig: Rig, b: Body, local: V3) => toWorld(partFrame(rig, b, 'head'), local.map(v => v * rig.M.legScale) as V3);

/** Periodic lick / chew pulse train: n quick closes per period with a fast open and slower close. */
export function chew(t: number, period: number, n: number, open = 0.35) {
  const p = ((t / period) * n % 1 + 1) % 1;
  return p < open ? smooth(p / open) : 1 - smooth((p - open) / (1 - open));
}

export const vec3 = (v: V3) => new Vector3(...v);
