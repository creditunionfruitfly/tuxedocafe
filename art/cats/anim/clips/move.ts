// Jumps (root motion with catalogued height), landing and the pounce.
import type { ClipSpec, Ctx, Terrain } from '../catalog.ts';
import { type Body, type Leg, cloneBody, partFrame, toWorld } from '../body.ts';
import { type V3, bump, clamp, curve, lerp, pulse, smooth, smoother } from '../math.ts';
import type { LegId } from '../rig.ts';
import { flatHeel, keyedLag, setTrunk, stanceFromAir, step, tailShape } from '../poses.ts';
import { idlePose } from './rest.ts';

const G = 9.81;

/** Root-motion helper: bodies are keyed with world pelvis offsets; the root is subtracted afterwards. */
function placeRoot(b: Body, root: V3) {
  b.rootPos = [...root];
  b.pelvisOff = [b.pelvisOff[0] - root[0], b.pelvisOff[1] - root[1], b.pelvisOff[2] - root[2]];
  return b;
}
const shifted = (b: Body, d: V3) => { const c = cloneBody(b); c.pelvisOff = [c.pelvisOff[0] + d[0], c.pelvisOff[1] + d[1], c.pelvisOff[2] + d[2]]; return c; };

/** Body-relative airborne paw point (chest for fronts, pelvis for hinds). */
function airPoint(ctx: Ctx, b: Body, id: LegId, local: V3): V3 {
  const k = ctx.M.legScale, d = ctx.rig.legs[id];
  return toWorld(partFrame(ctx.rig, b, d.front ? 'spine_04' : 'pelvis'), [d.side * Math.abs(local[0]) * k, local[1] * k, local[2] * k]);
}

/** Piecewise airborne path through body-relative waypoints, then to a world landing spot. */
function flightLeg(ctx: Ctx, b: Body, L: Leg, id: LegId, s: number, from: V3, way: V3[], to: V3) {
  const pts = [from, ...way.map(w => airPoint(ctx, b, id, w)), to];
  const seg = Math.min(pts.length - 2, Math.floor(s * (pts.length - 1))), u = s * (pts.length - 1) - seg;
  const a = pts[seg]!, c = pts[seg + 1]!, e = smooth(u);
  L.toe = [lerp(a[0], c[0], e), lerp(a[1], c[1], e), lerp(a[2], c[2], e)];
  const f = Math.sin(Math.PI * s);
  L.heel = ctx.rig.legs[id].stanceHeel + (ctx.rig.legs[id].front ? 0.9 : 0.6) * f; L.toeP = 1.0 * f; L.curl = 0.15 * f;
}

interface JumpUp { H: number; tk: number; tc: number; thl: number; gap: number; crouch: number; frontLand: number; scrabble: boolean }

function jumpUp(t: number, ctx: Ctx, o: JumpUp): Body {
  const M = ctx.M, k = M.legScale, rig = ctx.rig, sH = M.shoulderH, T = ctx.T;
  const stand = idlePose(ctx);
  const fz = stand.legs.LF.toe[2], hz = stand.legs.LH.toe[2];
  const edge = fz + o.gap * k, D = edge + 0.05 * k - hz, R: V3 = [0, o.H, D];
  const crouch = cloneBody(stand);
  setTrunk(rig, crouch, { pelvisDrop: o.crouch * sH, chestDrop: o.crouch * 0.55 * sH, surge: -0.03 * k });
  for (const id of ['LH', 'RH'] as const) { crouch.legs[id].heel = (crouch.legs[id].heel + flatHeel(rig, id)) * 0.5; crouch.legs[id].flex = 0.55; crouch.legs[id].comfort = 0.5; }
  for (const id of ['LF', 'RF'] as const) crouch.legs[id].flex = 0.8;
  crouch.gaze = [0.32 + 0.12 * Number(o.scrabble), 0, 0, 1];
  crouch.tail = tailShape({ base: -0.4, lift: -0.1, tip: 0.4 });
  const push = cloneBody(stand);
  setTrunk(rig, push, { pelvisDrop: -0.06 * sH, chestDrop: -0.3 * sH, surge: 0.06 * k });
  push.gaze = [0.25, 0, 0, 1]; push.tail = tailShape({ base: -0.2, lift: -0.15, tip: 0.2 });
  for (const id of ['LH', 'RH'] as const) push.legs[id].flex = 1;
  const top = shifted(stand, R), reach = shifted(stand, [0, o.H - 0.12 * sH, D - 0.12 * k]);
  setTrunk(rig, reach, { pelvisDrop: 0.14 * sH, chestDrop: -0.05 * sH }); reach.pelvisOff = [0, reach.pelvisOff[1] + o.H, reach.pelvisOff[2] + D - 0.1 * k];
  reach.gaze = [0, 0, 0, 1]; reach.tail = tailShape({ base: 0.1, lift: 0.2, tip: 0.2 });
  const absorb = shifted(stand, R); setTrunk(rig, absorb, { pelvisDrop: 0.08 * sH, chestDrop: 0.12 * sH }); absorb.pelvisOff = [0, absorb.pelvisOff[1] + o.H, absorb.pelvisOff[2] + D];
  const b = keyedLag(t, [[0, stand], [o.tk * 0.7, crouch], [o.tk - 0.04, crouch], [o.tk, push, smooth], [o.tc, reach], [o.thl, absorb], [T, top]], { head: 0.04, tail: 0.1 });
  if (o.scrabble) b.tail = b.tail.map((s, i) => [s[0], s[1] + 0.25 * smooth((i - 6) / 5) * Math.sin(t * 20) * bump(t, 0.1, 0.2, 0.45, 0.55), s[2]] as V3);
  // Measuring the target: two small nods of the head during the long crouch.
  if (o.scrabble) b.gaze[0] += 0.06 * Math.sin(Math.PI * clamp((t - 0.15) / 0.2, 0, 2)) * bump(t, 0.1, 0.15, 0.5, 0.55);
  // Ballistic flight of the pelvis between push-off and contact.
  if (t > o.tk && t < o.tc) {
    const p0 = push.pelvisOff, p1 = reach.pelvisOff, tau = o.tc - o.tk, s = t - o.tk;
    const vy = (p1[1] - p0[1] + 0.5 * G * tau * tau) / tau;
    b.pelvisOff = [0, p0[1] + vy * s - 0.5 * G * s * s, lerp(p0[2], p1[2], s / tau)];
  }
  const ramp = smoother((t - (o.tk - 0.04)) / (o.thl - o.tk + 0.04));
  placeRoot(b, [0, o.H * ramp, D * ramp]);
  // Paws.
  const frontLand = (id: LegId): V3 => [stand.legs[id].toe[0], o.H + rig.legs[id].padY, fz + D - o.frontLand * k];
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id], off = o.tk - 0.06 - (id === 'RF' ? 0.02 : 0), land = o.tc + (id === 'RF' ? 0.02 : 0), last: V3 = [stand.legs[id].toe[0], o.H + rig.legs[id].padY, fz + D];
    if (t <= off) L.toe = [...stand.legs[id].toe];
    else if (t < land) flightLeg(ctx, b, L, id, (t - off) / (land - off), stand.legs[id].toe, [[0.04, -0.12, 0.05], [0.05, -0.16, 0.2]], frontLand(id));
    else if (o.frontLand > 0.001) {
      const t0 = T - 0.2 + (id === 'RF' ? 0.06 : 0), t1 = Math.min(T, t0 + 0.14);
      const st = step(t, t0, t1, frontLand(id), last, 0.04 * sH);
      L.toe = st.pos; if (st.air) { const f = Math.sin(Math.PI * st.s); L.heel += 0.7 * f; L.toeP = 0.9 * f; }
    } else L.toe = frontLand(id);
  }
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id], land: V3 = [stand.legs[id].toe[0], o.H + rig.legs[id].padY, hz + D], tl = o.thl - (id === 'LH' ? 0.02 : 0);
    if (t <= o.tk) continue;
    if (o.scrabble && t > o.tc && t < tl) {
      // Hind paws scrabble up the vertical face, then hook over the top.
      const u = (t - o.tc) / (tl - o.tc), face = edge - 0.012 * k;
      const y = o.H - (0.24 - 0.2 * u) * sH + 0.03 * sH * Math.abs(Math.sin(u * Math.PI * 3 + (id === 'LH' ? 0 : 1)));
      L.toe = u < 0.75 ? [land[0], y, face] : [land[0], lerp(y, land[1], smooth((u - 0.75) / 0.25)), lerp(face, land[2], smooth((u - 0.75) / 0.25))];
      L.heel = rig.legs[id].stanceHeel + 0.5; L.toeP = -0.2; L.curl = -0.3;
    } else if (t < tl) flightLeg(ctx, b, L, id, (t - o.tk) / (tl - o.tk), stand.legs[id].toe, [[0.05, -0.16, -0.14], [0.05, -0.14, 0.05]], land);
    else L.toe = land;
  }
  return b;
}

interface JumpDown { H: number; tl: number; push: number; lean: number; reach: number }

function jumpDown(t: number, ctx: Ctx, o: JumpDown): Body {
  const M = ctx.M, k = M.legScale, rig = ctx.rig, sH = M.shoulderH, T = ctx.T;
  const stand = idlePose(ctx);
  const fz = stand.legs.LF.toe[2], hz = stand.legs.LH.toe[2];
  const edge = fz + 0.02 * k, D = edge + 0.07 * k - hz, R: V3 = [0, o.H, D];
  const lean = cloneBody(stand);
  setTrunk(rig, lean, { pelvisDrop: 0.18 * sH, chestDrop: (0.2 + o.lean) * sH, surge: 0.05 * k });
  lean.gaze = [-0.55, 0, 0, 1]; lean.tail = tailShape({ base: 0.1, lift: 0.1, tip: 0.3 });
  for (const id of ['LH', 'RH'] as const) { lean.legs[id].flex = 0.65; lean.legs[id].comfort = 0.5; }
  const fly = shifted(stand, [0, o.H * 0.35, D * 0.55]); setTrunk(rig, fly, { pelvisDrop: -0.05 * sH, chestDrop: 0.25 * sH });
  fly.pelvisOff = [0, fly.pelvisOff[1] + o.H * 0.35, fly.pelvisOff[2] + D * 0.55]; fly.gaze = [-0.35, 0, 0, 1]; fly.tail = tailShape({ base: 0.35, lift: 0.3, tip: 0.2 });
  const absorb = cloneBody(stand); setTrunk(rig, absorb, { pelvisDrop: 0.05 * sH, chestDrop: (0.3 + 0.15 * Number(o.H < -1)) * sH });
  absorb.pelvisOff = [0, absorb.pelvisOff[1] + o.H, absorb.pelvisOff[2] + D]; absorb.gaze = [-0.2, 0, 0, 1];
  for (const id of ['LF', 'RF'] as const) { absorb.legs[id].flex = 0.6; absorb.legs[id].comfort = 1.2; }
  const done = shifted(stand, R);
  const b = keyedLag(t, [[0, stand], [o.push - 0.08, lean], [o.push, lean], [o.tl, fly], [o.tl + 0.12, absorb], [T, done]], { head: 0.04, tail: 0.1 });
  if (t > o.push && t < o.tl) {
    const p0 = lean.pelvisOff, p1 = [0, stand.pelvisOff[1] + o.H + 0.04 * sH, stand.pelvisOff[2] + D - 0.03 * k], tau = o.tl - o.push, s = t - o.push;
    const vy = (p1[1]! - p0[1] + 0.5 * G * tau * tau) / tau;
    b.pelvisOff = [0, p0[1] + vy * s - 0.5 * G * s * s, lerp(p0[2], p1[2]!, smooth(s / tau))];
  }
  const ramp = smoother((t - o.push + 0.02) / (o.tl + 0.12 - o.push + 0.02));
  placeRoot(b, [0, o.H * ramp, D * ramp]);
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id], land: V3 = [stand.legs[id].toe[0], o.H + rig.legs[id].padY, fz + D], off = id === 'LF' ? 0.08 : o.push - 0.05;
    const tl = o.tl + (id === 'RF' ? 0.02 : 0);
    if (t <= off) continue;
    if (t < tl) flightLeg(ctx, b, L, id, (t - off) / (tl - off), stand.legs[id].toe, [[0.04, -0.22 - o.reach, 0.1], [0.04, -0.25 - o.reach, 0.12]], land);
    else L.toe = land;
  }
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id], land: V3 = [stand.legs[id].toe[0], o.H + rig.legs[id].padY, hz + D], tl = o.tl + 0.12 + (id === 'RH' ? 0.02 : 0);
    if (t <= o.push) continue;
    if (t < tl) flightLeg(ctx, b, L, id, (t - o.push) / (tl - o.push), stand.legs[id].toe, [[0.05, -0.12, -0.12], [0.05, -0.18, 0.0]], land);
    else L.toe = land;
  }
  return b;
}

const stepTerrain = (edgeAt: (ctx: Ctx) => number, H: number) => (ctx: Ctx): Terrain => {
  const e = edgeAt(ctx);
  return (_x, z) => (H > 0 ? (z >= e ? H : 0) : (z >= e ? H : 0));
};

/** Landing from a jump: forepaws first, chest dips, hind paws come down, recover. */
function land(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, sH = M.shoulderH, stand = idlePose(ctx);
  const air = cloneBody(stand); setTrunk(ctx.rig, air, { pelvisDrop: -0.1 * sH, chestDrop: 0.08 * sH });
  air.gaze = [-0.15, 0, 0, 1]; air.tail = tailShape({ base: 0.3, lift: 0.2, tip: 0.2 });
  const dip = cloneBody(stand); setTrunk(ctx.rig, dip, { pelvisDrop: 0.06 * sH, chestDrop: 0.24 * sH });
  for (const id of ['LF', 'RF'] as const) { dip.legs[id].flex = 0.65; dip.legs[id].comfort = 1.2; }
  const b = keyedLag(t, [[0, air], [0.13, dip, smooth], [0.3, stand], [0.5, stand]], { head: 0.03, tail: 0.08 });
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id], home = stand.legs[id].toe, tl = id === 'LH' ? 0.11 : 0.14;
    if (t < tl) { const s = t / tl; L.toe = [home[0], home[1] + 0.1 * k * (1 - s * s), home[2] - 0.05 * k * (1 - s)]; L.heel += 0.35 * (1 - s); L.toeP = 0.4 * (1 - s); }
  }
  b.gaze[0] += -0.08 * pulse(t, 0.02, 0.06, 0.08);
  return b;
}

/** Pounce: crouch, butt wiggle with treading hind paws, spring, pin with both forepaws. */
function pounce(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, sH = M.shoulderH, rig = ctx.rig, stand = idlePose(ctx);
  const Dp = 0.4 * k;
  const crouch = cloneBody(stand);
  setTrunk(rig, crouch, { pelvisDrop: 0.3 * sH, chestDrop: 0.36 * sH, surge: -0.02 * k });
  for (const id of ['LH', 'RH'] as const) { crouch.legs[id].heel = (crouch.legs[id].heel + flatHeel(rig, id)) * 0.55; crouch.legs[id].flex = 0.6; crouch.legs[id].comfort = 0.5; }
  for (const id of ['LF', 'RF'] as const) { crouch.legs[id].flex = 0.6; crouch.legs[id].abduct = 0.3; }
  crouch.gaze = [0, 0, 0, 1]; crouch.earL = [-0.1, 0, 0.12]; crouch.earR = [-0.1, 0, 0.12]; crouch.whisk = 0.35;
  crouch.tail = tailShape({ base: -0.55, lift: 0.1, tip: 0.2 });
  const wig = cloneBody(crouch); setTrunk(rig, wig, { pelvisDrop: 0.24 * sH, chestDrop: 0.37 * sH, surge: -0.02 * k });
  const spring = cloneBody(stand); setTrunk(rig, spring, { pelvisDrop: -0.02 * sH, chestDrop: -0.06 * sH, surge: 0.06 * k });
  spring.gaze = [-0.1, 0, 0, 1]; spring.tail = tailShape({ base: -0.1, lift: 0.1, tip: 0.2 }); spring.earL = crouch.earL; spring.earR = crouch.earR;
  const pin = shifted(crouch, [0, 0, Dp]); setTrunk(rig, pin, { pelvisDrop: 0.22 * sH, chestDrop: 0.34 * sH, arch: 0.15 });
  pin.pelvisOff[2] += Dp; pin.gaze = [-0.55, 0, 0, 1];
  for (const id of ['LF', 'RF'] as const) { pin.legs[id].flex = 0.8; pin.legs[id].share = 0.55; }
  const b = keyedLag(t, [[0, stand], [0.2, crouch], [0.42, wig], [0.5, spring, smooth], [0.6, shifted(spring, [0, 0, Dp * 0.75])], [0.75, pin], [1.2, pin]], { head: 0.03, tail: 0.08 });
  const wiggle = bump(t, 0.2, 0.25, 0.4, 0.45) * Math.sin((t - 0.2) * 2 * Math.PI * 4.5);
  b.pelvis[1] += 0.1 * wiggle; b.pelvis[2] += 0.06 * wiggle; b.pelvisOff[0] += 0.008 * k * wiggle;
  b.tail = b.tail.map((s, i) => [s[0], s[1] + 0.3 * smooth((i - 7) / 4) * Math.sin(t * 25) * bump(t, 0.1, 0.2, 0.45, 0.5), s[2]] as V3);
  const ramp = smoother((t - 0.45) / 0.27);
  placeRoot(b, [0, 0, Dp * ramp]);
  const fPin = (id: LegId): V3 => [rig.legs[id].side * 0.025 * k, rig.legs[id].padY, stand.legs.LF.toe[2] + Dp + 0.06 * k];
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id];
    if (t <= 0.46) continue;
    if (t < 0.6) flightLeg(ctx, b, L, id, (t - 0.46) / 0.14, stand.legs[id].toe, [[0.04, -0.15, 0.12]], fPin(id));
    else { L.toe = fPin(id); L.yaw = 0; L.out = -0.15; L.curl = 0.2 * bump(t, 0.6, 0.65, 0.9, 1.0); }
  }
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id], home = stand.legs[id].toe, landAt: V3 = [home[0], home[1], home[2] + Dp + 0.02 * k];
    const tread = id === 'LH' ? 0.24 : 0.32;
    if (t > tread && t < tread + 0.07) { const st = step(t, tread, tread + 0.07, home, home, 0.02 * k); L.toe = st.pos; }
    else if (t > tread + 0.1 && t < tread + 0.17) { const st = step(t, tread + 0.1, tread + 0.17, home, home, 0.02 * k); L.toe = st.pos; }
    if (t <= 0.5) continue;
    if (t < 0.7) flightLeg(ctx, b, L, id, (t - 0.5) / 0.2, home, [[0.05, -0.17, -0.12]], landAt);
    else L.toe = landAt;
  }
  return b;
}

const edgeUp = (gap: number) => (ctx: Ctx) => idlePose(ctx).legs.LF.toe[2] + gap * ctx.M.legScale;
const edgeDown = (ctx: Ctx) => idlePose(ctx).legs.LF.toe[2] + 0.02 * ctx.M.legScale;
const UP_LOW: JumpUp = { H: 0.45, tk: 0.35, tc: 0.65, thl: 0.76, gap: 0.12, crouch: 0.26, frontLand: 0.08, scrabble: false };
const UP_HIGH: JumpUp = { H: 1.2, tk: 0.6, tc: 0.95, thl: 1.12, gap: 0.16, crouch: 0.34, frontLand: 0.22, scrabble: true };
const DOWN_LOW: JumpDown = { H: -0.45, tl: 0.45, push: 0.3, lean: 0.12, reach: 0.0 };
const DOWN_HIGH: JumpDown = { H: -1.2, tl: 0.7, push: 0.4, lean: 0.25, reach: 0.12 };

export const moveClips: ClipSpec[] = [
  {
    name: 'cat.move.jump_up_low', body: (t, ctx) => jumpUp(t, ctx, UP_LOW), tailSim: { wBase: 28, wTip: 12, zeta: 0.7 },
    terrain: stepTerrain(edgeUp(UP_LOW.gap), UP_LOW.H),
    stance: () => ({ LF: [[0, 0.29], [0.65, 0.7], [0.84, 0.9]], RF: [[0, 0.27], [0.67, 0.76]], LH: [[0, 0.35], [0.74, 0.9]], RH: [[0, 0.35], [0.76, 0.9]] }),
  },
  {
    name: 'cat.move.jump_up_high', body: (t, ctx) => jumpUp(t, ctx, UP_HIGH), tailSim: { wBase: 28, wTip: 12, zeta: 0.7 },
    terrain: stepTerrain(edgeUp(UP_HIGH.gap), UP_HIGH.H),
    stance: () => ({ LF: [[0, 0.54], [0.95, 1.1], [1.24, 1.3]], RF: [[0, 0.52], [0.97, 1.16]], LH: [[0, 0.6], [1.1, 1.3]], RH: [[0, 0.6], [1.12, 1.3]] }),
  },
  {
    name: 'cat.move.jump_down_low', body: (t, ctx) => jumpDown(t, ctx, DOWN_LOW), tailSim: { wBase: 28, wTip: 12, zeta: 0.7 },
    terrain: stepTerrain(edgeDown, DOWN_LOW.H),
    stance: () => ({ LF: [[0, 0.08], [0.45, 0.8]], RF: [[0, 0.25], [0.47, 0.8]], LH: [[0, 0.3], [0.57, 0.8]], RH: [[0, 0.3], [0.59, 0.8]] }),
  },
  {
    name: 'cat.move.jump_down_high', body: (t, ctx) => jumpDown(t, ctx, DOWN_HIGH), tailSim: { wBase: 28, wTip: 12, zeta: 0.7 },
    terrain: stepTerrain(edgeDown, DOWN_HIGH.H),
    stance: () => ({ LF: [[0, 0.08], [0.7, 1.1]], RF: [[0, 0.35], [0.72, 1.1]], LH: [[0, 0.4], [0.82, 1.1]], RH: [[0, 0.4], [0.84, 1.1]] }),
  },
  {
    name: 'cat.move.land', body: land, tailSim: { wBase: 26, wTip: 11, zeta: 0.6 },
    stance: ctx => stanceFromAir(ctx.T, { LH: [[0, 0.11]], RH: [[0, 0.14]] }),
  },
  {
    name: 'cat.play.pounce', body: pounce, tailSim: { wBase: 28, wTip: 12, zeta: 0.65 },
    stance: () => ({ LF: [[0, 0.46], [0.6, 1.2]], RF: [[0, 0.46], [0.6, 1.2]], LH: [[0, 0.24], [0.31, 0.34], [0.41, 0.5], [0.7, 1.2]], RH: [[0, 0.32], [0.39, 0.42], [0.49, 0.5], [0.7, 1.2]] }),
  },
];

void curve;
