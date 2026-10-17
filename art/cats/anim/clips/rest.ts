// Resting clips: sit down, sit idle, loaf, lie on side, sprawl, sleep curl, wake stretch, yawn.
import type { Quaternion } from 'three';
import type { ClipSpec, Ctx } from '../catalog.ts';
import { type Body, cloneBody, mixBody, qTail } from '../body.ts';
import { type V3, AX, AY, AZ, DEG, bump, curve, loopNoise, pulse, qAxis, qBody, smooth, smoother } from '../math.ts';
import { LEGS, type LegId } from '../rig.ts';
import {
  addBreath, curlBody, earFlick, keyed, keyedLag, lieSideBody, loafBody, setTrunk, sitBody, stanceFromAir, step, stepLeg, tailShape,
} from '../poses.ts';
import { idleBody } from './loco.ts';

const allPlanted = (ctx: Ctx) => Object.fromEntries(LEGS.map(id => [id, [[0, ctx.T]] as [number, number][]]));
const cache = new Map<string, Body>();
export const once = (key: string, make: () => Body) => { let b = cache.get(key); if (!b) cache.set(key, b = make()); return cloneBody(b); };
export const sitPose = (ctx: Ctx) => once('sit', () => sitBody(ctx.rig, idleBody(ctx)));
export const loafPose = (ctx: Ctx) => once('loaf', () => loafBody(ctx.rig));
export const idlePose = (ctx: Ctx) => once('idle', () => idleBody(ctx));

/** Sit idle with breathing, slow head tracking, ear rotations and a tail-tip twitch. */
function sitIdle(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx);
  addBreath(b, t, 2.5, 0.03);
  const n = loopNoise(ctx.seed, ctx.T, [1, 2]);
  const look = curve([[0, 0], [0.9, 0], [1.4, 0.22], [2.6, 0.18], [3.0, -0.1], [4.2, -0.08], [4.6, 0], [5, 0]]);
  b.gaze[1] += look(t) + 0.03 * n(t); b.gaze[0] += 0.03 * n(t + 1.7) + 0.04 * bump(t, 1.3, 1.6, 2.5, 2.9);
  b.eyes = [(look(t + 0.06) - look(t)) * 2, 0, (look(t + 0.06) - look(t)) * 2, 0];
  earFlick(b, t, 1.6, -1, 0.5); earFlick(b, t, 3.7, 1, 0.35);
  if (b.tailCurve) b.tailCurve.pts = b.tailCurve.pts.map((p, i, a) => i === a.length - 1 ? [p[0] + 0.03 * ctx.M.legScale * pulse(t, 3.2, 0.08, 0.15), p[1], p[2]] as V3 : p);
  return b;
}

/** Stand to sit: anticipation, hind end lowers first on straight forelegs, paws walk back, tail sweeps round. */
function sitDown(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx), sit = sitPose(ctx);
  const antic = cloneBody(stand);
  setTrunk(ctx.rig, antic, { pelvisDrop: 0.05 * M.shoulderH, chestDrop: 0.035 * M.shoulderH, surge: -0.012 * k });
  antic.gaze = [0.02, 0, 0, 0.9];
  const half = mixBody(stand, sit, 0.55);
  half.tailCurve = null; half.tail = tailShape({ base: -0.7, lift: -0.3, tip: 0.3, side: 0.3 });
  half.legs.LF = cloneBody(stand).legs.LF; half.legs.RF = cloneBody(stand).legs.RF;
  const b = keyedLag(t, [[0, stand], [0.18, antic], [0.62, half, smooth], [1.0, sit], [1.2, sit]], { head: 0.05, tail: 0.14 });
  for (const [id, t0, t1] of [['LF', 0.42, 0.62], ['RF', 0.6, 0.8]] as const) {
    const L = b.legs[id], from = stand.legs[id].toe, to = sit.legs[id].toe;
    if (t < t0) L.toe = [...from]; else if (t > t1) L.toe = [...to];
    else stepLeg(L, t, t0, t1, from, to, 0.06 * M.shoulderH, 0.8, L.heel);
  }
  return b;
}

/** Loaf to downward-dog stretch, then the hind-leg stretch, ending standing. */
function wakeStretch(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, rig = ctx.rig;
  const loaf = loafPose(ctx), stand = idlePose(ctx);
  const dog = cloneBody(stand);
  setTrunk(rig, dog, { pelvisDrop: -0.02 * M.shoulderH, chestDrop: 0.42 * M.shoulderH, arch: -0.32 });
  for (const id of ['LF', 'RF'] as const) {
    const L = dog.legs[id]; L.toe = [L.toe[0] * 0.9, L.toe[1], L.toe[2] + 0.2 * k]; L.spread = 0.3; L.flex = 1; L.share = 0.6; L.heel = rig.legs[id].stanceHeel - 0.2;
  }
  for (const id of ['LH', 'RH'] as const) { dog.legs[id].flex = 1; dog.legs[id].spread = 0.15; }
  dog.gaze = [0.12, 0, 0, 1]; dog.earL = [0.3, 0.15, -0.05]; dog.earR = [0.3, 0.15, -0.05];
  dog.tail = tailShape({ base: 0.5, lift: 0.4, tip: 0.5 });
  const deep = cloneBody(dog); setTrunk(rig, deep, { pelvisDrop: -0.03 * M.shoulderH, chestDrop: 0.46 * M.shoulderH, arch: -0.38 });
  deep.legs = dog.legs;
  const fwd = cloneBody(stand);
  setTrunk(rig, fwd, { pelvisDrop: 0.03 * M.shoulderH, chestDrop: 0.07 * M.shoulderH, surge: 0.04 * k });
  fwd.gaze = [0.05, 0, 0, 0.9];
  const hind = cloneBody(fwd); hind.tail = tailShape({ base: -0.1, lift: 0.1, tip: 0.4 }); hind.pelvis[2] -= 0.05;
  const b = keyedLag(t, [[0, loaf], [0.55, mixBody(loaf, dog, 0.7)], [0.85, dog], [1.3, deep], [1.75, fwd], [2.05, hind], [2.4, hind], [3.0, stand]], { head: 0.06, tail: 0.12, ears: 0.05 });
  // Forepaws reach out of the tuck straight into the stretch, then walk back.
  for (const [id, a0, a1, b0, b1] of [['LF', 0.12, 0.42, 1.3, 1.55], ['RF', 0.2, 0.5, 1.45, 1.7]] as const) {
    const L = b.legs[id];
    if (t < a0) continue;
    if (t <= a1) {
      const st = step(t, a0, a1, loaf.legs[id].toe, dog.legs[id].toe, 0.05 * M.shoulderH);
      L.toe = st.pos; L.cw = loaf.legs[id].cw * (1 - smooth(st.s * 1.6)); L.heel = 1.95 + (dog.legs[id].heel - 1.95) * smooth(st.s); L.toeP = 2.35 * (1 - smooth(st.s));
    } else if (t < b0) { L.toe = [...dog.legs[id].toe]; L.cw = 0; }
    else if (t <= b1) { L.cw = 0; stepLeg(L, t, b0, b1, dog.legs[id].toe, stand.legs[id].toe, 0.05 * M.shoulderH, 0.7, rig.legs[id].stanceHeel); }
    else { L.toe = [...stand.legs[id].toe]; L.cw = 0; }
  }
  // Hind paws untuck to the standing footprint as the rear rises.
  for (const [id, t0, t1] of [['LH', 0.15, 0.45], ['RH', 0.25, 0.55]] as const) {
    const L = b.legs[id];
    if (t <= t1) {
      const st = step(t, t0, t1, loaf.legs[id].toe, stand.legs[id].toe, 0.04 * M.shoulderH);
      L.toe = st.pos; L.heel = loaf.legs[id].heel + (rig.legs[id].stanceHeel - loaf.legs[id].heel) * smooth(st.s);
    } else L.toe = [...stand.legs[id].toe];
  }
  // The hind-leg stretch: left hind reaches far back and up, toes spread, then returns.
  {
    const L = b.legs.LH, home = stand.legs.LH.toe, out: V3 = [home[0] * 1.1, 0.05 * k, home[2] - 0.2 * k];
    if (t > 1.78 && t < 2.68) {
      if (t < 2.05) { const st = step(t, 1.78, 2.05, home, out, 0.04 * M.shoulderH); L.toe = st.pos; L.heel = rig.legs.LH.stanceHeel - 0.5 * smooth(st.s); L.toeP = -0.3 * smooth(st.s); L.spread = 0.3 * smooth(st.s); L.flex = 1; }
      else if (t < 2.38) { L.toe = [out[0], out[1] + 0.008 * k * Math.sin((t - 2.05) * 20), out[2]]; L.heel = rig.legs.LH.stanceHeel - 0.5; L.toeP = -0.3; L.spread = 0.3; L.flex = 1; }
      else { const st = step(t, 2.38, 2.68, out, home, 0.03 * M.shoulderH); L.toe = st.pos; L.heel = rig.legs.LH.stanceHeel - 0.5 * (1 - smooth(st.s)); L.toeP = -0.3 * (1 - smooth(st.s)); L.spread = 0.3 * (1 - st.s); }
    }
  }
  return b;
}

export const restClips: ClipSpec[] = [
  { name: 'cat.rest.sit_idle', body: sitIdle, stance: allPlanted },
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
      return b;
    },
    stance: ctx => ({ LH: [[0, ctx.T]], RH: [[0, ctx.T]] }),
  },
  {
    name: 'cat.rest.lie_side',
    body: (t, ctx) => {
      const b = addBreath(once('lie', () => lieSideBody(ctx.rig)), t, 3, 0.05);
      b.pelvis[2] += 0.015 * (Math.sin(2 * Math.PI * t / 3) - 0);
      earFlick(b, t, 4.1, 1, 0.3, 0.5);
      return b;
    },
    tailSim: { wBase: 24, wTip: 10, zeta: 0.8 },
  },
  {
    name: 'cat.rest.sprawl',
    body: (t, ctx) => {
      const b = addBreath(once('sprawl', () => lieSideBody(ctx.rig, 112 * DEG, 1)), t, 3, 0.04);
      const tw = pulse(t, 3.4, 0.07, 0.12);
      b.legs.LF.heel += 0.5 * tw; b.legs.LF.toeP += 0.7 * tw; b.legs.LF.curl += 0.3 * tw;
      return b;
    },
    tailSim: { wBase: 24, wTip: 10, zeta: 0.8 },
  },
  {
    name: 'cat.rest.sleep_curl',
    body: (t, ctx) => {
      const b = addBreath(once('curl', () => curlBody(ctx.rig)), t, 8 / 3, 0.035);
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
        const open = curve([[0, 0], [0.25, 0.08], [0.45, 0.85], [0.6, 1], [0.95, 0.95], [1.12, 0.1], [1.2, 0], [1.6, 0]])(t);
        const lick = 0.12 * (bump(t, 1.22, 1.28, 1.3, 1.36) + 0.7 * bump(t, 1.38, 1.43, 1.45, 1.5));
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

void smoother; void qTail; export type { LegId };
