// Build-failing checks for the animation library (M2-2 acceptance): catalog
// conformance, frame counts, seamless loops, finite unit quaternions,
// anatomical joint limits, planted-paw slip, ground contact and root motion.
import { Vector3 } from 'three';
import { type Built, type Catalog, expandBones } from './catalog.ts';
import { DEG, qAngle } from './math.ts';
import { LEGS, type LegDef, type Rig, fk } from './rig.ts';

export const LIMITS = {
  slipM: 0.002,          // planted toe/paw drift from the ground path during stance
  padHeightM: 0.002,     // planted toe height from its floor
  seamRad: 1.0 * DEG,    // loop seam before the last frame is snapped to the first
  floorM: 0.004,         // joints may not sink below the floor by more than this
  rootM: 0.005,
};

/** Maximum rotation from the rest pose per joint group (degrees). */
const JOINT_MAX: [RegExp, number][] = [
  [/^spine_0[1-5]$/, 32], [/^neck_0[12]$/, 62], [/^head$/, 50], [/^jaw$/, 62],
  [/^ear_[LR]_01$/, 95], [/^ear_[LR]_02$/, 40], [/^eye_[LR]$/, 30], [/^whisker_[LR]$/, 30],
  [/_scapula$/, 50], [/_hip$/, 75], [/_upper$|_thigh$/, 150], [/_fore$|_shin$/, 165],
  [/_wrist$|_hock$/, 160], [/_metatarsal$/, 60], [/_paw$/, 120], [/_toe$/, 60], [/_digit_/, 25],
  [/^tail_0[1-9]$|^tail_1[0-2]$/, 46],
];

export interface Summary { maxSlip: number; maxSlipClip: string; maxSeam: number; clips: number; frames: number; maxTailKink: number }

export function validate(rig: Rig, catalog: Catalog, built: (Built & { seam: { rot: number; pos: number } })[]): Summary {
  const problems: string[] = [];
  const fail = (clip: string, msg: string) => { if (problems.length < 200) problems.push(`${clip}: ${msg}`); };
  const names = new Set(built.map(b => b.clip.name));
  for (const c of catalog.clips) if (!names.has(c.name)) fail(c.name, 'missing from the library');
  if (names.size !== built.length) problems.push('duplicate clip names');
  const limits = rig.names.map(n => JOINT_MAX.find(([re]) => re.test(n))?.[1] ?? 180);
  const summary: Summary = { maxSlip: 0, maxSlipClip: '', maxSeam: 0, clips: built.length, frames: 0, maxTailKink: 0 };
  const I = rig.index;

  for (const b of built) {
    const c = b.clip, name = c.name, fps = catalog.fps, n = b.frames.length - 1;
    summary.frames += b.frames.length;
    if (Math.abs(n / fps - c.durationS) > 1 / fps + 1e-9) fail(name, `duration ${n / fps}s vs catalog ${c.durationS}s`);
    const x = b.extras;
    for (const key of ['layer', 'loop', 'durationS', 'authoredSpeed', 'dutyFactor', 'rootMotion', 'heightM', 'rootRotationDeg', 'reachBone', 'bones'] as const) {
      if (JSON.stringify(x[key]) !== JSON.stringify(c[key])) fail(name, `extras.${key} ${JSON.stringify(x[key])} != catalog ${JSON.stringify(c[key])}`);
    }
    if (JSON.stringify(x.events ?? []) !== JSON.stringify(c.events ?? [])) fail(name, 'extras.events differ from the catalog');
    if (JSON.stringify(x.contacts) !== JSON.stringify(c.contacts)) fail(name, 'extras.contacts differ from the catalog');
    for (const e of c.events ?? []) if (e.t < 0 || e.t > c.durationS) fail(name, `event ${e.name} outside the clip`);
    if (c.layer === 'additive' && typeof x.additiveReference !== 'string') fail(name, 'additive clip without additiveReference');
    if (c.bones) {
      const allowed = new Set(expandBones(c.bones, rig.names).map(I));
      for (const bone of b.bones) if (!allowed.has(bone)) fail(name, `track on ${rig.names[bone]} outside catalog bones`);
    }
    if (b.rootTranslation !== (c.rootMotion === true)) fail(name, 'root translation track does not match catalog rootMotion');
    if (c.loop) {
      summary.maxSeam = Math.max(summary.maxSeam, b.seam.rot);
      if (b.seam.rot > LIMITS.seamRad || b.seam.pos > 0.001) fail(name, `loop seam ${(b.seam.rot / DEG).toFixed(2)}° / ${(b.seam.pos * 1000).toFixed(1)} mm`);
    }

    const terrain = b.spec.terrain?.(b.ctx) ?? (() => 0);
    const worlds = b.frames.map((p, f) => {
      p.q.forEach((q, i) => {
        const arr = q.toArray();
        if (!arr.every(Number.isFinite) || Math.abs(q.length() - 1) > 1e-4) fail(name, `frame ${f} ${rig.names[i]} quaternion not finite/unit`);
      });
      if (![...p.root.toArray(), ...p.pelvis.toArray()].every(Number.isFinite)) fail(name, `frame ${f} translation not finite`);
      return fk(rig, p);
    });

    // Root motion only where catalogued.
    const last = b.frames[n]!;
    if (!c.rootMotion && b.frames.some(p => p.root.length() > 1e-6)) fail(name, 'root moves without catalog rootMotion');
    if (c.rootRotationDeg === undefined && b.frames.some(p => qAngle(p.q[0]!) > 1e-6)) fail(name, 'root rotates without catalog rootRotationDeg');
    if (c.rootRotationDeg !== undefined) {
      const yaw = 2 * Math.atan2(last.q[0]!.y, last.q[0]!.w) / DEG;
      if (Math.abs(yaw - c.rootRotationDeg) > 0.5) fail(name, `root turns ${yaw.toFixed(1)}° vs ${c.rootRotationDeg}°`);
    }
    if (c.heightM !== undefined && Math.abs(last.root.y - c.heightM) > LIMITS.rootM) fail(name, `root ends at ${last.root.y.toFixed(3)} m vs heightM ${c.heightM}`);

    worlds.forEach((W, f) => {
      const p = b.frames[f]!;
      p.q.forEach((q, i) => {
        if (i === 0 || i === I('pelvis')) return;
        const a = qAngle(q) / DEG;
        if (a > limits[i]!) fail(name, `frame ${f} ${rig.names[i]} rotates ${a.toFixed(0)}° (limit ${limits[i]}°)`);
      });
      const jaw = p.q[I('jaw')]!;
      if (2 * Math.asin(Math.max(-1, Math.min(1, jaw.x))) / DEG < -2) fail(name, `frame ${f} jaw closes past rest`);
      for (const id of LEGS) checkHinge(rig, rig.legs[id], W, (m) => fail(name, `frame ${f} ${id} ${m}`));
      // Tail continuity: neighbouring joints may not kink against each other.
      for (let k = 1; k < rig.tail.length - 1; k++) {
        const qa = p.q[rig.tail[k]!]!, qb = p.q[rig.tail[k + 1]!]!;
        const kink = qAngle(qa.clone().invert().multiply(qb));
        summary.maxTailKink = Math.max(summary.maxTailKink, kink);
        if (kink > 36 * DEG) fail(name, `frame ${f} tail kink ${(kink / DEG).toFixed(0)}° at ${rig.names[rig.tail[k + 1]!]}`);
      }
      W.pos.forEach((pos, i) => {
        const floor = terrain(pos.x, pos.z);
        if (pos.y < floor - LIMITS.floorM) fail(name, `frame ${f} ${rig.names[i]} ${((floor - pos.y) * 1000).toFixed(0)} mm below the floor`);
      });
    });

    // Planted paws: toe and paw joints follow the ground (in place: backward at the ground speed).
    for (const id of LEGS) {
      const d = rig.legs[id];
      for (const [t0, t1] of b.stance[id] ?? []) {
        const f0 = Math.ceil(t0 * fps - 1e-6), f1 = Math.floor(t1 * fps + 1e-6);
        const at = (f: number) => worlds[c.loop ? ((f % n) + n) % n : Math.min(f, n)]!;
        const start = [at(f0).pos[d.toe]!.clone(), at(f0).pos[d.distal[d.distal.length - 1]!]!.clone()];
        const floor0 = terrain(start[0]!.x, start[0]!.z);
        if (Math.abs(start[0]!.y - floor0 - d.padY) > LIMITS.padHeightM) fail(name, `${id} planted at ${t0}s with toe ${((start[0]!.y - floor0) * 1000).toFixed(1)} mm above its floor (pad ${(d.padY * 1000).toFixed(1)} mm)`);
        let travel = 0;
        frames: for (let f = f0; f <= f1; f++) {
          if (f > f0) {
            const g = b.spec.groundSpeed;
            if (g) for (let s = 0; s < 4; s++) travel += g(((f - 1 + (s + 0.5) / 4) / fps), b.ctx) / fps / 4;
          }
          const W = at(f), shift = new Vector3(0, 0, -travel);
          for (const [k, joint] of [d.toe, d.distal[d.distal.length - 1]!].entries()) {
            const slip = W.pos[joint]!.distanceTo(start[k]!.clone().add(shift));
            if (slip > summary.maxSlip) { summary.maxSlip = slip; summary.maxSlipClip = `${name} ${id}`; }
            if (slip > LIMITS.slipM) { fail(name, `${id} slips ${(slip * 1000).toFixed(1)} mm at ${(f / fps).toFixed(3)}s (stance ${t0}-${t1})`); break frames; }
          }
        }
      }
    }
  }
  if (problems.length) {
    const message = `Cat animation validation failed:\n  - ${problems.join('\n  - ')}`;
    if (process.env.CAT_NOFAIL !== '1') throw new Error(message);
    console.warn(message);
  }
  return summary;
}

/** Elbows and knees stay on their rest side (no inversion) and never fold flat. */
function checkHinge(rig: Rig, d: LegDef, W: { pos: Vector3[]; rot: import('three').Quaternion[] }, fail: (m: string) => void) {
  const A = W.pos[d.a]!, B = W.pos[d.b]!, C = W.pos[d.c]!;
  const n = d.hinge.clone().applyQuaternion(W.rot[d.prox]!);
  const ab = B.clone().sub(A), bc = C.clone().sub(B);
  const bendAngle = ab.angleTo(bc);
  const u = C.clone().sub(A).normalize();
  const side = ab.dot(new Vector3().crossVectors(n, u)) * d.bend;
  if (side < 0 && bendAngle > 3 * DEG) fail(`${rig.names[d.b]} inverted`);
  if (bendAngle > 165 * DEG) fail(`${rig.names[d.b]} folds ${(bendAngle / DEG).toFixed(0)}°`);
}
