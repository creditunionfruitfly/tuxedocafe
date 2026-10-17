// Play, social and reaction clips: bats, roll over, head rub, greeting, slow blink, hiss, flinch, swat.
import type { ClipSpec, Ctx } from '../catalog.ts';
import { type Body, cloneBody, mirrorBody, mixBody } from '../body.ts';
import { type V3, DEG, bump, curve, pulse, qBody, ring, smooth } from '../math.ts';
import { LEGS, type LegId } from '../rig.ts';
import { addBreath, bodyPoint, keyed, keyedLag, lieSideBody, setTrunk, stanceFromAir, tailShape } from '../poses.ts';
import { idlePose, once, sitPose } from './rest.ts';

const allPlanted = (ctx: Ctx) => Object.fromEntries(LEGS.map(id => [id, [[0, ctx.T]] as [number, number][]]));

/** Path through waypoints with eased segments. */
function path(s: number, pts: V3[]): V3 {
  const n = pts.length - 1, seg = Math.min(n - 1, Math.floor(s * n)), u = smooth(s * n - seg);
  const a = pts[seg]!, b = pts[seg + 1]!;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Quick forepaw swipe from a sit; authored for the left paw, mirrored for the right. */
function batLeft(t: number, ctx: Ctx): Body {
  const b = sitPose(ctx), k = ctx.M.legScale, L = b.legs.LF, home = L.toe, x = home[0];
  const pts: V3[] = [home, [x * 0.6, 0.17 * k, home[2] - 0.01 * k], [x + 0.06 * k, 0.1 * k, home[2] + 0.12 * k], [-0.02 * k, 0.035 * k, home[2] + 0.15 * k], [x * 0.7, 0.06 * k, home[2] + 0.06 * k], home];
  const times = [0, 0.09, 0.17, 0.25, 0.38, 0.52];
  const tt = Math.min(Math.max(t, 0), 0.52);
  let seg = 0; while (seg < times.length - 2 && tt > times[seg + 1]!) seg++;
  const u = smooth((tt - times[seg]!) / (times[seg + 1]! - times[seg]!)), a = pts[seg]!, c = pts[seg + 1]!;
  L.toe = [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u];
  const up = bump(t, 0.02, 0.09, 0.4, 0.52);
  L.heel += 0.9 * up - 0.3 * bump(t, 0.15, 0.18, 0.22, 0.26); L.toeP = 1.0 * up; L.curl = 0.25 * up; L.share = 0.55; L.abduct = 0.3 * up;
  b.gaze = [-0.3 - 0.05 * up, 0.18 * bump(t, 0, 0.1, 0.16, 0.24) - 0.05 * bump(t, 0.2, 0.26, 0.4, 0.55), 0.05 * up, 1];
  b.pelvis[2] -= 0.04 * up; b.spine = b.spine.map(s => [s[0], s[1] + 0.02 * up, s[2] - 0.02 * up] as V3);
  b.earL = [-0.1 * up, 0, 0.12 * up]; b.earR = [-0.1 * up, 0, 0.12 * up]; b.whisk = 0.3 * up;
  return b;
}

/** Lying on the back, paws relaxed in the air. */
function backBody(ctx: Ctx): Body {
  const rig = ctx.rig, b = lieSideBody(rig, 168 * DEG);
  b.pelvisOff[1] = rig.M.skin + 0.012 * rig.M.legScale - rig.offset[rig.index('pelvis')]!.y;
  b.pelvisOff[0] = 0;
  b.spine = [[0, 0.04, 0], [0.02, 0.04, 0.02], [0.03, 0.03, 0.03], [0.02, 0.02, 0.02], [0, 0.02, 0]];
  b.neck = [[0.2, 0, -0.1], [0.15, 0, -0.1]]; b.head = [0.1, 0, -0.25];
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id], d = rig.legs[id];
    L.toe = bodyPoint(rig, b, 'spine_04', [d.side * 0.05, -0.13, 0.07]); L.heel = 1.3; L.toeP = 1.7; L.curl = 0.3; L.flex = 0.7; L.comfort = 0.6;
  }
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id], d = rig.legs[id];
    L.toe = bodyPoint(rig, b, 'pelvis', [d.side * 0.13, -0.15, 0.05]); L.heel = 0.6; L.toeP = 0.8; L.abduct = 0.5; L.flex = 0.7; L.comfort = 0.6;
  }
  b.tail = tailShape({ base: -0.1, side: 0.6, tipSide: 0.4 });
  return b;
}

/** Drop onto the side, roll onto the back, wriggle, roll back onto the side (shared with catnip roll). */
export function rollOver(t: number, ctx: Ctx, o: { drop: number; back: number; wriggleEnd: number; T: number; rub: number }): Body {
  const stand = idlePose(ctx), side = once('roll-side', () => lieSideBody(ctx.rig, 80 * DEG)), back = once('roll-back', () => backBody(ctx));
  const kneel = mixBody(stand, side, 0.45); kneel.pelvis[2] = 0.35; kneel.tail = side.tail;
  const b = keyedLag(t, [[0, stand], [o.drop * 0.55, kneel], [o.drop, side], [o.back, back], [o.wriggleEnd, back], [o.T, side]], { head: 0.06, tail: 0.1 });
  const w = bump(t, o.back - 0.05, o.back + 0.05, o.wriggleEnd - 0.1, o.wriggleEnd);
  const wav = Math.sin((t - o.back) * 2 * Math.PI * 2.4);
  b.pelvis[2] += 0.12 * w * wav;
  b.spine = b.spine.map((s, i) => [s[0], s[1] + 0.07 * w * Math.sin((t - o.back) * 2 * Math.PI * 2.4 - i * 0.5), s[2] - 0.05 * w * wav] as V3);
  b.head[2] += o.rub * w * Math.sin((t - o.back) * 2 * Math.PI * 1.6); b.neck[1]![2] += 0.5 * o.rub * w * Math.sin((t - o.back) * 2 * Math.PI * 1.6);
  for (const id of LEGS) { b.legs[id].heel += 0.15 * w * Math.sin((t - o.back) * 9 + LEGS.indexOf(id)); }
  return b;
}

/** Lean in and rub cheek, side of the head, then the flank along an object at the cat's left; tail up. */
function headRub(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx);
  const tailUp = tailShape({ base: 1.15, lift: 0.35, tip: 0.75 });
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

/** Tail-up greeting: tail rises vertical with a tip curl, chin up, forward rock and a little tread in place. */
function greeting(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx);
  const up = cloneBody(stand); setTrunk(ctx.rig, up, { pelvisDrop: 0.02 * M.shoulderH, chestDrop: 0.0, surge: 0.022 * k });
  up.gaze = [0.22, 0, 0, 1]; up.tail = tailShape({ base: 1.2, lift: 0.3, tip: 0.8 }); up.earL = [-0.1, -0.05, 0.12]; up.earR = [-0.1, -0.05, 0.12];
  const hold = cloneBody(up); setTrunk(ctx.rig, hold, { pelvisDrop: 0.03 * M.shoulderH, chestDrop: 0.02 * M.shoulderH, surge: 0.01 * k }); hold.gaze = [0.14, 0.05, 0, 1];
  const b = keyedLag(t, [[0, stand], [0.45, up], [1.0, hold], [1.5, hold]], { head: 0.05, tail: 0.16, ears: 0.05 });
  for (const [id, t0, t1] of [['LF', 0.28, 0.46], ['RF', 0.58, 0.76]] as const) {
    if (t > t0 && t < t1) { const s = (t - t0) / (t1 - t0), L = b.legs[id]; L.toe = [L.toe[0], L.toe[1] + 0.04 * k * Math.sin(Math.PI * s) ** 0.8, L.toe[2] + 0.01 * k * Math.sin(Math.PI * s)]; L.heel += 0.7 * Math.sin(Math.PI * s); L.toeP = 0.8 * Math.sin(Math.PI * s); }
  }
  b.gaze[0] += 0.04 * bump(t, 0.25, 0.32, 0.4, 0.5);
  return b;
}

/** Hiss: drawn back on the hind legs, back arched, ears flattened sideways, mouth wide. */
function hiss(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx);
  const back = cloneBody(stand); setTrunk(ctx.rig, back, { pelvisDrop: 0.14 * M.shoulderH, chestDrop: 0.02 * M.shoulderH, surge: -0.035 * k, arch: 0.32 });
  back.gaze = [-0.12, 0, 0, 1]; back.earL = [0.75, 0.85, -0.1]; back.earR = [0.75, 0.85, -0.1]; back.whisk = -0.4;
  back.tail = tailShape({ base: -0.15, lift: -0.9, tip: 0.2 });
  for (const id of ['LF', 'RF'] as const) back.legs[id].flex = 1;
  const lunge = cloneBody(back); setTrunk(ctx.rig, lunge, { pelvisDrop: 0.12 * M.shoulderH, chestDrop: 0.05 * M.shoulderH, surge: -0.015 * k, arch: 0.28 }); lunge.gaze = [-0.2, 0, 0, 1];
  const b = keyedLag(t, [[0, stand], [0.18, back, (x) => 1 - (1 - x) ** 3], [0.3, lunge], [0.45, back], [0.95, back], [1.2, mixBody(back, stand, 0.35)]], { head: 0.03, tail: 0.08, ears: 0.02 });
  b.jaw = 0.62 * curve([[0, 0], [0.15, 0.1], [0.24, 1], [0.85, 0.9], [1.05, 0.25], [1.2, 0.15]])(t);
  b.gaze[0] += 0.02 * Math.sin(t * 40) * bump(t, 0.25, 0.3, 0.8, 0.9);
  return b;
}

/** Startle: sudden crouch and recoil, freeze, assess. */
function flinch(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx);
  const duck = cloneBody(stand); setTrunk(ctx.rig, duck, { pelvisDrop: 0.15 * M.shoulderH, chestDrop: 0.2 * M.shoulderH, surge: -0.04 * k, arch: 0.12 });
  duck.gaze = [-0.05, 0.05, 0, 1]; duck.neck = [[-0.15, 0, 0], [-0.1, 0, 0]]; duck.earL = [0.5, 0.25, 0]; duck.earR = [0.35, 0.2, 0];
  duck.tail = tailShape({ base: -0.75, lift: -0.3, tip: 0.1 }); duck.whisk = -0.2;
  const assess = cloneBody(duck); setTrunk(ctx.rig, assess, { pelvisDrop: 0.12 * M.shoulderH, chestDrop: 0.14 * M.shoulderH, surge: -0.03 * k, arch: 0.08 });
  assess.gaze = [0.05, -0.1, 0, 1]; assess.neck = [[0, 0, 0], [0, 0, 0]]; assess.earL = [-0.1, 0, 0.1]; assess.earR = [-0.05, 0, 0.1]; assess.whisk = 0.2;
  const b = keyedLag(t, [[0, stand], [0.09, duck, x => 1 - (1 - x) ** 4], [0.45, duck], [0.7, assess]], { head: 0.02, tail: 0.05, ears: 0.0 });
  b.pelvisOff[1] += 0.008 * k * ring(t, 0.09, 6, 0.08);
  return b;
}

/** Swat: a fast single right-forepaw strike toward the hand, claws out, then pull back; ears back. */
function swat(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, stand = idlePose(ctx);
  const set = cloneBody(stand); setTrunk(ctx.rig, set, { pelvisDrop: 0.08 * M.shoulderH, chestDrop: 0.04 * M.shoulderH, surge: -0.02 * k, lateral: 0.008 * k, roll: 0.05 });
  set.earL = [0.7, 0.4, -0.05]; set.earR = [0.7, 0.4, -0.05]; set.gaze = [0.12, -0.05, 0, 1]; set.tail = tailShape({ base: -0.4, lift: -0.2, tip: 0.3, side: 0.3 });
  const b = keyedLag(t, [[0, stand], [0.1, set], [0.45, set], [0.6, mixBody(set, stand, 0.5)]], { head: 0.02, tail: 0.06 });
  b.earL = [...set.earL]; b.earR = [...set.earR];
  const L = b.legs.RF, home = stand.legs.RF.toe;
  const pts: V3[] = [home, [home[0] * 0.7, 0.18 * k, home[2] - 0.01 * k], [home[0] * 0.5, 0.36 * k, home[2] + 0.17 * k], [home[0] * 0.8, 0.12 * k, home[2] + 0.03 * k], home];
  const times = [0, 0.11, 0.25, 0.42, 0.58];
  const tt = Math.min(Math.max(t, 0), 0.58);
  let seg = 0; while (seg < times.length - 2 && tt > times[seg + 1]!) seg++;
  const raw = (tt - times[seg]!) / (times[seg + 1]! - times[seg]!), u = seg === 1 ? raw * raw * (3 - 2 * raw) ** 0.5 : smooth(raw);
  const a = pts[seg]!, c = pts[seg + 1]!;
  L.toe = [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u];
  const up = bump(t, 0.02, 0.1, 0.45, 0.58), strike = bump(t, 0.18, 0.23, 0.27, 0.34);
  L.heel += 0.9 * up - 0.7 * strike; L.toeP = 1.0 * up - 1.1 * strike; L.curl = -0.45 * strike + 0.2 * up; L.spread = 0.25 * strike; L.share = 0.6;
  b.gaze[0] += 0.05 * strike;
  return b;
}

export const playClips: ClipSpec[] = [
  { name: 'cat.play.bat_left', body: batLeft, stance: ctx => stanceFromAir(ctx.T, { LF: [[0.02, 0.5]] }) },
  { name: 'cat.play.bat_right', body: (t, ctx) => mirrorBody(batLeft(t, ctx)), stance: ctx => stanceFromAir(ctx.T, { RF: [[0.02, 0.5]] }) },
  {
    name: 'cat.play.roll_over', body: (t, ctx) => rollOver(t, ctx, { drop: 0.45, back: 0.8, wriggleEnd: 1.4, T: 2.0, rub: 0.25 }),
    tailSim: { wBase: 24, wTip: 11, zeta: 0.6 }, stance: () => ({ LF: [[0, 0.08]], RF: [[0, 0.08]], LH: [[0, 0.12]], RH: [[0, 0.12]] }),
  },
  { name: 'cat.social.head_rub', body: headRub, tailSim: { wBase: 26, wTip: 12, zeta: 0.65 }, stance: allPlanted },
  {
    name: 'cat.social.tail_up_greeting', body: greeting, tailSim: { wBase: 26, wTip: 12, zeta: 0.65 },
    stance: ctx => stanceFromAir(ctx.T, { LF: [[0.28, 0.46]], RF: [[0.58, 0.76]] }),
  },
  {
    name: 'cat.social.slow_blink',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: t => {
        const d = curve([[0, 0], [0.25, 0.25], [0.7, 1], [1.2, 1], [1.6, 0.2], [1.8, 0]])(t);
        return { neck_02: qBody(-0.04 * d, 0, 0), head: qBody(-0.07 * d, 0, 0.02 * d) };
      },
    },
  },
  { name: 'cat.react.hiss', body: hiss, tailSim: { wBase: 30, wTip: 14, zeta: 0.75 }, stance: allPlanted },
  { name: 'cat.react.flinch_startle', body: flinch, tailSim: { wBase: 30, wTip: 14, zeta: 0.6 }, stance: allPlanted },
  { name: 'cat.react.swat', body: swat, tailSim: { wBase: 30, wTip: 14, zeta: 0.6 }, stance: ctx => stanceFromAir(ctx.T, { RF: [[0.02, 0.56]] }) },
];

void keyed; void pulse; void addBreath; export type { LegId };
