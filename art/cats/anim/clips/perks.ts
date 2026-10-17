// Perk clips (first used in M5/M6): catnip, laser pointer, feather wand and harness.
import type { ClipSpec, Ctx, Stance } from '../catalog.ts';
import { type Body, cloneBody, mixBody } from '../body.ts';
import { type GaitPlan, type GaitStyle, fitGait, gaitBody, gaitStance, planGait } from '../gait.ts';
import { type V3, bump, curve, lerp, loopCurve, pulse, smooth } from '../math.ts';
import { LEGS, type LegId, type Rig } from '../rig.ts';
import { addBreath, chew, earFlick, flatMeta, keyedLag, lieSideBody, setTrunk, stanceFromAir, stepLeg, tailShape } from '../poses.ts';
import { gaitExtras, gaitPlan, gallopStyle, walkStyle } from './loco.ts';
import { flightLeg, pounce, pounceStance } from './move.ts';
import { liftAngles, pawPath, rollOver } from './play.ts';
import { allPlanted, idlePose, once, sitPose } from './rest.ts';

const TAU = Math.PI * 2;

/** Low sniffing posture over a point on the floor ahead (toy or ground): forelegs bent, neck stretched down. */
function sniffPose(ctx: Ctx, depth: number, reach = 1): Body {
  const M = ctx.M, b = idlePose(ctx), sH = M.shoulderH;
  setTrunk(ctx.rig, b, { pelvisDrop: depth * 0.6 * sH, chestDrop: depth * sH, arch: 0.05 });
  b.spine[4]![0] -= 0.2 * reach;
  for (const id of ['LF', 'RF'] as const) { b.legs[id].abduct = 0.3; b.legs[id].fore = 0.15; }
  b.neck = [[-0.6 * reach, 0, 0], [-0.25 * reach, 0, 0]];
  b.gaze = [-0.95, 0, 0, 0.45];
  b.whisk = 0.4;
  b.earL = [-0.12, -0.04, 0.12]; b.earR = [-0.12, -0.04, 0.12];
  b.tail = tailShape({ base: -0.3, lift: -0.15, tip: 0.45, side: 0.15 });
  return b;
}

/** Rapid sniffing: the nose twitches a few times a second while the head makes small searching moves. */
function sniffs(b: Body, t: number, rate: number, amount: number) {
  const s = chew(t, 1 / rate, 1, 0.45);
  b.gaze[0] += amount * 0.04 * s; b.neck[1]![0] += amount * 0.02 * s;
  return b;
}

/** Catnip sniff: intent sniffing, then the flehmen grimace (head up a little, mouth slightly open), loop. */
function catnipSniff(t: number, ctx: Ctx): Body {
  const b = once(ctx, 'catnip-sniff', () => sniffPose(ctx, 0.3));
  const fleh = bump(t, 0.9, 1.15, 1.6, 1.85);
  sniffs(b, t, 5, 1 - fleh);
  b.gaze[0] += 0.35 * fleh; b.neck[0]![0] += 0.25 * fleh;
  b.jaw = 0.16 * fleh + 0.02 * Math.sin(TAU * t * 2.5) * (1 - fleh);
  b.whisk = 0.4 - 0.3 * fleh;
  b.earL[0] += 0.15 * fleh; b.earR[0] += 0.15 * fleh;
  return addBreath(b, t, 1, 0.012);
}

/** Catnip lick: licks and chews the toy with the head tilted, eyes half closed, loop. */
function catnipLick(t: number, ctx: Ctx): Body {
  const b = once(ctx, 'catnip-lick', () => sniffPose(ctx, 0.36));
  const licks = chew(t, 2, 6, 0.4) * bump(t, 0, 0.05, 0.9, 1.0);
  const chewing = bump(t, 0.95, 1.05, 1.85, 1.98), c = chew(t - 1.0, 0.85 / 3, 1, 0.3) * chewing;
  b.jaw = 0.14 * licks + 0.1 * c;
  b.gaze[0] += -0.06 * licks + 0.03 * c; b.gaze[2] += 0.3 * chewing; b.gaze[1] += 0.08 * Math.sin(TAU * t / 2);
  b.earL = [0.1, 0.08, 0]; b.earR = [0.1, 0.08, 0];
  return addBreath(b, t, 1, 0.012);
}

const ctxOf = (ctx: Ctx, name: string): Ctx => {
  const clip = ctx.catalog.clips.find(c => c.name === name)!;
  return { ...ctx, clip, T: clip.durationS, n: Math.round(clip.durationS * ctx.catalog.fps) };
};

/** Catnip zoomies: the gallop cycle five times over, swerving left then right (sharp turns as body bend and lean). */
function zoomPlan(ctx: Ctx) { return gaitPlan('cat.loco.gallop', gallopStyle, ctxOf(ctx, 'cat.loco.gallop')); }
function catnipZoom(t: number, ctx: Ctx): Body {
  const plan = zoomPlan(ctx), T = plan.style.T;
  const b = gaitBody(ctx.rig, plan, ((t / T) % 1 + 1) % 1);
  const turn = loopCurve([[0, 0], [0.12, 0.9], [0.3, 1], [0.42, -0.2], [0.55, -1], [0.75, -0.85], [0.88, 0.2]])(t / ctx.T);
  b.spine = b.spine.map(s => [s[0], s[1] + 0.07 * turn, s[2] + 0.04 * turn] as V3);
  b.pelvis[1] -= 0.08 * turn; b.pelvis[2] += 0.06 * turn;
  b.gaze[1] += 0.35 * turn; b.gaze[2] += 0.12 * turn;
  b.earL = [0.7, 0.4, -0.05]; b.earR = [0.7, 0.4, -0.05];
  b.tail = b.tail.map((s, i) => [s[0], s[1] - 0.08 * turn * (i / 11), s[2]] as V3);
  return b;
}
function zoomStance(ctx: Ctx): Stance {
  const plan = zoomPlan(ctx), base = gaitStance(plan.style), reps = Math.round(ctx.T / plan.style.T);
  const out: Stance = {};
  for (const id of LEGS) out[id] = Array.from({ length: reps }, (_, j) => base[id]![0]!.map(v => v + j * plan.style.T) as [number, number]);
  return out;
}

/** Slow crouched gaits (laser stalk, harness slink): the walk's footfall order with a long duty factor. */
const crouchGait = (o: { T: number; speed: number; duty: number; drop: number; head: number; lift: number }) => (ctx: Ctx): GaitStyle => ({
  ...walkStyle(ctx), T: o.T, speed: o.speed, duty: o.duty, contacts: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 },
  dropF: o.drop, dropH: o.drop * 1.1, liftF: o.lift, liftH: o.lift * 0.8, carpusF: 1.5, carpusH: 1.4, matchTd: 0.8,
  bob: 0.008, roll: 0.02, yaw: 0.03, blade: 0.045, glide: 0.03, headPitch: o.head, headBob: 0.0, skewF: 1.1, skewH: 1.1,
  metaF: [-0.05, -0.08, 0.6], metaH: [-0.15, -0.2, 0.35],
  tail: (i: number, phase: number) => [i === 0 ? -0.35 : i < 6 ? -0.04 : 0.05, 0.03 * Math.sin(TAU * (phase - i * 0.04)) * (i / 11), 0],
});
const plans = new WeakMap<Rig, Map<string, GaitPlan>>();
function crouchPlan(ctx: Ctx, key: string, style: (ctx: Ctx) => GaitStyle) {
  let m = plans.get(ctx.rig);
  if (!m) plans.set(ctx.rig, m = new Map());
  let p = m.get(key);
  if (!p) { const s = style(ctx), f = fitGait(ctx.rig, s); m.set(key, p = planGait(ctx.rig, s, f.fit, f.centreF, f.centreH)); }
  return p;
}
const STALK = crouchGait({ T: 2.0, speed: 0.12, duty: 0.8, drop: 0.32, head: -0.02, lift: 0.06 });
const SLINK = crouchGait({ T: 1.0, speed: 0.3, duty: 0.72, drop: 0.36, head: -0.12, lift: 0.07 });
function crouchClip(name: string, key: string, style: (ctx: Ctx) => GaitStyle, decorate: (b: Body, t: number, ctx: Ctx) => Body): ClipSpec {
  return {
    name,
    body: (t, ctx) => decorate(gaitBody(ctx.rig, crouchPlan(ctx, key, style), t / ctx.T), t, ctx),
    stance: ctx => gaitStance(crouchPlan(ctx, key, style).style),
    groundSpeed: (_t, ctx) => crouchPlan(ctx, key, style).v,
    tailSim: { wBase: 26, wTip: 12, zeta: 0.75 },
    extras: ctx => gaitExtras(crouchPlan(ctx, key, style)),
  };
}

/** Laser butt wiggle: low crouch, the hind end shifts side to side while the hind paws tread, eyes locked. */
function buttWiggle(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, sH = M.shoulderH, rig = ctx.rig;
  const b = once(ctx, 'wiggle', () => {
    const x = idlePose(ctx);
    setTrunk(rig, x, { pelvisDrop: 0.3 * sH, chestDrop: 0.37 * sH, surge: -0.02 * k });
    for (const id of ['LH', 'RH'] as const) x.legs[id].meta = lerp(rig.legs[id].stanceMeta, flatMeta(rig, id), 0.5);
    for (const id of ['LF', 'RF'] as const) { x.legs[id].abduct = 0.3; x.legs[id].fore = 0.25; }
    x.gaze = [0, 0, 0, 1]; x.earL = [-0.1, 0, 0.12]; x.earR = [-0.1, 0, 0.12]; x.whisk = 0.35;
    x.tail = tailShape({ base: -0.55, lift: 0.1, tip: 0.2 });
    return x;
  });
  const w = bump(t, 0.05, 0.15, 0.85, 0.97);
  const wig = w * Math.sin(TAU * 4.5 * (t - 0.05));
  b.pelvis[1] += 0.11 * wig; b.pelvis[2] += 0.06 * wig; b.pelvisOff[0] += 0.008 * k * wig;
  b.pelvisOff[1] += 0.012 * sH * Math.abs(wig);
  b.tail = b.tail.map((s, i) => [s[0], s[1] + 0.25 * smooth((i - 7) / 4) * Math.sin(t * 24) * w, s[2]] as V3);
  for (const [id, t0] of TREAD) stepLeg(rig, b.legs[id], id, t, t0, t0 + 0.08, b.legs[id].toe, b.legs[id].toe, 0.018 * k, 0.5);
  return b;
}
const TREAD: [LegId, number][] = [['LH', 0.18], ['RH', 0.3], ['LH', 0.42], ['RH', 0.54], ['LH', 0.66], ['RH', 0.78]];

/** Laser pounce (no root motion): a short lunge onto the dot, pinning it with both forepaws. */
const LASER = { Dp: 0.2, tCrouch: 0.08, tWig: [0.08, 0.2] as [number, number], tSpring: 0.26, tPin: 0.4, tread: false };
function laserPounce(t: number, ctx: Ctx): Body {
  const b = pounce(t, ctx, LASER);
  // In place: keep the lunge in the body (pelvis) rather than moving the root.
  b.pelvisOff = [b.pelvisOff[0] + b.rootPos[0], b.pelvisOff[1] + b.rootPos[1], b.pelvisOff[2] + b.rootPos[2]];
  b.rootPos = [0, 0, 0];
  return b;
}

/** Toy catch (end of a laser session): both forepaws clap onto the toy, it is pulled in and bitten. */
function toyCatch(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, sH = M.shoulderH, rig = ctx.rig;
  const crouch = once(ctx, 'catch-crouch', () => { const x = idlePose(ctx); setTrunk(rig, x, { pelvisDrop: 0.28 * sH, chestDrop: 0.3 * sH }); x.gaze = [-0.2, 0, 0, 1]; x.whisk = 0.4; return x; });
  const down = cloneBody(crouch); setTrunk(rig, down, { pelvisDrop: 0.3 * sH, chestDrop: 0.42 * sH, arch: 0.1 }); down.gaze = [-0.9, 0, 0, 0.7]; down.neck = [[-0.5, 0, 0], [-0.2, 0, 0]];
  const b = keyedLag(t, [[0, crouch], [0.3, crouch], [0.5, down], [1.2, down]], { head: 0.04, tail: 0.08 });
  const toy: V3 = [0, 0.02 * k, idlePose(ctx).legs.LF.toe[2] + 0.08 * k];
  for (const [id, t0, t1] of [['LF', 0.1, 0.36], ['RF', 0.13, 0.38]] as const) {
    const L = b.legs[id], d = rig.legs[id], home = crouch.legs[id].toe;
    const pin: V3 = [d.side * 0.02 * k, d.padY, toy[2] + 0.01 * k];
    if (t > t0 && t < t1) flightLeg(ctx, b, L, id, (t - t0) / (t1 - t0), home, [[0.03, -0.1, 0.12]], pin, 0.6);
    else if (t >= t1) {
      // Hugging the toy in toward the chest.
      const pull = smooth((t - 0.6) / 0.35);
      L.toe = [pin[0] * (1 - 0.5 * pull), pin[1] + 0.01 * k * pull, pin[2] - 0.04 * k * pull];
      L.curl = 0.4; L.spread = 0.2; L.out = -0.2; L.yaw = -d.side * 0.25;
    }
  }
  b.jaw = 0.25 * bump(t, 0.55, 0.65, 0.9, 1.05) + 0.12 * chew(t - 0.7, 0.18, 1, 0.3) * bump(t, 0.7, 0.75, 1.1, 1.2);
  b.earL = [0.1, 0.05, 0.1]; b.earR = [0.1, 0.05, 0.1];
  return b;
}

/** Feather bat from a sit: alternating high swipes at a dangling feather, loop. */
function featherBat(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx), k = ctx.M.legScale;
  b.gaze = [0.45, 0, 0, 1]; b.earL = [-0.12, -0.05, 0.12]; b.earR = [-0.12, -0.05, 0.12]; b.whisk = 0.35;
  for (const [id, t0] of [['LF', 0], ['RF', 0.4]] as const) {
    const L = b.legs[id], home = [...L.toe] as V3, x = home[0], u = ((t - t0) % 0.8 + 0.8) % 0.8;
    pawPath(L, u, [0, 0.08, 0.16, 0.26, 0.36], [home, [x * 0.8, 0.16 * k, home[2] + 0.02 * k], [-x * 0.4, 0.25 * k, home[2] + 0.07 * k], [x * 0.9, 0.12 * k, home[2] + 0.04 * k], home]);
    const up = bump(u, 0.0, 0.06, 0.28, 0.36);
    liftAngles(L, up, 0.9 - 0.7 * bump(u, 0.12, 0.15, 0.19, 0.23), 0.1);
    b.gaze[1] += 0.08 * (id === 'LF' ? 1 : -1) * up; b.pelvis[2] -= (id === 'LF' ? 1 : -1) * 0.04 * up;
  }
  return b;
}

/** Feather leap (no root motion): crouch, spring straight up with both forepaws reaching, land back. */
function featherLeap(t: number, ctx: Ctx): Body {
  const M = ctx.M, sH = M.shoulderH, rig = ctx.rig, stand = idlePose(ctx);
  const crouch = cloneBody(stand); setTrunk(rig, crouch, { pelvisDrop: 0.26 * sH, chestDrop: 0.16 * sH });
  for (const id of ['LH', 'RH'] as const) crouch.legs[id].meta = lerp(rig.legs[id].stanceMeta, flatMeta(rig, id), 0.4);
  crouch.gaze = [0.5, 0, 0, 1];
  const air = cloneBody(stand); setTrunk(rig, air, { pelvisDrop: -0.15 * sH, chestDrop: -0.6 * sH, arch: -0.1 }); air.gaze = [0.7, 0, 0, 1];
  air.tail = tailShape({ base: -0.5, lift: -0.3, tip: 0.3 });
  const landing = cloneBody(stand); setTrunk(rig, landing, { pelvisDrop: 0.12 * sH, chestDrop: 0.15 * sH });
  const b = keyedLag(t, [[0, stand], [0.25, crouch], [0.36, crouch], [0.52, air], [0.62, air], [0.82, landing], [1.2, stand]], { head: 0.04, tail: 0.1 });
  // Ballistic rise and fall of the body between takeoff (0.4) and landing (0.8).
  const lift = (t > 0.4 && t < 0.8) ? 4.9 * (t - 0.4) * (0.8 - t) : 0;
  b.pelvisOff[1] += lift;
  for (const id of LEGS) {
    const L = b.legs[id], home = stand.legs[id].toe, d = rig.legs[id];
    const t0 = d.front ? 0.36 : 0.4, t1 = d.front ? 0.84 : 0.8;
    if (t <= t0 || t >= t1) continue;
    const s = (t - t0) / (t1 - t0);
    if (d.front) {
      // Both forepaws reach up high and together toward the feather.
      flightLeg(ctx, b, L, id, s, home, [[0.03, -0.02, 0.12], [0.015, 0.08, 0.14], [0.03, -0.08, 0.1]], home, 0.2);
      L.carpus = lerp(L.carpus, -0.2, bump(s, 0.25, 0.4, 0.6, 0.75)); L.spread = 0.25 * bump(s, 0.3, 0.4, 0.6, 0.7);
    } else flightLeg(ctx, b, L, id, s, home, [[0.05, -0.15, -0.05], [0.05, -0.14, 0.0]], home);
  }
  return b;
}

/** Feather catch: rears a little from the sit, claps the feather between the forepaws, brings it down and bites. */
function featherCatch(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx), k = ctx.M.legScale, rig = ctx.rig;
  const rear = bump(t, 0.05, 0.25, 0.45, 0.7);
  b.pelvis[0] += 0.12 * rear; b.gaze = [0.5 * rear - 0.4 * bump(t, 0.5, 0.65, 0.9, 1.0), 0, 0, 1];
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id], d = rig.legs[id], home = [...L.toe] as V3;
    const clap: V3 = [d.side * 0.012 * k, 0.24 * k, home[2] + 0.06 * k], hold: V3 = [d.side * 0.015 * k, 0.07 * k, home[2] + 0.04 * k];
    pawPath(L, t, [0, 0.12, 0.28, 0.36, 0.6, 0.85, 1.0], [home, [home[0], 0.14 * k, home[2] + 0.03 * k], clap, clap, hold, hold, home]);
    liftAngles(L, bump(t, 0.02, 0.1, 0.85, 0.98), 0.6, 0.2);
    L.spread = 0.3 * bump(t, 0.24, 0.28, 0.6, 0.7); L.curl = 0.35 * bump(t, 0.26, 0.3, 0.8, 0.9);
  }
  b.jaw = 0.25 * bump(t, 0.55, 0.62, 0.8, 0.9);
  b.earL = [-0.1, -0.05, 0.1]; b.earR = [-0.1, -0.05, 0.1]; b.whisk = 0.4;
  return b;
}

/** Harness freeze: sinks low and flat, ears back, tail tucked, then holds stock-still (only breath and eyes move). */
function harnessFreeze(t: number, ctx: Ctx): Body {
  const M = ctx.M, sH = M.shoulderH, rig = ctx.rig, stand = idlePose(ctx);
  const flat = once(ctx, 'freeze', () => {
    const x = idlePose(ctx);
    setTrunk(rig, x, { pelvisDrop: 0.4 * sH, chestDrop: 0.38 * sH });
    for (const id of ['LH', 'RH'] as const) { x.legs[id].meta = lerp(rig.legs[id].stanceMeta, flatMeta(rig, id), 0.7); x.legs[id].abduct = 0.3; }
    for (const id of ['LF', 'RF'] as const) { x.legs[id].abduct = 0.45; x.legs[id].fore = 0.3; }
    x.gaze = [-0.12, 0, 0, 1]; x.earL = [0.55, 0.45, -0.05]; x.earR = [0.55, 0.45, -0.05]; x.whisk = -0.3;
    x.tail = tailShape({ base: -0.9, lift: -0.2, tip: 0.1, side: 0.3 });
    return x;
  });
  const b = keyedLag(t, [[0, stand], [0.45, flat, x => 1 - (1 - x) ** 3], [2.0, flat]], { head: 0.04, tail: 0.1, ears: 0.0 });
  const look = curve([[0, 0], [0.8, 0], [1.0, 0.25], [1.5, 0.22], [1.7, -0.1], [2.0, -0.08]])(t);
  b.eyes = [look, 0, look, 0];
  return addBreath(b, t, 1.0, 0.012);
}

/** Harness flop: drops onto the side in protest and stays down, tail tip flicking. */
function harnessFlop(t: number, ctx: Ctx): Body {
  const stand = idlePose(ctx), side = once(ctx, 'flop-side', () => lieSideBody(ctx.rig, 85 * Math.PI / 180));
  const kneel = mixBody(stand, side, 0.4); kneel.pelvis[2] = 0.3;
  const b = keyedLag(t, [[0, stand], [0.35, kneel], [0.7, side, x => 1 - (1 - x) ** 2], [2.0, side]], { head: 0.08, tail: 0.12 });
  const flick = pulse(t, 1.2, 0.06, 0.12) + 0.6 * pulse(t, 1.7, 0.06, 0.12);
  b.tail = b.tail.map((s, i) => [s[0], s[1] + 0.4 * flick * smooth((i - 6) / 5), s[2]] as V3);
  b.earL = [0.4, 0.3, 0]; b.earR = [0.4, 0.3, 0];
  return addBreath(b, t, 1.2, 0.03 * smooth((t - 0.7) / 0.3));
}

/** Harness sniff outdoors: head low to the ground, whiskers forward, sniffing and sweeping, loop. */
function harnessSniff(t: number, ctx: Ctx): Body {
  const b = once(ctx, 'harness-sniff', () => sniffPose(ctx, 0.22, 0.8));
  sniffs(b, t, 6, 1);
  b.gaze[1] += 0.18 * Math.sin(TAU * t / 2) + 0.05 * Math.sin(TAU * t);
  b.gaze[0] += 0.05 * Math.sin(TAU * t / 2 + 1);
  b.whisk = 0.45;
  earFlick(b, t, 1.3, 1, 0.3, 0.4);
  return addBreath(b, t, 1, 0.012);
}

export const perkClips: ClipSpec[] = [
  { name: 'cat.perk.catnip_sniff', body: catnipSniff, stance: allPlanted },
  { name: 'cat.perk.catnip_lick', body: catnipLick, stance: allPlanted },
  {
    name: 'cat.perk.catnip_roll', body: (t, ctx) => rollOver(t, ctx, { drop: 0.4, back: 0.75, wriggleEnd: 2.5, T: 3.0, rub: 0.45 }),
    tailSim: { wBase: 24, wTip: 11, zeta: 0.6 }, stance: () => ({}),
  },
  { name: 'cat.perk.catnip_zoom', body: catnipZoom, stance: zoomStance, groundSpeed: (_t, ctx) => zoomPlan(ctx).v, tailSim: { wBase: 38, wTip: 22, zeta: 0.85 }, extras: ctx => gaitExtras(zoomPlan(ctx)) },
  crouchClip('cat.perk.laser_stalk', 'stalk', STALK, (b, t) => {
    b.gaze = [0.0, 0.02 * Math.sin(TAU * t / 2), 0, 1]; b.earL = [-0.15, -0.05, 0.14]; b.earR = [-0.15, -0.05, 0.14]; b.whisk = 0.4;
    return b;
  }),
  { name: 'cat.perk.laser_butt_wiggle', body: buttWiggle, stance: ctx => stanceFromAir(ctx.T, Object.fromEntries((['LH', 'RH'] as const).map(id => [id, TREAD.filter(x => x[0] === id).map(([, t0]) => [t0, t0 + 0.08] as [number, number])]))) },
  {
    name: 'cat.perk.laser_pounce', body: laserPounce, tailSim: { wBase: 28, wTip: 12, zeta: 0.65 },
    stance: ctx => pounceStance(ctx.T, LASER),
  },
  { name: 'cat.perk.toy_catch', body: toyCatch, stance: ctx => stanceFromAir(ctx.T, { LF: [[0.1, 0.36], [0.6, 1.2]], RF: [[0.13, 0.38], [0.6, 1.2]] }), tailSim: { wBase: 26, wTip: 12, zeta: 0.7 } },
  { name: 'cat.perk.feather_bat', body: featherBat, stance: ctx => stanceFromAir(ctx.T, { LF: [[0, 0.36]], RF: [[0.4, 0.76]] }) },
  { name: 'cat.perk.feather_leap', body: featherLeap, stance: ctx => stanceFromAir(ctx.T, { LF: [[0.36, 0.84]], RF: [[0.36, 0.84]], LH: [[0.4, 0.8]], RH: [[0.4, 0.8]] }), tailSim: { wBase: 26, wTip: 12, zeta: 0.7 } },
  { name: 'cat.perk.feather_catch', body: featherCatch, stance: ctx => ({ LH: [[0, ctx.T]], RH: [[0, ctx.T]] }) },
  { name: 'cat.perk.harness_freeze', body: harnessFreeze, stance: allPlanted, tailSim: { wBase: 24, wTip: 10, zeta: 0.8 } },
  crouchClip('cat.perk.harness_low_walk', 'slink', SLINK, b => { b.earL = [0.45, 0.35, -0.05]; b.earR = [0.45, 0.35, -0.05]; b.whisk = 0.2; return b; }),
  { name: 'cat.perk.harness_flop', body: harnessFlop, tailSim: { wBase: 24, wTip: 10, zeta: 0.7 }, stance: () => ({}) },
  { name: 'cat.perk.harness_sniff', body: harnessSniff, stance: allPlanted },
];

