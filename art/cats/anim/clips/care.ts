// Care clips: grooming, eating, drinking, paw in water, litter, kneading, scratching.
import type { ClipSpec, Ctx } from '../catalog.ts';
import { type Body, type Leg, partFrame, toWorld } from '../body.ts';
import { type V3, bump, clamp, curve, lerp, loopNoise, pulse, smooth } from '../math.ts';
import { type LegId, type Rig } from '../rig.ts';
import { addBreath, chew, earFlick, flatMeta, headPoint, plantLeg, setTrunk, stanceFromAir, step, stepLeg, tailShape } from '../poses.ts';
import { allPlanted, idlePose, once, sitPose } from './rest.ts';

const DEG = Math.PI / 180;

/** Feeding crouch over a bowl ahead of the forepaws: elbows out, hind end folded low, head down. */
function crouchAtBowl(ctx: Ctx, depth: number): Body {
  const M = ctx.M, b = idlePose(ctx), rig = ctx.rig, sH = M.shoulderH, k = M.legScale;
  setTrunk(rig, b, { pelvisDrop: depth * 1.5 * sH, chestDrop: depth * 1.15 * sH, arch: 0.12 });
  b.spine[3]![0] -= 0.12; b.spine[4]![0] -= 0.28;
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id]; L.abduct = 0.5; L.out = 0.25; L.fore = 0.2; L.foreK = 0.2;
    L.toe = [L.toe[0] * 1.15, L.toe[1], L.toe[2] - 0.01 * k];
  }
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id];
    L.meta = lerp(rig.legs[id].stanceMeta, flatMeta(rig, id), 0.75); L.abduct = 0.25; L.out = 0.16;
    L.toe = [L.toe[0] * 1.1, L.toe[1], L.toe[2] + 0.04 * k];
  }
  // Neck stretched down to the bowl, head tipped to it.
  b.neck = [[-0.75, 0, 0], [-0.35, 0, 0]];
  b.gaze = [-1.15, 0, 0, 0.45];
  b.whisk = 0.15;
  b.tail = tailShape({ base: -0.55, lift: -0.25, tip: 0.35, side: 0.55, tipSide: 0.35 });
  return b;
}

/** Lift a forepaw to a point near the face: wrist target, carpus folded so the paw curls toward the mouth. */
function pawTo(L: Leg, wrist: V3, w: number, carpus: number, digits: number) {
  L.c = [...wrist]; L.cw = w; L.rel = Math.max(L.rel, w); L.carpus = lerp(L.carpus, carpus, w); L.digits = lerp(L.digits, digits, w);
  L.curl = 0.25 * w;
}

/** One forepaw licked then wiped over cheek and ear (local time u in [0, 1.5]); side 1 = left paw. */
function faceWash(rig: Rig, b: Body, ctx: Ctx, u: number, side: 1 | -1) {
  const id: LegId = side > 0 ? 'LF' : 'RF', L = b.legs[id], k = ctx.M.legScale;
  const up = bump(u, 0.04, 0.26, 1.24, 1.46);
  const wipe = bump(u, 0.6, 0.7, 1.12, 1.22);
  const lickN = chew(u - 0.26, 0.34, 3, 0.4) * bump(u, 0.24, 0.3, 0.58, 0.64);
  // Head lowers to the paw to lick, then tilts and turns into the wiping paw.
  b.gaze[0] += -0.32 * up + 0.12 * wipe + 0.05 * lickN;
  b.gaze[1] += side * (0.16 * up + 0.12 * wipe);
  b.gaze[2] += side * 0.36 * wipe;
  b.jaw += 0.14 * lickN;
  b.spine = b.spine.map(s => [s[0] - 0.02 * up, s[1] + side * 0.02 * up, s[2] - side * 0.025 * up] as V3);
  const lickPt = headPoint(rig, b, [side * 0.012, -0.075, 0.03]);
  const sw = Math.sin(Math.PI * clamp((u - 0.6) / 0.54, 0, 1)) ** 2;
  const cheek = headPoint(rig, b, [side * 0.05, -0.05 + 0.08 * sw, 0.08 - 0.035 * sw]);
  const target: V3 = wipe > 0.01 ? [lerp(lickPt[0], cheek[0], wipe), lerp(lickPt[1], cheek[1], wipe), lerp(lickPt[2], cheek[2], wipe)] : lickPt;
  pawTo(L, target, up, 1.75, 0.5);
  L.abduct = -0.1 * up; L.share = lerp(L.share, 0.5, up); L.fore = lerp(L.fore, 1.0, up); L.foreK = lerp(L.foreK, 0, up);
  // Weight shifts onto the other forepaw.
  b.pelvis[2] -= side * 0.04 * up; b.pelvisOff[0] -= side * 0.006 * k * up;
  earFlick(b, u, 0.75, side, 0.3 * wipe, 0.4);
}

/** Licks along the flank over the shoulder: three long, rhythmic strokes per loop; the far forepaw braces. */
function flankGroom(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx), k = ctx.M.legScale;
  const p = (t % 1 + 1) % 1, drag = p < 0.68 ? smooth(p / 0.68) : 1 - smooth((p - 0.68) / 0.32);
  b.pelvis[0] -= 0.06; b.pelvis[1] += 0.12; b.pelvis[2] -= 0.06;
  b.spine = b.spine.map((s, i) => [s[0] - 0.04, s[1] + [0.14, 0.18, 0.2, 0.2, 0.18][i]!, s[2]] as V3);
  b.gaze = [0, 0, 0, 0];
  b.neck = [[-0.3 - 0.08 * drag, 0.62 + 0.06 * drag, 0.1], [-0.28 - 0.06 * drag, 0.55 + 0.05 * drag, 0.12]];
  b.head = [-0.35 - 0.12 * drag, 0.35, 0.4];
  b.jaw = 0.1 + 0.08 * drag;
  b.legs.RF.toe = [b.legs.RF.toe[0] - 0.02 * k, b.legs.RF.toe[1], b.legs.RF.toe[2] + 0.005 * k];
  b.earL = [0.35, 0.1, -0.05]; b.earR = [0.2, 0.05, 0];
  return addBreath(b, t, 3, 0.02);
}

/** Eat: dip and bite, chew with the head tilted (side teeth), pause, dip again. */
function eat(t: number, ctx: Ctx): Body {
  const b = once(ctx, 'bowl-eat', () => crouchAtBowl(ctx, 0.3));
  const dip = curve([[0, 0.6], [0.12, 1], [0.32, 1], [0.5, 0.35], [1.4, 0.25], [1.7, 0.3], [2, 0.6]])(t);
  const chewing = bump(t, 0.45, 0.55, 1.3, 1.42);
  const c = chew(t - 0.45, 0.85 / 3, 1, 0.3) * chewing;
  b.gaze[0] += -0.16 * dip + 0.04 * c;
  b.gaze[2] += 0.3 * chewing;
  b.gaze[1] += 0.06 * chewing;
  b.jaw = 0.22 * bump(t, 0.05, 0.15, 0.28, 0.36) + 0.09 * c + 0.03 * bump(t, 1.6, 1.65, 1.68, 1.75);
  b.neck[1]![0] += 0.04 * pulse(t, 1.55, 0.05, 0.08);
  earFlick(b, t, 1.0, 1, 0.2, 0.4);
  return addBreath(b, t, 1, 0.012);
}

/** Drink: head still over the water, four quick laps per second, the last folding into a swallow. */
function drink(t: number, ctx: Ctx): Body {
  const b = once(ctx, 'bowl-drink', () => { const x = crouchAtBowl(ctx, 0.33); x.gaze = [-1.0, 0, 0, 0.5]; return x; });
  const lap = chew(t, 1, 4, 0.32);
  const fourth = bump(t, 0.74, 0.8, 0.95, 1.0);
  b.jaw = 0.1 * lap * (1 - 0.5 * fourth);
  b.gaze[0] += 0.01 * lap + 0.03 * fourth;
  b.neck[1]![0] += 0.03 * fourth;
  return b;
}

/** Juniper's habit: dip a forepaw in the water, flick it, lick it. */
function pawWater(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx), M = ctx.M, k = M.legScale, L = b.legs.RF, home = [...L.toe] as V3, rig = ctx.rig;
  const bowl: V3 = [home[0] - 0.015 * k, 0.03 * k, home[2] + 0.1 * k];
  const reach = bump(t, 0.05, 0.25, 0.55, 0.72), toMouth = bump(t, 0.7, 0.9, 1.65, 1.85);
  const flick = bump(t, 0.55, 0.58, 0.72, 0.75) * Math.sin((t - 0.55) * 2 * Math.PI * 9);
  const lick = chew(t - 0.95, 0.7 / 3, 1, 0.4) * bump(t, 0.9, 0.95, 1.6, 1.7);
  const mouth = headPoint(rig, b, [-0.012, -0.075, 0.03]);
  if (toMouth > 0.001) pawTo(L, mouth, toMouth, 1.7 + 0.2 * flick, 0.5);
  if (reach > 0.001 && toMouth < 0.5) {
    const dip = 0.01 * k * Math.sin(Math.PI * clamp((t - 0.25) / 0.3, 0, 1));
    const lift = 0.05 * k * Math.sin(Math.PI * clamp(t / 0.25, 0, 1)) * (t < 0.25 ? 1 : 0);
    L.toe = [lerp(home[0], bowl[0], reach), lerp(home[1], bowl[1] - dip + lift, reach), lerp(home[2], bowl[2], reach)];
    L.rel = Math.max(L.rel, reach); L.carpus = 0.35 * reach + 0.5 * flick; L.digits = -0.2 + 0.4 * flick;
  }
  const lifted = Math.max(reach, toMouth);
  L.share = lerp(L.share, 0.5, lifted); L.fore = lerp(L.fore, 0.6, lifted); L.foreK = lerp(L.foreK, 0, lifted);
  b.gaze[0] += -0.35 * reach - 0.28 * toMouth + 0.05 * lick;
  b.gaze[1] += -0.12 * reach - 0.1 * toMouth;
  b.jaw += 0.12 * lick;
  b.whisk = 0.3 * reach;
  return b;
}

/** Front-paw strokes: scoops behind (dig) or sweeps forward (cover); each paw lifts, drags, returns. */
function pawStrokes(rig: Rig, b: Body, ctx: Ctx, t: number, strokes: [LegId, number, number][], forward: boolean) {
  const k = ctx.M.legScale, sH = ctx.M.shoulderH;
  for (const [id, t0, t1] of strokes) {
    if (t < t0 || t > t1) continue;
    const L = b.legs[id], home = [...L.toe] as V3, u = (t - t0) / (t1 - t0);
    const a: V3 = [home[0], home[1], home[2] + (forward ? -0.04 : 0.06) * k];
    const c: V3 = [home[0], home[1], home[2] + (forward ? 0.06 : -0.05) * k];
    if (u < 0.32) stepLeg(rig, L, id, t, t0, lerp(t0, t1, 0.32), home, a, 0.035 * sH, 1.1);
    else if (u < 0.74) {
      // The drag: pads in the litter, claws working.
      const s = smooth((u - 0.32) / 0.42);
      L.toe = [a[0], a[1] + 0.004 * k * Math.sin(Math.PI * s), lerp(a[2], c[2], s)]; L.curl = forward ? 0 : 0.45; L.dig = rig.legs[id].digRestPitch + (forward ? -0.1 : 0.25);
    } else stepLeg(rig, L, id, t, lerp(t0, t1, 0.74), t1, c, home, 0.025 * sH, 0.9);
  }
}

const DIG: [LegId, number, number][] = [['LF', 0.3, 0.65], ['RF', 0.6, 0.95], ['LF', 0.9, 1.25], ['RF', 1.2, 1.55], ['LF', 1.5, 1.85], ['RF', 1.8, 2.15]];
const COVER: [LegId, number, number][] = [['LF', 0.9, 1.32], ['RF', 1.27, 1.69], ['LF', 1.64, 2.06], ['RF', 2.01, 2.43]];
/** A stroking paw is never planted: it lifts, drags through the litter and returns. */
const airOf = (strokes: [LegId, number, number][]) => {
  const air: Partial<Record<LegId, [number, number][]>> = {};
  for (const [id, a, b] of strokes) (air[id] ??= []).push([a, b]);
  return air;
};

function litterDig(t: number, ctx: Ctx): Body {
  const M = ctx.M, b = idlePose(ctx);
  setTrunk(ctx.rig, b, { pelvisDrop: 0.1 * M.shoulderH, chestDrop: (0.05 + 0.12 * smooth(t / 0.3)) * M.shoulderH });
  b.gaze = [-0.75 * smooth(t / 0.3) - 0.04 * chew(t, 0.25, 1), 0.08 * Math.sin(t * 3), 0, 1];
  pawStrokes(ctx.rig, b, ctx, t, DIG, false);
  b.tail = tailShape({ base: -0.3, lift: 0.1, tip: 0.3 });
  b.whisk = 0.25;
  return b;
}

function litterCover(t: number, ctx: Ctx): Body {
  const M = ctx.M, b = idlePose(ctx);
  const look = bump(t, 0.05, 0.35, 0.55, 0.85);
  setTrunk(ctx.rig, b, { pelvisDrop: 0.08 * M.shoulderH, chestDrop: 0.12 * M.shoulderH, yaw: -0.08 * look });
  b.spine = b.spine.map(s => [s[0], s[1] + 0.16 * look, s[2]] as V3);
  // Turns to sniff the spot, then sweeps litter forward with slow alternating strokes, sniffing between.
  b.gaze = [-0.55 - 0.25 * look - 0.1 * bump(t, 0.85, 1.0, 2.3, 2.5), 1.4 * look, 0.1 * look, 1];
  pawStrokes(ctx.rig, b, ctx, t, COVER, true);
  b.tail = tailShape({ base: -0.4, lift: -0.1, tip: 0.3, side: -0.3 * look });
  return b;
}

/** Knead on a soft surface from a low crouch: alternating pushes, toes spreading and claws flexing; body rocks. */
function knead(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, rig = ctx.rig;
  const b = once(ctx, 'knead', () => {
    // From a sit, the chest leans forward over forepaws placed a little ahead.
    const x = sitPose(ctx);
    x.pelvis[0] -= 0.12; x.spine = x.spine.map(s => [s[0] * 0.6, s[1], s[2]] as V3);
    for (const id of ['LF', 'RF'] as const) { const L = x.legs[id]; L.toe = [L.toe[0], L.toe[1], L.toe[2] + 0.05 * k]; L.fore = 0.3; }
    x.tailCurve = null;
    x.gaze = [-0.1, 0, 0, 1]; x.earL = [0.15, 0.1, 0]; x.earR = [0.15, 0.1, 0];
    x.tail = tailShape({ base: -0.6, lift: -0.1, tip: 0.3, side: 0.6 });
    return x;
  });
  let rock = 0;
  for (const [id, t0] of [['LF', 0], ['RF', 0.4], ['LF', 0.8], ['RF', 1.2]] as const) {
    const L = b.legs[id], home = [...L.toe] as V3, u = ((t - t0) % 1.6 + 1.6) % 1.6;
    if (u < 0.18) stepLeg(rig, L, id, u, 0, 0.18, home, home, 0.03 * k, 1.0);
    else if (u < 0.42) {
      const press = Math.sin(Math.PI * (u - 0.18) / 0.24);
      L.spread = 0.3 * press; L.curl = 0.45 * press; L.meta = rig.legs[id].stanceMeta - 0.12 * press; rock += (id === 'LF' ? 1 : -1) * press;
    }
  }
  b.pelvisOff[0] += 0.004 * k * rock; b.pelvis[2] += 0.03 * rock;
  b.gaze[2] -= 0.04 * rock;
  return addBreath(b, t, 1.6, 0.025);
}

/** Scratching post: stretched up the post, alternating claw pulls, back arched, hind legs braced. */
function scratch(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, rig = ctx.rig, sH = M.shoulderH;
  const postZ = idlePose(ctx).legs.LF.toe[2] + 0.05 * k;
  const b = once(ctx, 'scratch', () => {
    const x = idlePose(ctx);
    setTrunk(rig, x, { pelvisDrop: 0.02 * sH, chestDrop: -0.5 * sH, arch: -0.12 });
    for (const id of ['LH', 'RH'] as const) { x.legs[id].toe = [x.legs[id].toe[0], x.legs[id].toe[1], x.legs[id].toe[2] + 0.03 * k]; }
    x.gaze = [0.2, 0, 0, 1]; x.earL = [0.1, 0, 0.05]; x.earR = [0.1, 0, 0.05];
    x.tail = tailShape({ base: -0.35, lift: -0.2, tip: 0.4 });
    return x;
  });
  let pull = 0;
  for (const [id, t0] of [['LF', 0], ['RF', 0.5], ['LF', 1.0], ['RF', 1.5]] as const) {
    const L = b.legs[id], u = ((t - t0) % 1 + 1) % 1, side = rig.legs[id].side;
    const hi = 0.92 * sH, lo = 0.7 * sH;
    let y: number, z = postZ;
    if (u < 0.42) { const s = smooth(u / 0.42); y = hi - (hi - lo) * s; pull += 0.5 * Math.sin(Math.PI * u / 0.42); L.curl = -0.35; L.digits = 0.9; L.carpus = 0.6; }
    else { const s = (u - 0.42) / 0.58; y = lo + (hi - lo) * smooth(s); z = postZ - 0.022 * k * Math.sin(Math.PI * s); L.curl = -0.1; L.digits = 0.7; L.carpus = 0.8; }
    L.toe = [side * 0.04 * k, y, z]; L.rel = 1; L.share = 0.55; L.fore = 2.2; L.foreK = 0; L.foreW = 0.4;
  }
  b.pelvisOff[1] -= 0.005 * k * pull;
  return b;
}

/** Litter squat: hind legs folded, rump low, tail raised and still, body tense, gaze fixed. */
function squat(t: number, ctx: Ctx): Body {
  const M = ctx.M, b = once(ctx, 'squat', () => {
    // From a sit: rump lifted just clear of the litter, pelvis less tilted, back slightly rounded.
    const x = sitPose(ctx);
    x.pelvisOff[1] += 0.035 * M.shoulderH; x.pelvis[0] -= 0.18; x.spine = x.spine.map((s, i) => [s[0] * 0.5 - 0.03 * (i < 3 ? 1 : 0), s[1], s[2]] as V3);
    x.tailCurve = null;
    for (const id of ['LH', 'RH'] as const) { const L = x.legs[id]; L.abduct = 0.3; L.out = 0.16; }
    x.gaze = [0, 0, 0, 1]; x.tail = tailShape({ base: 0.55, lift: 0.25, tip: 0.1 });
    x.earL = [0.25, 0.08, 0]; x.earR = [0.25, 0.08, 0];
    return x;
  });
  const n = loopNoise(ctx.seed, ctx.T, [2, 3, 5]);
  b.tail = b.tail.map((s, i) => [s[0], s[1] + 0.01 * n(t) * (i / 11), s[2]] as V3);
  earFlick(b, t, 2.3, -1, 0.3, 0.4);
  return addBreath(b, t, 1, 0.02);
}

export const careClips: ClipSpec[] = [
  {
    name: 'cat.care.groom_face',
    body: (t, ctx) => { const b = sitPose(ctx); if (t < 1.5) faceWash(ctx.rig, b, ctx, t, 1); else faceWash(ctx.rig, b, ctx, t - 1.5, -1); return addBreath(b, t, 1.5, 0.015); },
    stance: ctx => stanceFromAir(ctx.T, { LF: [[0.04, 1.46]], RF: [[1.54, 2.96]] }),
  },
  { name: 'cat.care.groom_flank', body: flankGroom, stance: allPlanted },
  { name: 'cat.care.eat_crouch', body: eat, stance: allPlanted, tailSim: { wBase: 24, wTip: 10, zeta: 0.7 } },
  { name: 'cat.care.drink_lap', body: drink, stance: allPlanted },
  { name: 'cat.care.paw_water', body: pawWater, stance: ctx => stanceFromAir(ctx.T, { RF: [[0.05, 1.85]] }) },
  { name: 'cat.care.litter_dig', body: litterDig, stance: ctx => stanceFromAir(ctx.T, airOf(DIG)), tailSim: { wBase: 24, wTip: 10, zeta: 0.7 } },
  { name: 'cat.care.litter_squat', body: squat, stance: allPlanted },
  { name: 'cat.care.litter_cover', body: litterCover, stance: ctx => stanceFromAir(ctx.T, airOf(COVER)), tailSim: { wBase: 24, wTip: 10, zeta: 0.7 } },
  {
    name: 'cat.care.knead', body: knead,
    stance: ctx => stanceFromAir(ctx.T, { LF: [[0, 0.18], [0.8, 0.98]], RF: [[0.4, 0.58], [1.2, 1.38]] }),
  },
  { name: 'cat.care.scratch_post', body: scratch, stance: ctx => ({ LH: [[0, ctx.T]], RH: [[0, ctx.T]] }), tailSim: { wBase: 26, wTip: 12, zeta: 0.7 } },
];

void step; void partFrame; void toWorld; void plantLeg; void DEG;
