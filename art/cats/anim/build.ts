// Turns clip specs into sampled poses at the catalog frame rate.
import { type Body, solve } from './body.ts';
import { type Built, type Catalog, type CatalogClip, type ClipSpec, type Ctx, expandBones } from './catalog.ts';
import { Quaternion, Vector3 } from 'three';
import { qAngle } from './math.ts';
import { LEGS, type Pose, type Rig, clonePose, fk, localT } from './rig.ts';
import { simulateTail } from './tail.ts';

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** Largest joint-rotation difference between two poses (rad), plus the largest translation difference (m). */
export function poseDistance(rig: Rig, a: Pose, b: Pose) {
  let rot = 0, pos = 0;
  a.q.forEach((q, i) => { rot = Math.max(rot, qAngle(q.clone().invert().multiply(b.q[i]!))); });
  for (let i = 0; i < rig.names.length; i++) pos = Math.max(pos, localT(rig, a, i).distanceTo(localT(rig, b, i)));
  return { rot, pos };
}

export function makeCtx(rig: Rig, catalog: Catalog, clip: CatalogClip): Ctx {
  const n = Math.round(clip.durationS * catalog.fps);
  return { rig, M: rig.M, clip, catalog, T: clip.durationS, n, dt: 1 / catalog.fps, seed: hash(clip.name) };
}

export type BuiltClip = Built & { seam: { rot: number; pos: number } };

export function buildClip(rig: Rig, catalog: Catalog, clip: CatalogClip, spec: ClipSpec, done: Map<string, Built>): BuiltClip {
  const ctx = makeCtx(rig, catalog, clip);
  const times = Array.from({ length: ctx.n + 1 }, (_, f) => f * ctx.dt);
  let frames: Pose[], bodies: Body[] | null = null, bones: number[];
  const extras: Record<string, unknown> = {};
  let translated: number[] = [];
  if (spec.additive) {
    const [refName, refTime] = spec.additive.reference.split('@') as [string, string];
    const ref = done.get(refName);
    if (!ref) throw new Error(`${clip.name}: additive reference ${refName} must be built first`);
    const refPose = ref.frames[Math.round(Number(refTime) * catalog.fps)]!;
    const names = clip.bones ? expandBones(clip.bones, rig.names) : null;
    const touched = new Set<string>();
    frames = times.map(t => {
      const p = clonePose(refPose);
      for (const [name, offset] of Object.entries(spec.additive!.offsets(t, ctx, refPose))) {
        if (names && !names.includes(name)) throw new Error(`${clip.name}: additive offset on ${name}, outside the catalog bone list`);
        touched.add(name);
        const i = rig.index(name);
        p.q[i] = refPose.q[i]!.clone().multiply(offset);
      }
      return p;
    });
    bones = (names ?? [...touched]).map(rig.index).sort((a, b) => a - b);
    extras.additiveReference = spec.additive.reference;
    extras.additiveEncoding = 'absolute keys = reference pose x offset; subtract the reference frame (AnimationUtils.makeClipAdditive on the named clip at the named time, in seconds) to get the layer';
  } else {
    if (!spec.body) throw new Error(`${clip.name}: no body`);
    const substeps = 8;
    const dense = Array.from({ length: ctx.n * substeps + 1 }, (_, f) => spec.body!(f * ctx.dt / substeps, ctx));
    if (spec.tailSim) simulateTail(rig, dense, ctx.dt / substeps, clip.loop, spec.tailSim);
    bodies = dense.filter((_, f) => f % substeps === 0);
    const terrain = spec.terrain?.(ctx) ?? (() => 0);
    frames = [];
    // Solve in time order so redundant limb chains keep the same pole/shoulder
    // branch. Loops are warmed around the boundary before their final sample.
    for (let pass = 0; pass < (clip.loop ? 12 : 1); pass++) {
      let previous = clip.loop ? frames[Math.max(0, ctx.n * substeps - 1)] : undefined;
      frames = dense.map(b => { const p = clearFloor(rig, b, terrain, previous); previous = p; return p; });
      if (clip.loop) {
        // Floor corrections belong to the periodic body too; do not let two
        // identical boundary bodies retain different correction histories.
        dense[dense.length - 1] = structuredClone(dense[0]!);
        const seam = poseDistance(rig, frames[0]!, frames[frames.length - 1]!);
        if (pass > 0 && seam.rot < 0.001 && seam.pos < 0.0001) break;
      }
    }
    frames = frames.filter((_, f) => f % substeps === 0);
    bones = rig.names.map((_, i) => i).filter(i => i !== 0 || clip.rootRotationDeg !== undefined);
    translated = [...new Set(frames.flatMap(p => [...p.t.keys()]))].sort((a, b) => a - b);
  }
  const seam = clip.loop ? poseDistance(rig, frames[0]!, frames[ctx.n]!) : { rot: 0, pos: 0 };
  if (clip.loop) frames[ctx.n] = clonePose(frames[0]!);
  const stance = spec.stance?.(ctx) ?? {};
  const { notes: _notes, name: _name, ...contract } = clip;
  void _notes; void _name;
  Object.assign(extras, contract, {
    fps: catalog.fps, frames: ctx.n + 1,
    stance: Object.fromEntries(Object.entries(stance).map(([k, v]) => [k, v.map(([a, b]) => [round(a), round(b)])])),
    ...(spec.extras?.(ctx) ?? {}),
  });
  return {
    spec, clip, ctx, frames, bones, bodies, stance, extras, seam, translated,
    rootTranslation: clip.rootMotion === true, rootRotation: clip.rootRotationDeg !== undefined,
    pelvisTranslation: !spec.additive,
  };
}

const round = (x: number) => Math.round(x * 10000) / 10000;

/**
 * Solve a body, then lift any unplanted paw whose wrist / hock, metapodial, knuckle or digits would dip below the
 * floor (terrain), re-solving until clear. Planted paws are exact and never moved.
 */
function clearFloor(rig: Rig, b: Body, terrain: (x: number, z: number) => number, prior?: Pose): Pose {
  const liftBody = (dy: number) => {
    b.pelvisOff[1] += dy;
    // Lift body-relative airborne targets with the trunk correction. Leaving
    // them behind collapses a rolling cat's wrists against its shoulders.
    for (const id of LEGS) {
      const L = b.legs[id], d = rig.legs[id];
      const planted = L.rel < 0.01 && L.cw < 0.01 && Math.abs(L.toe[1] - terrain(L.toe[0], L.toe[2]) - d.padY) < 1e-4;
      if (!planted) { L.toe[1] += dy; if (L.cw > 0) L.c[1] += dy; }
    }
  };
  let pose = solve(rig, b, undefined, prior);
  // Trunk, head and ears rest on the floor rather than through it (lying, rolling): lift the body by the deficit.
  const clearance = trunkClearance(rig);
  for (let it = 0; it < 6; it++) {
    const W = fk(rig, pose);
    let deficit = 0;
    clearance.forEach((r, i) => { if (r >= 0) { const p = W.pos[i]!; deficit = Math.max(deficit, terrain(p.x, p.z) + r - p.y); } });
    if (deficit < 1e-5) break;
    liftBody(deficit);
    pose = solve(rig, b, undefined, prior);
  }
  for (let it = 0; it < 20; it++) {
    const W = fk(rig, pose);
    // Moving a lifted wrist can lower its elbow. Resolve that by raising the
    // trunk, rather than raising the paw again and folding through the floor.
    let elbowDeficit = 0;
    for (const d of Object.values(rig.legs)) {
      const p = W.pos[d.b]!;
      elbowDeficit = Math.max(elbowDeficit, terrain(p.x, p.z) + 0.006 * rig.M.legScale - p.y);
    }
    if (elbowDeficit > 1e-5) { liftBody(elbowDeficit); pose = solve(rig, b, undefined, prior); continue; }
    let moved = false;
    for (const id of LEGS) {
      const d = rig.legs[id], L = b.legs[id];
      const toeFloor = terrain(L.toe[0], L.toe[2]);
      const planted = L.rel < 0.01 && L.cw < 0.01 && Math.abs(L.toe[1] - toeFloor - d.padY) < 1e-4;
      if (planted) continue;
      let deficit = 0;
      for (const j of [d.a, d.b, d.c, ...d.meta, d.paw, d.toe, ...d.digits]) {
        const p = W.pos[j]!;
        deficit = Math.max(deficit, terrain(p.x, p.z) + 0.003 - p.y);
      }
      if (deficit > 1e-5) { L.toe[1] += deficit * 1.2; if (L.cw > 0) L.c[1] += deficit * 1.2; moved = true; }
    }
    if (!moved) break;
    pose = solve(rig, b, undefined, prior);
  }
  return tailFloor(rig, pose, terrain);
}

const clearanceCache = new WeakMap<Rig, number[]>();
/** Floor clearance per joint (m) for the trunk pass: body volume around the spine, small for head parts; -1 for limbs and tail. */
function trunkClearance(rig: Rig): number[] {
  let c = clearanceCache.get(rig);
  if (c) return c;
  const hw = rig.M.halfWidth, limb = new Set<number>();
  for (const d of Object.values(rig.legs)) for (const j of [d.b, d.c, ...d.meta, d.paw, d.toe, ...d.digits]) limb.add(j);
  c = rig.names.map((n, i) => {
    if (Object.values(rig.legs).some(d => d.b === i)) return 0.008 * rig.M.legScale;
    if (i === 0 || limb.has(i) || n.startsWith('tail_')) return -1;
    if (n === 'pelvis' || n.startsWith('spine_')) return 0.8 * hw;
    if (n.startsWith('neck_')) return 0.55 * hw;
    if (n === 'head') return 0.5 * hw;
    return 0.003;
  });
  clearanceCache.set(rig, c);
  return c;
}

/** Tail joints rest on the floor rather than through it: the joints above a sinking one share the lift (no kinks). */
function tailFloor(rig: Rig, pose: Pose, terrain: (x: number, z: number) => number): Pose {
  const r = 0.009 * rig.M.legScale, shares = [0.28, 0.24, 0.20, 0.14, 0.09, 0.05];
  for (let pass = 0; pass < 32; pass++) {
    const W = fk(rig, pose);
    let worst = -1, worstDeficit = 1e-5;
    for (let k = 1; k < rig.tail.length; k++) {
      const p = W.pos[rig.tail[k]!]!, deficit = terrain(p.x, p.z) + r - p.y;
      if (deficit > worstDeficit) { worstDeficit = deficit; worst = k; break; }
    }
    if (worst < 0) break;
    const target = W.pos[rig.tail[worst]!]!;
    shares.forEach((share, m) => {
      const j = worst - 1 - m;
      if (j < 0) return;
      const i = rig.tail[j]!, lever = target.clone().sub(W.pos[i]!);
      const horiz = Math.hypot(lever.x, lever.z);
      if (horiz < 1e-4) return;
      const axisW = new Vector3(0, 1, 0).cross(lever).normalize();
      const angle = Math.min(0.1, (share * worstDeficit * 1.1) / horiz);
      const axisL = axisW.applyQuaternion(W.rot[rig.parent[i]!]!.clone().invert());
      pose.q[i] = new Quaternion().setFromAxisAngle(axisL, -angle).multiply(pose.q[i]!);
    });
  }
  return pose;
}
