// Build-failing checks for the animation library (M2-2 acceptance): catalog
// conformance, frame counts, seamless loops, finite unit quaternions,
// anatomical joint limits (elbows behind, knees in front, carpus / hock and
// digit ranges), planted-paw slip and pad height, catalogued footfalls,
// ground penetration and root motion only where catalogued.
import { Quaternion, Vector3 } from 'three';
import { type Built, type Catalog, expandBones } from './catalog.ts';
import { DEG, qAngle } from './math.ts';
import { LEGS, type LegDef, type Rig, type World, fk, localT } from './rig.ts';

export const LIMITS = {
  slipM: 0.002,          // planted toe / paw joint drift from its ground path during stance
  padHeightM: 0.002,     // planted toe joint height error from the pad height
  seamRad: 1.0 * DEG,    // loop seam before the last frame is snapped to the first
  seamM: 0.001,
  floorM: 0.004,         // joints may not sink below the floor by more than this
  rootM: 0.005,
  swingLiftM: 0.004,     // a catalogued swing must lift the toe at least this far
};

/** Maximum rotation from the rest pose per non-limb joint group (degrees). */
const JOINT_MAX: [RegExp, number][] = [
  [/^spine_0[1-5]$/, 32], [/^neck_0[12]$/, 62], [/^head$/, 50], [/^jaw$/, 62],
  [/^ear_[LR]_01$/, 95], [/^ear_[LR]_02$/, 45], [/^eye_[LR]$/, 30], [/^whisker_[LR]$/, 30],
  [/_toe$/, 60], [/_digit_/, 25], [/_metatarsal$/, 1], [/^tail_01$/, 110], [/^tail_\d\d$/, 55],
];

/** Anatomical ranges (degrees): middle joint interior, carpus / hock flexion, digits, prox rotation. */
export const ANATOMY = {
  midMin: 20, midMax: 178,
  carpusF: [-85, 160] as const, hockH: [-15, 170] as const,
  digits: [-115, 85] as const, prox: 75, slideFrac: 0.15,
};

export interface Summary {
  maxQuaternionError: number; minMiddleDeg: number; maxMiddleDeg: number;
  carpusDeg: [number, number]; hockDeg: [number, number]; maxTailDeg: number;
  maxProxDeg: number; maxScapulaSlideM: number;
  maxSlip: number; maxSlipClip: string; maxSeam: number; clips: number; frames: number; maxTailKink: number; minSwingLift: number }

const AX = new Vector3(1, 0, 0);

/** Anatomical joint angles of one leg from world positions and the limb's hinge axis. */
export function legAngles(d: LegDef, W: World) {
  const A = W.pos[d.a]!, B = W.pos[d.b]!, C = W.pos[d.c]!, P = W.pos[d.paw]!, T = W.pos[d.toe]!;
  const hinge = AX.clone().applyQuaternion(W.rot[d.b]!);
  const ab = B.clone().sub(A), bc = C.clone().sub(B), cp = P.clone().sub(C), pt = T.clone().sub(P);
  const signed = (u: Vector3, v: Vector3) => Math.atan2(new Vector3().crossVectors(u, v).dot(hinge), u.dot(v));
  const mid = Math.PI - ab.angleTo(bc);
  const bendSide = -Math.sign(new Vector3().crossVectors(ab, C.clone().sub(A)).dot(hinge));
  return { mid, bendSide, carpus: (d.front ? 1 : -1) * signed(bc, cp), digits: signed(cp, pt) };
}

export function validate(rig: Rig, catalog: Catalog, built: (Built & { seam: { rot: number; pos: number } })[]): Summary {
  const problems: string[] = [];
  const cap = Number(process.env.CAT_MAXPROBLEMS ?? 200);
  const fail = (clip: string, msg: string) => { if (problems.length < cap) problems.push(`${clip}: ${msg}`); };
  const names = new Set(built.map(b => b.clip.name));
  for (const c of catalog.clips) if (!names.has(c.name)) fail(c.name, 'missing from the library');
  if (names.size !== built.length) problems.push('duplicate clip names');
  const limits = rig.names.map(n => JOINT_MAX.find(([re]) => re.test(n))?.[1] ?? 180);
  const summary: Summary = { maxQuaternionError: 0, minMiddleDeg: Infinity, maxMiddleDeg: -Infinity, carpusDeg: [Infinity, -Infinity], hockDeg: [Infinity, -Infinity], maxTailDeg: 0, maxProxDeg: 0, maxScapulaSlideM: 0, maxSlip: 0, maxSlipClip: '', maxSeam: 0, clips: built.length, frames: 0, maxTailKink: 0, minSwingLift: Infinity };
  const I = rig.index;
  const legBones = new Set(LEGS.flatMap(id => { const d = rig.legs[id]; return [d.prox, d.a, d.b, d.c, d.paw]; }));

  for (const b of built) {
    const c = b.clip, name = c.name, fps = catalog.fps, n = b.frames.length - 1;
    summary.frames += b.frames.length;
    if (Math.abs(n / fps - c.durationS) > 1 / fps + 1e-9) fail(name, `duration ${n / fps}s vs catalog ${c.durationS}s`);
    const x = b.extras;
    for (const key of ['layer', 'loop', 'durationS', 'authoredSpeed', 'dutyFactor', 'rootMotion', 'heightM', 'rootRotationDeg', 'reachBone', 'bones', 'morphs', 'firstUsedIn'] as const) {
      if (JSON.stringify(x[key]) !== JSON.stringify(c[key])) fail(name, `extras.${key} ${JSON.stringify(x[key])} != catalog ${JSON.stringify(c[key])}`);
    }
    if (JSON.stringify(x.events ?? []) !== JSON.stringify(c.events ?? [])) fail(name, 'extras.events differ from the catalog');
    if (JSON.stringify(x.contacts) !== JSON.stringify(c.contacts)) fail(name, 'extras.contacts differ from the catalog');
    for (const e of c.events ?? []) if (e.t < 0 || e.t > c.durationS) fail(name, `event ${e.name} outside the clip`);
    if (c.layer === 'additive') {
      if (typeof x.additiveReference !== 'string' || !/^cat\.[a-z_.]+@\d+(\.\d+)?$/.test(x.additiveReference)) fail(name, 'additive clip without a clip@seconds additiveReference');
      if (b.translated.length || b.pelvisTranslation || b.rootTranslation) fail(name, 'additive clip carries translation tracks');
    }
    if (c.bones) {
      const allowed = new Set(expandBones(c.bones, rig.names).map(I));
      for (const bone of b.bones) if (!allowed.has(bone)) fail(name, `track on ${rig.names[bone]} outside catalog bones`);
    }
    if (b.rootTranslation !== (c.rootMotion === true)) fail(name, 'root translation track does not match catalog rootMotion');
    if (b.rootRotation !== (c.rootRotationDeg !== undefined)) fail(name, 'root rotation track does not match catalog rootRotationDeg');
    if (c.loop) {
      summary.maxSeam = Math.max(summary.maxSeam, b.seam.rot);
      if (b.seam.rot > LIMITS.seamRad || b.seam.pos > LIMITS.seamM) fail(name, `loop seam ${(b.seam.rot / DEG).toFixed(2)}° / ${(b.seam.pos * 1000).toFixed(1)} mm`);
    }
    // Catalogued footfalls: stance intervals start at the contact phase and last the duty factor.
    if (c.contacts && c.dutyFactor !== undefined) {
      for (const id of LEGS) {
        const iv = b.stance[id]?.[0], ph = c.contacts[id];
        if (ph === undefined || !iv) { fail(name, `${id} has no catalogued stance`); continue; }
        if (Math.abs(iv[0] - ph * c.durationS) > 1e-6 || Math.abs(iv[1] - iv[0] - c.dutyFactor * c.durationS) > 1e-6) fail(name, `${id} stance ${iv} does not match contact ${ph} / duty ${c.dutyFactor}`);
      }
    }

    const terrain = b.spec.terrain?.(b.ctx) ?? (() => 0);
    const worlds = b.frames.map((p, f) => {
      p.q.forEach((q, i) => {
        summary.maxQuaternionError = Math.max(summary.maxQuaternionError, Math.abs(q.length() - 1));
        if (!q.toArray().every(Number.isFinite) || Math.abs(q.length() - 1) > 1e-4) fail(name, `frame ${f} ${rig.names[i]} quaternion not finite/unit`);
      });
      for (let i = 0; i < rig.names.length; i++) if (!localT(rig, p, i).toArray().every(Number.isFinite)) fail(name, `frame ${f} ${rig.names[i]} translation not finite`);
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
        if (i === 0 || i === I('pelvis') || legBones.has(i)) return;
        const a = qAngle(q) / DEG;
        if (rig.names[i]!.startsWith('tail_')) summary.maxTailDeg = Math.max(summary.maxTailDeg, a);
        if (a > limits[i]!) fail(name, `frame ${f} ${rig.names[i]} rotates ${a.toFixed(0)}° (limit ${limits[i]}°)`);
      });
      const jaw = p.q[I('jaw')]!;
      if (2 * Math.asin(Math.max(-1, Math.min(1, jaw.x))) / DEG < -2) fail(name, `frame ${f} jaw closes past rest`);
      for (const id of LEGS) {
        const d = rig.legs[id], g = legAngles(d, W);
        const tag = `frame ${f} ${id}`;
        summary.minMiddleDeg = Math.min(summary.minMiddleDeg, g.mid / DEG);
        summary.maxMiddleDeg = Math.max(summary.maxMiddleDeg, g.mid / DEG);
        const distal = d.front ? summary.carpusDeg : summary.hockDeg;
        distal[0] = Math.min(distal[0], g.carpus / DEG); distal[1] = Math.max(distal[1], g.carpus / DEG);
        if (g.mid < ANATOMY.midMin * DEG || g.mid > ANATOMY.midMax * DEG) fail(name, `${tag} ${rig.names[d.b]} at ${(g.mid / DEG).toFixed(0)}°`);
        if (g.mid < ANATOMY.midMax * DEG - 2 * DEG && g.bendSide !== d.bendSign) fail(name, `${tag} ${rig.names[d.b]} bends to the wrong side (${d.front ? 'elbow must point back' : 'knee / heel side inverted'})`);
        // A rig whose hind chain bends backward at the shank joint (heel there, as on the diagnostic rig) has its
        // metatarsal joint mid-foot: only the broad range applies.
        const [lo, hi] = d.front ? ANATOMY.carpusF : d.bendSign === -1 ? ANATOMY.hockH : [-60, 170] as const;
        if (g.carpus < lo * DEG || g.carpus > hi * DEG) fail(name, `${tag} ${d.front ? 'carpus' : 'hock'} flexion ${(g.carpus / DEG).toFixed(0)}° outside ${lo}..${hi}°`);
        if (g.digits < ANATOMY.digits[0] * DEG || g.digits > ANATOMY.digits[1] * DEG) fail(name, `${tag} digits ${(g.digits / DEG).toFixed(0)}°`);
        const prox = qAngle(p.q[d.prox]!) / DEG;
        summary.maxProxDeg = Math.max(summary.maxProxDeg, prox);
        if (prox > ANATOMY.prox) fail(name, `${tag} ${rig.names[d.prox]} rotates ${prox.toFixed(0)}°`);
        const slide = localT(rig, p, d.prox).distanceTo(rig.offset[d.prox]!);
        summary.maxScapulaSlideM = Math.max(summary.maxScapulaSlideM, slide);
        if (slide > ANATOMY.slideFrac * rig.M.shoulderH) fail(name, `${tag} ${rig.names[d.prox]} slides ${(slide * 1000).toFixed(0)} mm`);
        if (!new Quaternion().copy(p.q[d.meta[1] ?? d.meta[0]!]!).toArray().every(Number.isFinite)) fail(name, `${tag} metapodial not finite`);
      }
      // Tail continuity: neighbouring joints may not kink against each other.
      for (let k = 1; k < rig.tail.length - 1; k++) {
        const qa = p.q[rig.tail[k]!]!, qb = p.q[rig.tail[k + 1]!]!;
        const kink = qAngle(qa.clone().invert().multiply(qb));
        summary.maxTailKink = Math.max(summary.maxTailKink, kink);
        if (kink > 45 * DEG) fail(name, `frame ${f} tail kink ${(kink / DEG).toFixed(0)}° at ${rig.names[rig.tail[k + 1]!]}`);
      }
      W.pos.forEach((pos, i) => {
        if (i === 0) return; // the root is a placement marker, not a body point
        const floor = terrain(pos.x, pos.z);
        if (pos.y < floor - LIMITS.floorM) fail(name, `frame ${f} ${rig.names[i]} ${((floor - pos.y) * 1000).toFixed(0)} mm below the floor`);
      });
    });

    // Planted paws: the toe joint and digit pads follow the ground (in place: backward at the ground speed);
    // the knuckle may lift about them as the heel peels off.
    for (const id of LEGS) {
      const d = rig.legs[id];
      const ivs = b.stance[id] ?? [];
      for (const [t0, t1] of ivs) {
        const f0 = Math.ceil(t0 * fps - 1e-6), f1 = Math.floor(t1 * fps + 1e-6);
        const at = (f: number) => worlds[c.loop ? ((f % n) + n) % n : Math.min(f, n)]!;
        // Toe pads exactly; digit tips loosely (they spread and flex on the ground).
        const pads = [d.toe, d.digits[0], d.digits[1]], tol = [LIMITS.slipM, 3 * LIMITS.slipM, 3 * LIMITS.slipM];
        const start = pads.map(j => at(f0).pos[j]!.clone());
        const floor0 = terrain(start[0]!.x, start[0]!.z);
        if (Math.abs(start[0]!.y - floor0 - d.padY) > LIMITS.padHeightM) fail(name, `${id} planted at ${t0}s with toe ${((start[0]!.y - floor0) * 1000).toFixed(1)} mm above its floor (pad ${(d.padY * 1000).toFixed(1)} mm)`);
        let travel = 0;
        frames: for (let f = f0; f <= f1; f++) {
          if (f > f0) {
            const g = b.spec.groundSpeed;
            if (g) for (let s = 0; s < 4; s++) travel += g(((f - 1 + (s + 0.5) / 4) / fps), b.ctx) / fps / 4;
          }
          const W = at(f), shift = new Vector3(0, 0, -travel);
          for (const [k, joint] of pads.entries()) {
            const slip = W.pos[joint]!.distanceTo(start[k]!.clone().add(shift));
            if (k === 0 && slip > summary.maxSlip) { summary.maxSlip = slip; summary.maxSlipClip = `${name} ${id}`; }
            if (slip > tol[k]!) { fail(name, `${id} ${k ? 'digit' : 'toe pad'} slips ${(slip * 1000).toFixed(1)} mm at ${(f / fps).toFixed(3)}s (stance ${t0}-${t1})`); break frames; }
          }
        }
      }
      // Catalogued swings must actually lift the paw.
      if (c.contacts && ivs.length) {
        const [s0, s1] = ivs[0]!, swingFrom = s1, swingTo = s0 + c.durationS;
        let lift = 0;
        for (let f = Math.ceil(swingFrom * fps); f <= Math.floor(swingTo * fps); f++) {
          const W = worlds[((f % n) + n) % n]!;
          lift = Math.max(lift, W.pos[d.toe]!.y - d.padY);
        }
        summary.minSwingLift = Math.min(summary.minSwingLift, lift);
        if (lift < LIMITS.swingLiftM) fail(name, `${id} swing lifts only ${(lift * 1000).toFixed(1)} mm`);
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
