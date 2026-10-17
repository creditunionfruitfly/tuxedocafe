// Play, social and reaction clips: bats, roll over, head rub, greeting, slow blink, hiss, flinch, swat.
import type { ClipSpec, Ctx } from '../catalog.ts';
import { type Body, type Leg, cloneBody, mirrorBody, mixBody } from '../body.ts';
import { hissEars, hissOpen, slowBlink } from '../expressions.ts';
import { type V3, DEG, bump, clamp, lerp, ring, smooth } from '../math.ts';
import { qBody } from '../math.ts';
import { LEGS, type LegId } from '../rig.ts';
import { bodyPoint, freeLeg, keyedLag, lieSideBody, setTrunk, stanceFromAir, stepLeg, tailShape } from '../poses.ts';
import { allPlanted, idlePose, once, sitPose } from './rest.ts';

/** Paw along timed waypoints with eased segments (free leg: carpus folded while lifted). */
export function pawPath(L: Leg, t: number, times: number[], pts: V3[]) {
  const tt = clamp(t, times[0]!, times[times.length - 1]!);
  let seg = 0;
  while (seg < times.length - 2 && tt > times[seg + 1]!) seg++;
  const u = smooth((tt - times[seg]!) / (times[seg + 1]! - times[seg]!)), a = pts[seg]!, c = pts[seg + 1]!;
  L.toe = [lerp(a[0], c[0], u), lerp(a[1], c[1], u), lerp(a[2], c[2], u)];
}

/** A lifted forepaw's free-mode angles with a lift weight (0 planted, 1 fully off the floor). */
export function liftAngles(L: Leg, up: number, carpus: number, digits: number, curl = 0.2) {
  L.rel = up; L.carpus = lerp(-0.25, carpus, up); L.digits = lerp(L.digits, digits, up); L.curl = curl * up;
  L.share = lerp(L.share, 0.55, up); L.foreK = lerp(L.foreK, 0, up); L.fore = lerp(L.fore, 0.7, up);
}

/** Quick forepaw swipe from a sit at a small object ahead; authored for the left paw, mirrored for the right. */
function batLeft(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx), k = ctx.M.legScale, L = b.legs.LF, home = [...L.toe] as V3, x = home[0];
  pawPath(L, t, [0, 0.09, 0.17, 0.25, 0.38, 0.52],
    [home, [x * 0.7, 0.13 * k, home[2] - 0.005 * k], [x + 0.045 * k, 0.09 * k, home[2] + 0.1 * k], [-0.015 * k, 0.035 * k, home[2] + 0.12 * k], [x * 0.7, 0.05 * k, home[2] + 0.05 * k], home]);
  const up = bump(t, 0.01, 0.07, 0.42, 0.52);
  liftAngles(L, up, 1.1 - 0.9 * bump(t, 0.14, 0.18, 0.22, 0.27), 0.2);
  L.abduct = 0.25 * up;
  b.gaze = [-0.3 - 0.05 * up, 0.16 * bump(t, 0, 0.1, 0.16, 0.24) - 0.05 * bump(t, 0.2, 0.26, 0.4, 0.55), 0.05 * up, 1];
  b.pelvis[2] -= 0.04 * up; b.spine = b.spine.map(s => [s[0], s[1] + 0.02 * up, s[2] - 0.02 * up] as V3);
  b.earL = [-0.1 * up, 0, 0.12 * up]; b.earR = [-0.1 * up, 0, 0.12 * up]; b.whisk = 0.3 * up;
  return b;
}

/** Lying on the back, paws relaxed in the air. */
function backBody(ctx: Ctx): Body {
  const rig = ctx.rig, b = lieSideBody(rig, 165 * DEG);
  b.pelvisOff[1] = rig.M.skin + 0.012 * rig.M.legScale - rig.offset[rig.index('pelvis')]!.y + rig.M.halfWidth * 0.2;
  b.pelvisOff[0] = 0;
  b.spine = [[0, 0.04, 0], [0.02, 0.04, 0.02], [0.03, 0.03, 0.03], [0.02, 0.02, 0.02], [0, 0.02, 0]];
  b.neck = [[0.18, 0, -0.08], [0.12, 0, -0.08]]; b.head = [0.1, 0, -0.22];
  for (const id of ['LF', 'RF'] as const) {
    const d = rig.legs[id];
    freeLeg(b.legs[id], bodyPoint(rig, b, 'spine_04', [d.side * 0.05, -0.12, 0.07]), 1.3, 0.5, { curl: 0.3, fore: 1.2, foreK: 0, share: 0.3 });
  }
  for (const id of ['LH', 'RH'] as const) {
    const d = rig.legs[id];
    freeLeg(b.legs[id], bodyPoint(rig, b, 'pelvis', [d.side * 0.12, -0.14, 0.05]), 1.0, 0.3, { abduct: 0.4 });
  }
  b.tail = tailShape({ base: -0.1, side: 0.6, tipSide: 0.4 });
  return b;
}

/** Drop onto the side, roll onto the back, wriggle, roll back onto the side (shared with the catnip roll). */
export function rollOver(t: number, ctx: Ctx, o: { drop: number; back: number; wriggleEnd: number; T: number; rub: number }): Body {
  const stand = idlePose(ctx), side = once(ctx, 'roll-side', () => lieSideBody(ctx.rig, 80 * DEG)), back = once(ctx, 'roll-back', () => backBody(ctx));
  const kneel = mixBody(stand, side, 0.45); kneel.pelvis[2] = 0.35; kneel.tail = side.tail;
  const b = keyedLag(t, [[0, stand], [o.drop * 0.55, kneel], [o.drop, side], [o.back, back], [o.wriggleEnd, back], [o.T, side]], { head: 0.06, tail: 0.1 });
  const w = bump(t, o.back - 0.05, o.back + 0.05, o.wriggleEnd - 0.1, o.wriggleEnd);
  const wav = Math.sin((t - o.back) * 2 * Math.PI * 2.4);
  b.pelvis[2] += 0.12 * w * wav;
  b.spine = b.spine.map((s, i) => [s[0], s[1] + 0.07 * w * Math.sin((t - o.back) * 2 * Math.PI * 2.4 - i * 0.5), s[2] - 0.05 * w * wav] as V3);
  b.head[2] += o.rub * w * Math.sin((t - o.back) * 2 * Math.PI * 1.6); b.neck[1]![2] += 0.5 * o.rub * w * Math.sin((t - o.back) * 2 * Math.PI * 1.6);
  for (const id of LEGS) b.legs[id].carpus += 0.15 * w * Math.sin((t - o.back) * 9 + LEGS.indexOf(id));
  return b;
}

/** Lean in and rub the cheek, the side of the head, then the flank along a hand or object at the cat's left; tail up. */
function headRub(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx);
  const tailUp = tailShape({ base: 1.25, lift: 0.3, tip: 0.8 });
  const lean = cloneBody(stand); setTrunk(ctx.rig, lean, { pelvisDrop: 0.03 * M.shoulderH, chestDrop: 0.06 * M.shoulderH, lateral: 0.012 * k, roll: -0.05, surge: 0.01 * k });
  lean.gaze = [0.05, 0.5, -0.25, 1]; lean.tail = tailUp; lean.earL = [0.35, 0.15, 0]; lean.earR = [0, 0, 0.05];
  const cheek = cloneBody(lean); cheek.gaze = [0.08, 0.85, -0.45, 1]; cheek.earL = [0.6, 0.35, -0.05];
  const flank = cloneBody(lean); setTrunk(ctx.rig, flank, { pelvisDrop: 0.03 * M.shoulderH, chestDrop: 0.05 * M.shoulderH, lateral: 0.02 * k, roll: -0.08, surge: 0.015 * k, yaw: 0.1 });
  flank.spine = flank.spine.map(s => [s[0], s[1] - 0.09, s[2] - 0.02] as V3); flank.gaze = [0.02, 0.15, -0.1, 1]; flank.tail = tailUp;
  const end = cloneBody(stand); end.tail = tailUp; end.gaze = [0, 0.1, 0, 0.9];
  const b = keyedLag(t, [[0, stand], [0.3, lean], [0.65, cheek], [1.05, flank], [1.4, end]], { head: 0.05, tail: 0.15, ears: 0.06 });
  b.gaze[0] += 0.05 * Math.sin(t * 14) * bump(t, 0.35, 0.45, 0.9, 1.0);
  return b;
}

/** Tail-up greeting: tail rises vertical with a tip curl, chin up, a forward rock and a little tread in place. */
function greeting(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx), rig = ctx.rig;
  const up = cloneBody(stand); setTrunk(rig, up, { pelvisDrop: 0.015 * M.shoulderH, chestDrop: 0.0, surge: 0.02 * k });
  up.gaze = [0.22, 0, 0, 1]; up.tail = tailShape({ base: 1.3, lift: 0.25, tip: 0.85 }); up.earL = [-0.1, -0.05, 0.12]; up.earR = [-0.1, -0.05, 0.12];
  const hold = cloneBody(up); setTrunk(rig, hold, { pelvisDrop: 0.025 * M.shoulderH, chestDrop: 0.015 * M.shoulderH, surge: 0.01 * k }); hold.gaze = [0.14, 0.05, 0, 1];
  const b = keyedLag(t, [[0, stand], [0.45, up], [1.0, hold], [1.5, hold]], { head: 0.05, tail: 0.16, ears: 0.05 });
  for (const [id, t0, t1] of [['LF', 0.28, 0.46], ['RF', 0.58, 0.76]] as const) {
    if (t > t0 && t < t1) stepLeg(rig, b.legs[id], id, t, t0, t1, stand.legs[id].toe, stand.legs[id].toe, 0.035 * k, 0.9);
  }
  b.gaze[0] += 0.04 * bump(t, 0.25, 0.32, 0.4, 0.5);
  return b;
}

/** Hiss: drawn back onto the hind legs, back arched, ears flattened sideways, mouth wide. */
function hiss(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx);
  // Defensive arch: the back humps high over straight legs, the body drawn back onto the hind legs.
  const back = cloneBody(stand); setTrunk(ctx.rig, back, { pelvisDrop: 0.02 * M.shoulderH, chestDrop: 0.08 * M.shoulderH, surge: -0.035 * k, arch: 0.85 });
  back.gaze = [-0.12, 0, 0, 1]; back.whisk = -0.4;
  back.tail = tailShape({ base: -0.15, lift: -0.9, tip: 0.2 });
  for (const id of ['LF', 'RF'] as const) { back.legs[id].fore = -0.15; back.legs[id].foreK = 0.3; }
  const lunge = cloneBody(back); setTrunk(ctx.rig, lunge, { pelvisDrop: 0.03 * M.shoulderH, chestDrop: 0.12 * M.shoulderH, surge: -0.015 * k, arch: 0.75 }); lunge.gaze = [-0.2, 0, 0, 1];
  const b = keyedLag(t, [[0, stand], [0.18, back, x => 1 - (1 - x) ** 3], [0.3, lunge], [0.45, back], [0.95, back], [1.2, mixBody(back, stand, 0.35)]], { head: 0.03, tail: 0.08 });
  const ears = hissEars(t);
  b.earL = [0.75 * ears, 0.85 * ears, -0.1 * ears]; b.earR = [0.75 * ears, 0.85 * ears, -0.1 * ears];
  b.jaw = 0.62 * hissOpen(t);
  b.gaze[0] += 0.02 * Math.sin(t * 40) * bump(t, 0.25, 0.3, 0.8, 0.9);
  return b;
}

/** Startle: sudden crouch and recoil, freeze, assess. */
function flinch(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx);
  const duck = cloneBody(stand); setTrunk(ctx.rig, duck, { pelvisDrop: 0.15 * M.shoulderH, chestDrop: 0.2 * M.shoulderH, surge: -0.035 * k, arch: 0.12 });
  duck.gaze = [-0.05, 0.05, 0, 1]; duck.neck = [[-0.15, 0, 0], [-0.1, 0, 0]]; duck.earL = [0.5, 0.25, 0]; duck.earR = [0.35, 0.2, 0];
  duck.tail = tailShape({ base: -0.75, lift: -0.3, tip: 0.1 }); duck.whisk = -0.2; duck.eyes = [0, 0.05, 0, 0.05];
  const assess = cloneBody(duck); setTrunk(ctx.rig, assess, { pelvisDrop: 0.12 * M.shoulderH, chestDrop: 0.14 * M.shoulderH, surge: -0.025 * k, arch: 0.08 });
  assess.gaze = [0.05, -0.1, 0, 1]; assess.neck = [[0, 0, 0], [0, 0, 0]]; assess.earL = [-0.1, 0, 0.1]; assess.earR = [-0.05, 0, 0.1]; assess.whisk = 0.2;
  const b = keyedLag(t, [[0, stand], [0.09, duck, x => 1 - (1 - x) ** 4], [0.45, duck], [0.7, assess]], { head: 0.02, tail: 0.05 });
  b.pelvisOff[1] += 0.008 * k * ring(t, 0.09, 6, 0.08);
  return b;
}

/** Swat: a fast single right-forepaw strike toward the hand, then a pull back; ears back, weight on the left. */
function swat(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx);
  const set = cloneBody(stand); setTrunk(ctx.rig, set, { pelvisDrop: 0.08 * M.shoulderH, chestDrop: 0.04 * M.shoulderH, surge: -0.02 * k, lateral: 0.008 * k, roll: 0.05 });
  set.earL = [0.7, 0.4, -0.05]; set.earR = [0.7, 0.4, -0.05]; set.gaze = [0.12, -0.05, 0, 1]; set.tail = tailShape({ base: -0.4, lift: -0.2, tip: 0.3, side: 0.3 });
  const b = keyedLag(t, [[0, stand], [0.1, set], [0.45, set], [0.6, mixBody(set, stand, 0.5)]], { head: 0.02, tail: 0.06 });
  b.earL = [...set.earL]; b.earR = [...set.earR];
  const L = b.legs.RF, home = stand.legs.RF.toe;
  pawPath(L, t, [0, 0.11, 0.25, 0.42, 0.58],
    [home, [home[0] * 0.7, 0.17 * k, home[2] - 0.01 * k], [home[0] * 0.5, 0.3 * k, home[2] + 0.15 * k], [home[0] * 0.8, 0.11 * k, home[2] + 0.03 * k], home]);
  const up = bump(t, 0.02, 0.1, 0.45, 0.58), strike = bump(t, 0.18, 0.23, 0.27, 0.34);
  liftAngles(L, up, 1.2 - 1.3 * strike, 0.3 - 0.6 * strike);
  L.curl = -0.45 * strike + 0.2 * up; L.spread = 0.25 * strike;
  b.gaze[0] += 0.05 * strike;
  return b;
}

export const playClips: ClipSpec[] = [
  { name: 'cat.play.bat_left', body: batLeft, stance: ctx => stanceFromAir(ctx.T, { LF: [[0.01, 0.52]] }) },
  { name: 'cat.play.bat_right', body: (t, ctx) => mirrorBody(batLeft(t, ctx)), stance: ctx => stanceFromAir(ctx.T, { RF: [[0.01, 0.52]] }) },
  {
    name: 'cat.play.roll_over', body: (t, ctx) => rollOver(t, ctx, { drop: 0.45, back: 0.8, wriggleEnd: 1.4, T: 2.0, rub: 0.25 }),
    tailSim: { wBase: 24, wTip: 11, zeta: 0.6 }, stance: () => ({}),
  },
  { name: 'cat.social.head_rub', body: headRub, tailSim: { wBase: 26, wTip: 18, zeta: 0.75 }, stance: allPlanted },
  {
    name: 'cat.social.tail_up_greeting', body: greeting, tailSim: { wBase: 26, wTip: 12, zeta: 0.65 },
    stance: ctx => stanceFromAir(ctx.T, { LF: [[0.28, 0.46]], RF: [[0.58, 0.76]] }),
  },
  {
    name: 'cat.social.slow_blink',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: t => {
        const d = slowBlink(t);
        return { neck_02: qBody(-0.035 * d, 0, 0), head: qBody(-0.07 * d, 0, 0.02 * d) };
      },
    },
  },
  { name: 'cat.react.hiss', body: hiss, tailSim: { wBase: 30, wTip: 20, zeta: 0.85 }, stance: allPlanted },
  { name: 'cat.react.flinch_startle', body: flinch, tailSim: { wBase: 30, wTip: 14, zeta: 0.6 }, stance: allPlanted },
  { name: 'cat.react.swat', body: swat, tailSim: { wBase: 30, wTip: 14, zeta: 0.6 }, stance: ctx => stanceFromAir(ctx.T, { RF: [[0.02, 0.58]] }) },
];

export type { LegId };
