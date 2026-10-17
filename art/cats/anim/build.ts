// Turns clip specs into sampled poses at the catalog frame rate.
import { solve, type Body } from './body.ts';
import { type Built, type Catalog, type CatalogClip, type ClipSpec, type Ctx, expandBones } from './catalog.ts';
import { qAngle } from './math.ts';
import { type Pose, type Rig } from './rig.ts';
import { simulateTail } from './tail.ts';

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

export const clonePose = (p: Pose): Pose => ({ q: p.q.map(q => q.clone()), root: p.root.clone(), pelvis: p.pelvis.clone() });

/** Largest joint-rotation difference between two poses (rad), plus translation difference (m). */
export function poseDistance(a: Pose, b: Pose) {
  let rot = 0;
  a.q.forEach((q, i) => { rot = Math.max(rot, qAngle(q.clone().invert().multiply(b.q[i]!))); });
  return { rot, pos: Math.max(a.root.distanceTo(b.root), a.pelvis.distanceTo(b.pelvis)) };
}

export function makeCtx(rig: Rig, catalog: Catalog, clip: CatalogClip): Ctx {
  const n = Math.round(clip.durationS * catalog.fps);
  return { rig, M: rig.M, clip, catalog, T: clip.durationS, n, dt: 1 / catalog.fps, seed: hash(clip.name) };
}

export function buildClip(rig: Rig, catalog: Catalog, clip: CatalogClip, spec: ClipSpec, done: Map<string, Built>): Built & { seam: { rot: number; pos: number } } {
  const ctx = makeCtx(rig, catalog, clip);
  const times = Array.from({ length: ctx.n + 1 }, (_, f) => f * ctx.dt);
  let frames: Pose[], bodies: Body[] | null = null, bones: number[];
  const extras: Record<string, unknown> = {};
  if (spec.additive) {
    const [refName, refFrame] = spec.additive.reference.split('@') as [string, string];
    const ref = done.get(refName);
    if (!ref) throw new Error(`${clip.name}: additive reference ${refName} must be built first`);
    const refPose = ref.frames[Math.round(Number(refFrame) * catalog.fps)]!;
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
    extras.additiveEncoding = 'absolute: each key is reference ⊗ offset; subtract the reference (AnimationUtils.makeClipAdditive) to get the layer';
  } else {
    if (!spec.body) throw new Error(`${clip.name}: no body`);
    bodies = times.map(t => spec.body!(t, ctx));
    if (spec.tailSim) simulateTail(rig, bodies, ctx.dt, clip.loop, spec.tailSim);
    frames = bodies.map(b => solve(rig, b));
    bones = rig.names.map((_, i) => i).filter(i => i !== 0 || clip.rootRotationDeg !== undefined);
  }
  const seam = clip.loop ? poseDistance(frames[0]!, frames[ctx.n]!) : { rot: 0, pos: 0 };
  if (clip.loop) frames[ctx.n] = clonePose(frames[0]!);
  const stance = spec.stance?.(ctx) ?? {};
  const { notes: _notes, name: _name, ...contract } = clip;
  void _notes; void _name;
  Object.assign(extras, contract, {
    fps: catalog.fps, frames: ctx.n + 1,
    stance: Object.fromEntries(Object.entries(stance).map(([k, v]) => [k, v.map(([a, b]) => [round(a), round(b)])])),
    pelvisRest: rig.offset[rig.index('pelvis')]!.toArray(),
    ...(spec.extras?.(ctx) ?? {}),
  });
  return {
    spec, clip, ctx, frames, bones, bodies, stance, extras, seam,
    rootTranslation: clip.rootMotion === true, rootRotation: clip.rootRotationDeg !== undefined,
    pelvisTranslation: !spec.additive,
  };
}

const round = (x: number) => Math.round(x * 10000) / 10000;
