// Turns clip specs into sampled poses at the catalog frame rate.
import { type Body, solve } from './body.ts';
import { type Built, type Catalog, type CatalogClip, type ClipSpec, type Ctx, expandBones } from './catalog.ts';
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
      for (const [name, offset] of Object.entries(spec.additive!.offsets(t, ctx))) {
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
    bodies = times.map(t => spec.body!(t, ctx));
    if (spec.tailSim) simulateTail(rig, bodies, ctx.dt, clip.loop, spec.tailSim);
    const terrain = spec.terrain?.(ctx) ?? (() => 0);
    frames = bodies.map(b => clearFloor(rig, b, terrain));
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
function clearFloor(rig: Rig, b: Body, terrain: (x: number, z: number) => number): Pose {
  let pose = solve(rig, b);
  for (let it = 0; it < 3; it++) {
    const W = fk(rig, pose);
    let moved = false;
    for (const id of LEGS) {
      const d = rig.legs[id], L = b.legs[id];
      const toeFloor = terrain(L.toe[0], L.toe[2]);
      const planted = L.rel < 0.01 && L.cw < 0.01 && Math.abs(L.toe[1] - toeFloor - d.padY) < 1e-4;
      if (planted) continue;
      let deficit = 0;
      for (const j of [d.c, ...d.meta, d.paw, d.toe, ...d.digits]) {
        const p = W.pos[j]!;
        deficit = Math.max(deficit, terrain(p.x, p.z) + 0.003 - p.y);
      }
      if (deficit > 1e-5) { L.toe[1] += deficit; if (L.cw > 0) L.c[1] += deficit; moved = true; }
    }
    if (!moved) break;
    pose = solve(rig, b);
  }
  return pose;
}
