// Resting clips: sit down, sit idle, loaf, lie on side, sprawl, sleep curl, wake stretch, yawn.
import type { Quaternion } from 'three';
import type { ClipSpec, Ctx } from '../catalog.ts';
import { type Body, cloneBody, mixBody } from '../body.ts';
import { yawnLick, yawnOpen } from '../expressions.ts';
import { type V3, AX, AY, AZ, bump, curve, loopNoise, pulse, qAxis, qBody, smooth } from '../math.ts';
import { LEGS, type Rig } from '../rig.ts';
import {
  addBreath, curlBody, earFlick, keyedLag, lieSideBody, loafBody, plantLeg, setTrunk, sitBody, stanceFromAir, stepLeg, tailShape,
} from '../poses.ts';
import { idleBody } from './loco.ts';

const DEG = Math.PI / 180;
export const allPlanted = (ctx: Ctx) => Object.fromEntries(LEGS.map(id => [id, [[0, ctx.T]] as [number, number][]]));
const cache = new WeakMap<Rig, Map<string, Body>>();
/** Build a pose once per rig and hand out copies. */
export const once = (ctx: Ctx, key: string, make: () => Body) => {
  let byRig = cache.get(ctx.rig);
  if (!byRig) cache.set(ctx.rig, byRig = new Map());
  let b = byRig.get(key);
  if (!b) byRig.set(key, b = make());
  return cloneBody(b);
};
export const idlePose = (ctx: Ctx) => once(ctx, 'idle', () => idleBody(ctx));
export const sitPose = (ctx: Ctx) => once(ctx, 'sit', () => sitBody(ctx.rig, idleBody(ctx)));
export const loafPose = (ctx: Ctx) => once(ctx, 'loaf', () => loafBody(ctx.rig));

/** Sit idle: slow breathing, head tracking with the eyes leading, ear rotations and a tail-tip twitch. */
function sitIdle(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx), k = ctx.M.legScale;
  addBreath(b, t, 2.5, 0.028);
  const n = loopNoise(ctx.seed, ctx.T, [1, 2]);
  const look = curve([[0, 0], [0.9, 0], [1.25, 0.22], [2.6, 0.18], [2.85, -0.1], [4.2, -0.08], [4.6, 0], [5, 0]]);
  b.gaze[1] += look(t) + 0.025 * n(t); b.gaze[0] += 0.025 * n(t + 1.7) + 0.04 * bump(t, 1.3, 1.6, 2.5, 2.9);
  b.eyes = [(look(t + 0.07) - look(t)) * 2.2, 0, (look(t + 0.07) - look(t)) * 2.2, 0];
  earFlick(b, t, 1.6, -1, 0.5); earFlick(b, t, 3.7, 1, 0.35);
  if (b.tailCurve) b.tailCurve.pts = b.tailCurve.pts.map((p, i, a) => i >= a.length - 2 ? [p[0] + 0.022 * k * pulse(t, 3.2, 0.08, 0.15) * (i === a.length - 1 ? 1 : 0.4), p[1] + 0.012 * k * pulse(t, 3.2, 0.08, 0.15), p[2]] as V3 : p);
  return b;
}

/** Stand to sit: anticipation, hind end lowers first on straight forelegs, the forepaws walk back, tail sweeps round. */
function sitDown(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx), sit = sitPose(ctx), rig = ctx.rig;
  const antic = cloneBody(stand);
  setTrunk(rig, antic, { pelvisDrop: 0.045 * M.shoulderH, chestDrop: 0.03 * M.shoulderH, surge: -0.01 * k });
  antic.gaze = [0.0, 0, 0, 0.9];
  const half = mixBody(stand, sit, 0.55);
  half.tailCurve = null; half.tail = tailShape({ base: -0.7, lift: -0.3, tip: 0.35, side: 0.35 });
  half.legs.LF = cloneBody(stand).legs.LF; half.legs.RF = cloneBody(stand).legs.RF;
  const b = keyedLag(t, [[0, stand], [0.18, antic], [0.62, half, smooth], [1.0, sit], [1.2, sit]], { head: 0.05, tail: 0.14 });
  // Hind paws stay planted while the hocks fold to the floor.
  for (const id of ['LH', 'RH'] as const) b.legs[id].toe = [...stand.legs[id].toe];
  for (const [id, t0, t1] of [['LF', 0.42, 0.62], ['RF', 0.6, 0.8]] as const) {
    const L = b.legs[id], from = stand.legs[id].toe, to = sit.legs[id].toe;
    if (t < t0) L.toe = [...from]; else if (t > t1) L.toe = [...to];
    else stepLeg(rig, L, id, t, t0, t1, from, to, 0.05 * M.shoulderH, 1.0);
  }
  return b;
}

/** Loaf to downward-dog stretch, then the hind-leg stretch, ending standing. */
function wakeStretch(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, rig = ctx.rig, sH = M.shoulderH;
  const loaf = loafPose(ctx), stand = idlePose(ctx);
  // Downward dog: forelegs far forward, chest low, rump high on straight hind legs, toes spread.
  const dog = cloneBody(stand);
  setTrunk(rig, dog, { pelvisDrop: -0.03 * sH, chestDrop: 0.4 * sH, arch: -0.3 });
  for (const id of ['LF', 'RF'] as const) {
    const L = dog.legs[id];
    plantLeg(rig, L, id, [L.toe[0] * 0.9, L.toe[1], L.toe[2] + 0.17 * k]);
    L.meta = rig.legs[id].stanceMeta - 0.45; L.spread = 0.3; L.fore = 1.0; L.foreK = 0; L.share = 0.6; L.curl = -0.2;
  }
  for (const id of ['LH', 'RH'] as const) { dog.legs[id].spread = 0.15; dog.legs[id].meta = rig.legs[id].stanceMeta + 0.12; }
  dog.gaze = [0.12, 0, 0, 1]; dog.earL = [0.3, 0.15, -0.05]; dog.earR = [0.3, 0.15, -0.05];
  dog.tail = tailShape({ base: 0.45, lift: 0.45, tip: 0.5 });
  const deep = cloneBody(dog); setTrunk(rig, deep, { pelvisDrop: -0.04 * sH, chestDrop: 0.45 * sH, arch: -0.36 });
  deep.legs = dog.legs;
  // Forward shift onto the forelegs, then the hind-leg stretch.
  const fwd = cloneBody(stand);
  setTrunk(rig, fwd, { pelvisDrop: 0.03 * sH, chestDrop: 0.08 * sH, surge: 0.035 * k });
  fwd.gaze = [0.05, 0, 0, 0.9];
  const hind = cloneBody(fwd); hind.tail = tailShape({ base: -0.1, lift: 0.1, tip: 0.4 }); hind.pelvis[2] -= 0.05; hind.pelvisOff[1] += 0.01 * sH;
  const b = keyedLag(t, [[0, loaf], [0.55, mixBody(loaf, dog, 0.65)], [0.85, dog], [1.3, deep], [1.72, fwd], [2.05, hind], [2.4, hind], [3.0, stand]], { head: 0.06, tail: 0.12, ears: 0.05 });
  // Forepaws reach out of the tuck straight into the stretch, then walk back.
  for (const [id, a0, a1, b0, b1] of [['LF', 0.12, 0.42, 1.3, 1.55], ['RF', 0.2, 0.5, 1.45, 1.7]] as const) {
    const L = b.legs[id], D = dog.legs[id], S = stand.legs[id];
    if (t < a0) continue;
    if (t <= a1) {
      const s = smooth((t - a0) / (a1 - a0));
      Object.assign(L, D);
      L.toe = [D.toe[0], D.toe[1] + 0.05 * sH * Math.sin(Math.PI * s), loaf.legs[id].c[2] + (D.toe[2] - loaf.legs[id].c[2]) * s];
      L.cw = loaf.legs[id].cw * (1 - smooth(s * 1.8)); L.c = [...loaf.legs[id].c];
      L.rel = 1 - smooth((s - 0.6) / 0.4); L.carpus = 2.4 * (1 - s) - 0.3 * s; L.digits = 0.4 * (1 - s) - 0.7 * s;
    } else if (t < b0) Object.assign(L, D);
    else if (t <= b1) { Object.assign(L, S); stepLeg(rig, L, id, t, b0, b1, D.toe, S.toe, 0.05 * sH, 1.1); }
    else Object.assign(L, S);
  }
  // Hind paws untuck to the standing footprint as the rear rises.
  for (const [id, t0, t1] of [['LH', 0.15, 0.45], ['RH', 0.25, 0.55]] as const) {
    const L = b.legs[id];
    if (t <= t0) continue;
    if (t <= t1) { Object.assign(L, stand.legs[id]); stepLeg(rig, L, id, t, t0, t1, loaf.legs[id].toe, stand.legs[id].toe, 0.035 * sH, 1.0); }
  }
  // The hind-leg stretch: left hind extends far back, toes spread, held, then returns.
  {
    const L = b.legs.LH, home = stand.legs.LH.toe, out: V3 = [home[0] * 1.1, 0.045 * k, home[2] - 0.17 * k];
    if (t > 1.78 && t < 2.68) {
      if (t < 2.05) { stepLeg(rig, L, 'LH', t, 1.78, 2.05, home, out, 0.03 * sH, 0.6); L.rel = Math.max(L.rel, smooth((t - 1.78) / 0.15)); L.carpus = -0.1; L.digits = -0.4; L.spread = 0.3 * smooth((t - 1.78) / 0.27); }
      else if (t < 2.38) { L.toe = [out[0], out[1] + 0.006 * k * Math.sin((t - 2.05) * 20), out[2]]; L.rel = 1; L.carpus = -0.1; L.digits = -0.4; L.spread = 0.3; L.curl = -0.25; }
      else { stepLeg(rig, L, 'LH', t, 2.38, 2.68, out, home, 0.03 * sH, 0.8); L.spread = 0.3 * (1 - smooth((t - 2.38) / 0.3)); }
    }
  }
  return b;
}

export const restClips: ClipSpec[] = [
  { name: 'cat.rest.sit_idle', body: sitIdle, stance: allPlanted, tailSim: { wBase: 22, wTip: 12, zeta: 0.9 } },
  {
    name: 'cat.rest.sit_down', body: sitDown, tailSim: { wBase: 26, wTip: 12, zeta: 0.7 },
    stance: ctx => stanceFromAir(ctx.T, { LF: [[0.42, 0.62]], RF: [[0.6, 0.8]] }),
  },
  {
    name: 'cat.rest.loaf',
    body: (t, ctx) => {
      const b = addBreath(loafPose(ctx), t, 3, 0.03);
      earFlick(b, t, 2.2, 1, 0.35, 0.5);
      b.gaze[1] += 0.06 * loopNoise(ctx.seed, ctx.T, [1, 2])(t);
      // Eyes half closed: the head settles a little with each exhale.
      b.gaze[0] -= 0.015 * (1 - Math.cos(2 * Math.PI * t / 3));
      return b;
    },
    stance: ctx => ({ LH: [[0, ctx.T]], RH: [[0, ctx.T]] }),
  },
  {
    name: 'cat.rest.lie_side',
    body: (t, ctx) => {
      const b = addBreath(once(ctx, 'lie', () => lieSideBody(ctx.rig)), t, 3, 0.05);
      b.pelvis[2] += 0.012 * Math.sin(2 * Math.PI * t / 3);
      earFlick(b, t, 4.1, 1, 0.3, 0.5);
      return b;
    },
    tailSim: { wBase: 24, wTip: 10, zeta: 0.8 },
  },
  {
    name: 'cat.rest.sprawl',
    body: (t, ctx) => {
      const b = addBreath(once(ctx, 'sprawl', () => lieSideBody(ctx.rig, 98 * DEG, 1)), t, 3, 0.04);
      const tw = pulse(t, 3.4, 0.07, 0.12);
      b.legs.LF.carpus += 0.5 * tw; b.legs.LF.digits += 0.5 * tw; b.legs.LF.curl += 0.3 * tw;
      return b;
    },
    tailSim: { wBase: 24, wTip: 10, zeta: 0.8 },
  },
  {
    name: 'cat.rest.sleep_curl',
    body: (t, ctx) => {
      const b = addBreath(once(ctx, 'curl', () => curlBody(ctx.rig)), t, 8 / 3, 0.032);
      earFlick(b, t, 5.2, 1, 0.25, 0.35); earFlick(b, t, 5.5, 1, 0.15, 0.3);
      return b;
    },
  },
  {
    name: 'cat.rest.wake_stretch', body: wakeStretch, tailSim: { wBase: 26, wTip: 12, zeta: 0.7 },
    stance: () => ({ LF: [[0.42, 1.3], [1.55, 3]], RF: [[0.5, 1.45], [1.7, 3]], LH: [[0.45, 1.78], [2.68, 3]], RH: [[0.55, 3]] }),
  },
  {
    name: 'cat.rest.yawn',
    additive: {
      reference: 'cat.rest.sit_idle@0',
      offsets: (t): Record<string, Quaternion> => {
        const open = yawnOpen(t), lick = yawnLick(t);
        const lift = curve([[0, 0], [0.3, 0.6], [0.6, 1], [1.0, 0.8], [1.3, 0.1], [1.6, 0]])(t);
        const ears = curve([[0, 0], [0.4, 0.7], [0.9, 1], [1.2, 0.2], [1.6, 0]])(t);
        return {
          neck_01: qBody(0.06 * lift, 0, 0), neck_02: qBody(0.08 * lift, 0, 0), head: qBody(0.1 * lift - 0.04 * open, 0, 0),
          jaw: qAxis(AX, 0.85 * open + lick),
          ear_L_01: qAxis(AZ, -0.25 * ears).multiply(qAxis(AY, 0.45 * ears)), ear_R_01: qAxis(AZ, 0.25 * ears).multiply(qAxis(AY, -0.45 * ears)),
          ear_L_02: qAxis(AX, -0.1 * ears), ear_R_02: qAxis(AX, -0.1 * ears),
        };
      },
    },
  },
];
