// Care clips: grooming, eating, drinking, paw in water, litter, kneading, scratching.
import type { ClipSpec, Ctx } from '../catalog.ts';
import { type Body, cloneBody } from '../body.ts';
import { type V3, bump, curve, loopNoise, pulse, smooth } from '../math.ts';
import { LEGS, type LegId } from '../rig.ts';
import { addBreath, chew, earFlick, flatHeel, headPoint, setTrunk, stanceFromAir, step, stepLeg, tailShape } from '../poses.ts';
import { idlePose, once, sitPose } from './rest.ts';

const allPlanted = (ctx: Ctx) => Object.fromEntries(LEGS.map(id => [id, [[0, ctx.T]] as [number, number][]]));

/** Feeding crouch over a bowl ahead of the forepaws: elbows out, hind end folded low. */
function crouchAtBowl(ctx: Ctx, depth: number): Body {
  const M = ctx.M, b = idlePose(ctx);
  setTrunk(ctx.rig, b, { pelvisDrop: depth * 0.9 * M.shoulderH, chestDrop: depth * M.shoulderH, arch: 0.08 });
  for (const id of ['LF', 'RF'] as const) { const L = b.legs[id]; L.abduct = 0.5; L.flex = 0.75; L.out = 0.25; L.comfort = 0.6; }
  for (const id of ['LH', 'RH'] as const) { const L = b.legs[id]; L.heel = (L.heel + flatHeel(ctx.rig, id)) * 0.5; L.flex = 0.6; L.comfort = 0.4; L.abduct = 0.2; }
  b.gaze = [-0.75, 0, 0, 1];
  b.tail = tailShape({ base: -0.55, lift: -0.2, tip: 0.35, side: 0.5, tipSide: 0.3 });
  return b;
}

/** One forepaw lifted to the mouth, licked, then wiped over cheek and ear; local time u in [0, 1.5]. */
function faceWash(b: Body, ctx: Ctx, u: number, side: 1 | -1) {
  const M = ctx.M, id: LegId = side > 0 ? 'LF' : 'RF', L = b.legs[id], home = L.toe;
  const up = bump(u, 0.05, 0.28, 1.22, 1.45);
  const wipe = bump(u, 0.62, 0.72, 1.15, 1.25);
  const stroke = (u - 0.62) / 0.28; // two wipes
  const lickN = chew(u - 0.28, 0.36, 3, 0.4) * bump(u, 0.26, 0.3, 0.6, 0.66);
  // Head lowers to the paw for licking, then tilts and turns into the wiping paw.
  b.gaze[0] += -0.35 * up + 0.15 * wipe + 0.05 * lickN;
  b.gaze[1] += side * (0.18 * up + 0.12 * wipe);
  b.gaze[2] += side * 0.38 * wipe;
  b.jaw += 0.12 * lickN;
  b.spine = b.spine.map(s => [s[0] - 0.02 * up, s[1] + side * 0.02 * up, s[2] - side * 0.02 * up] as V3);
  const lickPt = headPoint(ctx.rig, b, [side * 0.01, -0.07, 0.05]);
  const w = ((stroke % 1) + 1) % 1;
  const cheek = headPoint(ctx.rig, b, [side * 0.06, -0.02 + 0.09 * smooth(w), 0.05 - 0.07 * smooth(w)]);
  const target = wipe > 0 ? cheek : lickPt;
  const blend = up;
  L.toe = [home[0] + (target[0] - home[0]) * blend, home[1] + (target[1] - home[1]) * blend, home[2] + (target[2] - home[2]) * blend];
  L.heel += 1.3 * up; L.toeP = 1.6 * up; L.curl = 0.2 * up; L.share = 0.5; L.abduct = -0.2 * up;
  earFlick(b, u, 0.75, side, 0.3 * wipe, 0.4);
}

/** Licks along the flank over the shoulder: three long, rhythmic strokes per loop. */
function flankGroom(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx), k = ctx.M.legScale;
  const p = (t % 1 + 1) % 1, drag = p < 0.7 ? smooth(p / 0.7) : 1 - smooth((p - 0.7) / 0.3);
  b.pelvis[1] += 0.12; b.pelvis[2] -= 0.06;
  b.spine = b.spine.map((s, i) => [s[0] - 0.04, s[1] + [0.12, 0.16, 0.18, 0.18, 0.16][i]!, s[2]] as V3);
  b.gaze = [0, 0, 0, 0];
  b.neck = [[-0.35 - 0.08 * drag, 0.55 + 0.05 * drag, 0.1], [-0.3 - 0.06 * drag, 0.5 + 0.04 * drag, 0.1]];
  b.head = [-0.35 - 0.1 * drag, 0.32, 0.35];
  b.jaw = 0.1 + 0.08 * drag;
  // The far forepaw braces forward and out.
  b.legs.RF.toe = [b.legs.RF.toe[0] - 0.03 * k, b.legs.RF.toe[1], b.legs.RF.toe[2] + 0.03 * k];
  b.earL = [0.35, 0.1, -0.05]; b.earR = [0.2, 0.05, 0];
  return addBreath(b, t, 3, 0.02);
}

/** Eat: dip and bite, chew with the head tilted (side teeth), pause, dip again. */
function eat(t: number, ctx: Ctx): Body {
  const b = once('bowl-eat', () => crouchAtBowl(ctx, 0.33));
  const dip = curve([[0, 0.6], [0.12, 1], [0.32, 1], [0.5, 0.35], [1.4, 0.25], [1.7, 0.3], [2, 0.6]])(t);
  const chewing = bump(t, 0.45, 0.55, 1.3, 1.42);
  const c = chew(t - 0.45, 0.85 / 3, 1, 0.3) * chewing;
  b.gaze[0] += -0.18 * dip + 0.04 * c;
  b.gaze[2] += 0.28 * chewing;
  b.gaze[1] += 0.06 * chewing;
  b.jaw = 0.22 * bump(t, 0.05, 0.15, 0.28, 0.36) + 0.09 * c + 0.03 * bump(t, 1.6, 1.65, 1.68, 1.75);
  b.neck[1]![0] += 0.04 * pulse(t, 1.55, 0.05, 0.08);
  earFlick(b, t, 1.0, 1, 0.2, 0.4);
  return addBreath(b, t, 1, 0.012);
}

/** Drink: head still over the water, four quick laps per second, the last folding into a swallow. */
function drink(t: number, ctx: Ctx): Body {
  const b = once('bowl-drink', () => { const x = crouchAtBowl(ctx, 0.36); x.gaze = [-0.62, 0, 0, 1]; return x; });
  const lap = chew(t, 1, 4, 0.32);
  const fourth = bump(t, 0.74, 0.8, 0.95, 1.0);
  b.jaw = 0.1 * lap * (1 - 0.5 * fourth);
  b.gaze[0] += 0.012 * lap + 0.03 * fourth;
  b.neck[1]![0] += 0.03 * fourth;
  return b;
}

/** Juniper's habit: dip a forepaw in the water, flick it, lick it. */
function pawWater(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx), M = ctx.M, k = M.legScale, L = b.legs.RF, home = L.toe;
  const bowl: V3 = [home[0] - 0.02 * k, 0.03 * k, home[2] + 0.11 * k];
  const reach = bump(t, 0.05, 0.25, 0.55, 0.72), toMouth = bump(t, 0.7, 0.9, 1.65, 1.85);
  const flick = bump(t, 0.55, 0.58, 0.72, 0.75) * Math.sin((t - 0.55) * 2 * Math.PI * 9);
  const lick = chew(t - 0.95, 0.7 / 3, 1, 0.4) * bump(t, 0.9, 0.95, 1.6, 1.7);
  const mouth = headPoint(ctx.rig, b, [-0.01, -0.07, 0.045]);
  const dip = 0.012 * k * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.25) / 0.3)));
  const tgt: V3 = toMouth > 0 ? mouth : [bowl[0], bowl[1] - dip, bowl[2]];
  const w = Math.max(reach, toMouth);
  L.toe = [home[0] + (tgt[0] - home[0]) * w, home[1] + (tgt[1] - home[1]) * w + 0.04 * k * Math.sin(Math.PI * reach) * (reach < 1 ? 1 : 0), home[2] + (tgt[2] - home[2]) * w];
  L.heel += 0.5 * reach + 1.3 * toMouth + 0.35 * flick; L.toeP = 0.6 * reach + 1.6 * toMouth + 0.4 * flick; L.share = 0.5;
  b.gaze[0] += -0.35 * reach - 0.3 * toMouth + 0.05 * lick;
  b.gaze[1] += -0.12 * reach - 0.1 * toMouth;
  b.jaw += 0.12 * lick;
  b.whisk = 0.3 * reach;
  return b;
}

/** Front-paw scoops behind the body (dig) or sweeps forward (cover); n alternating strokes. */
function pawStrokes(b: Body, ctx: Ctx, t: number, strokes: [LegId, number, number][], forward: boolean) {
  const k = ctx.M.legScale;
  for (const [id, t0, t1] of strokes) {
    if (t < t0 || t > t1) continue;
    const L = b.legs[id], home = L.toe, u = (t - t0) / (t1 - t0);
    const a: V3 = [home[0], home[1], home[2] + (forward ? -0.05 : 0.07) * k];
    const c: V3 = [home[0], home[1], home[2] + (forward ? 0.07 : -0.06) * k];
    if (u < 0.3) { const st = step(u, 0, 0.3, home, a, 0.04 * k); L.toe = st.pos; L.heel += 0.6 * Math.sin(Math.PI * st.s); L.toeP = 0.8 * Math.sin(Math.PI * st.s); }
    else if (u < 0.75) { const s = smooth((u - 0.3) / 0.45); L.toe = [a[0], a[1], a[2] + (c[2] - a[2]) * s]; L.curl = forward ? 0 : 0.4; L.toeP = forward ? -0.1 : 0.2; }
    else { const st = step(u, 0.75, 1, c, home, 0.03 * k); L.toe = st.pos; L.heel += 0.4 * Math.sin(Math.PI * st.s); }
  }
}

function litterDig(t: number, ctx: Ctx): Body {
  const M = ctx.M, b = idlePose(ctx);
  setTrunk(ctx.rig, b, { pelvisDrop: 0.12 * M.shoulderH, chestDrop: 0.16 * M.shoulderH * smooth(t / 0.3) + 0.05 * M.shoulderH });
  b.gaze = [-0.75 * smooth(t / 0.3) - 0.04 * chew(t, 0.25, 1) , 0.08 * Math.sin(t * 3), 0, 1];
  pawStrokes(b, ctx, t, DIG, false);
  b.tail = tailShape({ base: -0.3, lift: 0.1, tip: 0.3 });
  b.whisk = 0.25;
  return b;
}
const DIG: [LegId, number, number][] = [['LF', 0.3, 0.65], ['RF', 0.6, 0.95], ['LF', 0.9, 1.25], ['RF', 1.2, 1.55], ['LF', 1.5, 1.85], ['RF', 1.8, 2.15]];
const COVER: [LegId, number, number][] = [['LF', 0.9, 1.3], ['RF', 1.25, 1.65], ['LF', 1.6, 2.0], ['RF', 1.95, 2.35]];

function litterCover(t: number, ctx: Ctx): Body {
  const M = ctx.M, b = idlePose(ctx);
  const look = bump(t, 0.05, 0.35, 0.55, 0.85);
  setTrunk(ctx.rig, b, { pelvisDrop: 0.08 * M.shoulderH, chestDrop: 0.12 * M.shoulderH, yaw: -0.08 * look });
  b.spine = b.spine.map(s => [s[0], s[1] + 0.16 * look, s[2]] as V3);
  b.gaze = [-0.55 - 0.25 * look + 0.2 * bump(t, 0.85, 1.0, 2.3, 2.5) * 0, 1.5 * look, 0.1 * look, 1];
  pawStrokes(b, ctx, t, COVER, true);
  b.tail = tailShape({ base: -0.4, lift: -0.1, tip: 0.3, side: -0.3 * look });
  return b;
}

/** Knead: alternating pushes, toes spreading on the press and claws flexing; body rocks with each push. */
function knead(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, b = once('knead', () => {
    const x = idlePose(ctx);
    setTrunk(ctx.rig, x, { pelvisDrop: 0.42 * M.shoulderH, chestDrop: 0.12 * M.shoulderH });
    for (const id of ['LH', 'RH'] as const) { const L = x.legs[id]; L.heel = flatHeel(ctx.rig, id); L.flex = 0.55; L.comfort = 0.3; L.abduct = 0.3; }
    x.gaze = [-0.12, 0, 0, 1]; x.earL = [0.15, 0.1, 0]; x.earR = [0.15, 0.1, 0];
    x.tail = tailShape({ base: -0.6, lift: -0.1, tip: 0.3, side: 0.6 });
    return x;
  });
  let rock = 0;
  for (const [id, t0] of [['LF', 0], ['RF', 0.4], ['LF', 0.8], ['RF', 1.2]] as const) {
    const L = b.legs[id], home = L.toe, u = ((t - t0) % 1.6 + 1.6) % 1.6;
    if (u < 0.16) { const st = step(u, 0, 0.16, home, home, 0.035 * k); L.toe = st.pos; L.heel += 0.4 * Math.sin(Math.PI * st.s); L.toeP = 0.5 * Math.sin(Math.PI * st.s); }
    else if (u < 0.4) { const press = Math.sin(Math.PI * (u - 0.16) / 0.24); L.spread = 0.3 * press; L.curl = 0.45 * press; L.heel -= 0.1 * press; rock += (id === 'LF' ? 1 : -1) * press; }
  }
  b.pelvisOff[0] += 0.004 * k * rock; b.pelvis[2] += 0.035 * rock;
  b.gaze[2] -= 0.04 * rock;
  return addBreath(b, t, 1.6, 0.025);
}

/** Scratching post: stretched up the post, alternating claw pulls, hind legs braced. */
function scratch(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, rig = ctx.rig;
  const b = once('scratch', () => {
    const x = idlePose(ctx);
    setTrunk(rig, x, { pelvisDrop: 0.02 * M.shoulderH, chestDrop: -0.55 * M.shoulderH, arch: -0.15 });
    for (const id of ['LH', 'RH'] as const) { x.legs[id].flex = 0.95; }
    x.gaze = [0.25, 0, 0, 1]; x.earL = [0.1, 0, 0.05]; x.earR = [0.1, 0, 0.05];
    x.tail = tailShape({ base: -0.35, lift: -0.2, tip: 0.4 });
    return x;
  });
  const postZ = idlePose(ctx).legs.LF.toe[2] + 0.06 * k;
  let pull = 0;
  for (const [id, t0] of [['LF', 0], ['RF', 0.5], ['LF', 1.0], ['RF', 1.5]] as const) {
    const L = b.legs[id], u = ((t - t0) % 1 + 1) % 1, side = rig.legs[id].side;
    const hi = 0.95 * M.shoulderH, lo = 0.72 * M.shoulderH;
    let y: number, z = postZ;
    if (u < 0.42) { const s = smooth(u / 0.42); y = hi - (hi - lo) * s; pull += Math.sin(Math.PI * u / 0.42) * (u < 0.42 ? 1 : 0) * 0.5; L.curl = -0.35; L.toeP = 0.5; }
    else { const s = (u - 0.42) / 0.58; y = lo + (hi - lo) * smooth(s); z = postZ - 0.025 * k * Math.sin(Math.PI * s); L.curl = -0.1; L.toeP = 0.6; }
    L.toe = [side * 0.045 * k, y, z]; L.heel = rig.legs[id].stanceHeel + 0.9; L.share = 0.55; L.flex = 0.9;
  }
  b.pelvisOff[1] -= 0.006 * k * pull;
  return b;
}

export const careClips: ClipSpec[] = [
  {
    name: 'cat.care.groom_face',
    body: (t, ctx) => { const b = sitPose(ctx); if (t < 1.5) faceWash(b, ctx, t, 1); else faceWash(b, ctx, t - 1.5, -1); return addBreath(b, t, 1.5, 0.015); },
    stance: ctx => stanceFromAir(ctx.T, { LF: [[0.05, 1.45]], RF: [[1.55, 2.95]] }),
  },
  { name: 'cat.care.groom_flank', body: flankGroom, stance: allPlanted },
  { name: 'cat.care.eat_crouch', body: eat, stance: allPlanted, tailSim: { wBase: 24, wTip: 10, zeta: 0.7 } },
  { name: 'cat.care.drink_lap', body: drink, stance: allPlanted },
  { name: 'cat.care.paw_water', body: pawWater, stance: ctx => stanceFromAir(ctx.T, { RF: [[0.05, 1.85]] }) },
  { name: 'cat.care.litter_dig', body: litterDig, stance: ctx => stanceFromAir(ctx.T, airOf(DIG)), tailSim: { wBase: 24, wTip: 10, zeta: 0.7 } },
  {
    name: 'cat.care.litter_squat',
    body: (t, ctx) => {
      const M = ctx.M, b = once('squat', () => {
        const x = idlePose(ctx);
        setTrunk(ctx.rig, x, { pelvisDrop: 0.48 * M.shoulderH, chestDrop: 0.1 * M.shoulderH, arch: 0.18 });
        for (const id of ['LH', 'RH'] as const) { const L = x.legs[id]; L.heel = (L.heel + flatHeel(ctx.rig, id)) * 0.5; L.flex = 0.55; L.comfort = 0.4; L.abduct = 0.25; }
        x.gaze = [0, 0, 0, 1]; x.tail = tailShape({ base: 0.55, lift: 0.25, tip: 0.1 });
        x.earL = [0.25, 0.08, 0]; x.earR = [0.25, 0.08, 0];
        return x;
      });
      const n = loopNoise(ctx.seed, ctx.T, [2, 3, 5]);
      b.tail = b.tail.map((s, i) => [s[0], s[1] + 0.01 * n(t) * (i / 11), s[2]] as V3);
      earFlick(b, t, 2.3, -1, 0.3, 0.4);
      return addBreath(b, t, 1, 0.02);
    },
    stance: allPlanted,
  },
  { name: 'cat.care.litter_cover', body: litterCover, stance: ctx => stanceFromAir(ctx.T, airOf(COVER)), tailSim: { wBase: 24, wTip: 10, zeta: 0.7 } },
  {
    name: 'cat.care.knead', body: knead,
    stance: ctx => stanceFromAir(ctx.T, { LF: [[0, 0.16], [0.8, 0.96]], RF: [[0.4, 0.56], [1.2, 1.36]] }),
  },
  { name: 'cat.care.scratch_post', body: scratch, stance: ctx => ({ LH: [[0, ctx.T]], RH: [[0, ctx.T]] }), tailSim: { wBase: 26, wTip: 12, zeta: 0.7 } },
];

function airOf(strokes: [LegId, number, number][]) {
  const air: Partial<Record<LegId, [number, number][]>> = {};
  for (const [id, a, b] of strokes) (air[id] ??= []).push([a, b]);
  return air;
}
void cloneBody; void stepLeg;
