// Jumps (root motion with the catalogued height), landing and the pounce.
import type { ClipSpec, Ctx, Terrain } from '../catalog.ts';
import { type Body, type Leg, cloneBody, partFrame, toWorld } from '../body.ts';
import { type V3, bump, clamp, lerp, pulse, smooth, smoother } from '../math.ts';
import type { LegId } from '../rig.ts';
import { flatMeta, keyedLag, setTrunk, stepLeg, tailShape } from '../poses.ts';
import { idlePose } from './rest.ts';

const G = 9.81;

/** Root-motion helper: bodies are keyed with world pelvis offsets; the root is subtracted afterwards. */
function placeRoot(b: Body, root: V3) {
  b.rootPos = [...root];
  b.pelvisOff = [b.pelvisOff[0] - root[0], b.pelvisOff[1] - root[1], b.pelvisOff[2] - root[2]];
  return b;
}
export const shifted = (b: Body, d: V3) => { const c = cloneBody(b); c.pelvisOff = [c.pelvisOff[0] + d[0], c.pelvisOff[1] + d[1], c.pelvisOff[2] + d[2]]; return c; };

/** Body-relative airborne paw point (chest for fronts, pelvis for hinds; x is mirrored per side). */
export function airPoint(ctx: Ctx, b: Body, id: LegId, local: V3): V3 {
  const k = ctx.M.legScale, d = ctx.rig.legs[id];
  return toWorld(partFrame(ctx.rig, b, d.front ? 'spine_04' : 'pelvis'), [d.side * Math.abs(local[0]) * k, local[1] * k, local[2] * k]);
}

/**
 * Airborne paw from a planted spot through body-relative waypoints to a world landing spot. The carpus / hock folds
 * in the air and opens to reach for the landing; distal angles go free after liftoff and planted before contact.
 */
export function flightLeg(ctx: Ctx, b: Body, L: Leg, id: LegId, s: number, from: V3, way: V3[], to: V3, reach = 0.3) {
  const pts = [from, ...way.map(w => airPoint(ctx, b, id, w)), to];
  const seg = Math.min(pts.length - 2, Math.floor(s * (pts.length - 1))), u = s * (pts.length - 1) - seg;
  const a = pts[seg]!, c = pts[seg + 1]!, e = smooth(u);
  L.toe = [lerp(a[0], c[0], e), lerp(a[1], c[1], e), lerp(a[2], c[2], e)];
  const d = ctx.rig.legs[id], f = Math.sin(Math.PI * s);
  L.rel = smooth(s / 0.15) * (1 - smooth((s - 0.62) / 0.36));
  L.carpus = d.flexScale * ((d.front ? 1.6 : 1.4) * f * (1 - reach * smooth((s - 0.5) / 0.4))) + (d.front ? -0.2 : 0.8) * (1 - f);
  L.digits = d.dRest * (1 - f) + 0.1 * f; L.curl = 0.15 * f;
}

interface JumpUp { H: number; tk: number; tc: number; thl: number; gap: number; crouch: number; frontLand: number; scrabble: boolean }

function jumpUp(t: number, ctx: Ctx, o: JumpUp): Body {
  const M = ctx.M, k = M.legScale, rig = ctx.rig, sH = M.shoulderH, T = ctx.T;
  const stand = idlePose(ctx);
  const fz = stand.legs.LF.toe[2], hz = stand.legs.LH.toe[2];
  const edge = fz + o.gap * k, D = edge + 0.05 * k - hz, R: V3 = [0, o.H, D];
  // Gather: crouch low on folded hocks, head up measuring the target.
  const crouch = cloneBody(stand);
  setTrunk(rig, crouch, { pelvisDrop: o.crouch * sH, chestDrop: o.crouch * 0.55 * sH, surge: -0.03 * k });
  for (const id of ['LH', 'RH'] as const) crouch.legs[id].meta = lerp(rig.legs[id].stanceMeta, flatMeta(rig, id), 0.45);
  crouch.gaze = [0.32 + 0.12 * Number(o.scrabble), 0, 0, 1];
  crouch.tail = tailShape({ base: -0.4, lift: -0.1, tip: 0.4 });
  // Push: hind legs extend explosively, chest rises.
  const push = cloneBody(stand);
  setTrunk(rig, push, { pelvisDrop: -0.06 * sH, chestDrop: -0.3 * sH, surge: 0.06 * k });
  push.gaze = [0.25, 0, 0, 1]; push.tail = tailShape({ base: -0.2, lift: -0.15, tip: 0.2 });
  const top = shifted(stand, R);
  const reach = cloneBody(stand);
  // Contact: forepaws reach the top with the chest no higher than standing; the rump is still below the edge.
  setTrunk(rig, reach, { pelvisDrop: 0.24 * sH, chestDrop: 0.1 * sH });
  reach.pelvisOff = [0, reach.pelvisOff[1] + o.H, reach.pelvisOff[2] + D - 0.1 * k];
  reach.gaze = [0, 0, 0, 1]; reach.tail = tailShape({ base: 0.1, lift: 0.2, tip: 0.2 });
  const absorb = cloneBody(stand); setTrunk(rig, absorb, { pelvisDrop: 0.08 * sH, chestDrop: 0.12 * sH }); absorb.pelvisOff = [0, absorb.pelvisOff[1] + o.H, absorb.pelvisOff[2] + D];
  const b = keyedLag(t, [[0, stand], [o.tk * 0.7, crouch], [o.tk - 0.04, crouch], [o.tk, push, smooth], [o.tc, reach], [o.thl, absorb], [T, top]], { head: 0.04, tail: 0.1 });
  // Long crouch: the tail tip twitches and the head bobs twice, measuring the target.
  if (o.scrabble) {
    b.tail = b.tail.map((s, i) => [s[0], s[1] + 0.25 * smooth((i - 6) / 5) * Math.sin(t * 20) * bump(t, 0.1, 0.2, 0.45, 0.55), s[2]] as V3);
    b.gaze[0] += 0.06 * Math.sin(Math.PI * clamp((t - 0.15) / 0.2, 0, 2)) * bump(t, 0.1, 0.15, 0.5, 0.55);
  }
  // Ballistic flight of the pelvis between push-off and contact.
  if (t > o.tk && t < o.tc) {
    const p0 = push.pelvisOff, p1 = reach.pelvisOff, tau = o.tc - o.tk, s = t - o.tk;
    const vy = (p1[1] - p0[1] + 0.5 * G * tau * tau) / tau;
    // Up first, then forward over the edge: horizontal progress lags the climb.
    b.pelvisOff = [0, p0[1] + vy * s - 0.5 * G * s * s, lerp(p0[2], p1[2], Math.pow(s / tau, 2.4))];
  }
  const ramp = smoother((t - (o.tk - 0.04)) / (o.thl - o.tk + 0.04));
  placeRoot(b, [0, o.H * ramp, D * ramp]);
  // Paws.
  const frontLand = (id: LegId): V3 => [stand.legs[id].toe[0], o.H + rig.legs[id].padY, fz + D - o.frontLand * k];
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id], off = o.tk - 0.06 - (id === 'RF' ? 0.02 : 0), land = o.tc + (id === 'RF' ? 0.02 : 0), last: V3 = [stand.legs[id].toe[0], o.H + rig.legs[id].padY, fz + D];
    if (t <= off) L.toe = [...stand.legs[id].toe];
    else if (t < land) {
      const s = (t - off) / (land - off);
      flightLeg(ctx, b, L, id, s, stand.legs[id].toe, [[0.035, -0.11, 0.06], [0.04, -0.16, 0.2]], frontLand(id));
      // Reach above the rim before advancing over it; floor correction must
      // never teleport a below-ledge paw onto the upper surface.
      const points = [stand.legs[id].toe, airPoint(ctx, b, id, [0.035, -0.11, 0.06]),
        [stand.legs[id].toe[0], o.H + 0.11 * k, edge - 0.02 * k] as V3, frontLand(id)];
      const seg = Math.min(2, Math.floor(s * 3)), w = smooth(s * 3 - seg), a = points[seg]!, c = points[seg + 1]!;
      L.toe = [lerp(a[0], c[0], w), lerp(a[1], c[1], w), lerp(a[2], c[2], w)];
    }
    else if (o.frontLand > 0.001) {
      const t0 = T - 0.2 + (id === 'RF' ? 0.06 : 0), t1 = Math.min(T, t0 + 0.14);
      if (t < t0) L.toe = frontLand(id); else stepLeg(rig, L, id, t, t0, t1, frontLand(id), last, 0.04 * sH, 1.0);
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
      L.rel = 1; L.carpus = 0.9; L.digits = 0.3; L.curl = -0.3;
    } else if (t < tl) {
      const s = (t - o.tk) / (tl - o.tk);
      flightLeg(ctx, b, L, id, s, stand.legs[id].toe, [[0.05, -0.15, -0.13], [0.05, -0.13, 0.05]], land);
      if (o.scrabble) {
        // Keep the hind paw behind and below the climbing hip. The old equal
        // thirds path passed the toe through its own hip at mid-flight, which
        // forced the thigh to reverse before the paw reached the ledge.
        const tucked = airPoint(ctx, b, id, [0.05, -0.24, -0.16]);
        const face: V3 = [land[0], o.H - 0.24 * sH, edge - 0.012 * k];
        const catchUp = smooth((t - o.tk - 0.18) / (o.tc - o.tk - 0.18));
        const u = smooth((t - o.tk) / 0.13), from = stand.legs[id].toe;
        L.toe = [0, 1, 2].map(j => lerp(lerp(from[j]!, tucked[j]!, u), face[j]!, catchUp)) as V3;
      } else {
        const pts = [stand.legs[id].toe, airPoint(ctx, b, id, [0.05, -0.15, -0.22]),
          [land[0], o.H + 0.04 * k, edge - 0.02 * k] as V3, land];
        const seg = Math.min(2, Math.floor(s * 3)), w = smooth(s * 3 - seg), a = pts[seg]!, c = pts[seg + 1]!;
        L.toe = [lerp(a[0], c[0], w), lerp(a[1], c[1], w), lerp(a[2], c[2], w)];
      }
    }
    else L.toe = land;
  }
  return b;
}

interface JumpDown { H: number; tl: number; push: number; lean: number; reach: number; out: number }

function jumpDown(t: number, ctx: Ctx, o: JumpDown): Body {
  const M = ctx.M, k = M.legScale, rig = ctx.rig, sH = M.shoulderH, T = ctx.T;
  const stand = idlePose(ctx);
  const fz = stand.legs.LF.toe[2], hz = stand.legs.LH.toe[2];
  const edge = fz + 0.02 * k, D = edge + o.out * k - hz, R: V3 = [0, o.H, D];
  // Lean out over the edge, forelegs reaching down before the push.
  const lean = cloneBody(stand);
  setTrunk(rig, lean, { pelvisDrop: 0.16 * sH, chestDrop: (0.18 + o.lean) * sH, surge: 0.05 * k });
  lean.gaze = [-0.55, 0, 0, 1]; lean.tail = tailShape({ base: 0.35, lift: 0.2, tip: 0.3 });
  // Touchdown of the forepaws: the ballistic path ends here, nose down, rump still high.
  const fly = cloneBody(stand); setTrunk(rig, fly, { pelvisDrop: -0.06 * sH, chestDrop: 0.2 * sH });
  fly.pelvisOff = [0, stand.pelvisOff[1] + o.H + 0.24 * sH, stand.pelvisOff[2] + D - 0.03 * k];
  fly.gaze = [-0.35, 0, 0, 1]; fly.tail = tailShape({ base: 1.3, lift: 0.3, tip: 0.2 });
  // Front paws first, deep absorption (deeper from high), then the hind paws.
  const absorb = cloneBody(stand); setTrunk(rig, absorb, { pelvisDrop: 0.05 * sH, chestDrop: (0.26 + 0.12 * Number(o.H < -1)) * sH });
  absorb.pelvisOff = [0, absorb.pelvisOff[1] + o.H, absorb.pelvisOff[2] + D]; absorb.gaze = [-0.2, 0, 0, 1];
  absorb.tail = tailShape({ base: 1.35, lift: 0.2, tip: 0.35 });
  for (const id of ['LF', 'RF'] as const) { absorb.legs[id].fore = 0.35; absorb.legs[id].abduct = 0.2; }
  const done = shifted(stand, R);
  // Keep the counterbalancing tail elevated through landing: the tip clears the rear ledge
  // after the hind paws, so returning to its low idle carriage here would strike the edge.
  done.tail = tailShape({ base: 1.3, lift: 0.2, tip: 0.3 });
  const b = keyedLag(t, [[0, stand], [o.push * 0.75, lean], [o.push, lean], [o.tl, fly], [o.tl + 0.12, absorb], [T, done]], { head: 0.04, tail: 0.1 });
  if (t > o.push && t < o.tl) {
    const p0 = lean.pelvisOff, p1 = fly.pelvisOff, tau = o.tl - o.push, s = t - o.push;
    const vy = (p1[1]! - p0[1] + 0.5 * G * tau * tau) / tau;
    // Out over the edge first (fast early horizontal progress), then the fall.
    b.pelvisOff = [0, p0[1] + vy * s - 0.5 * G * s * s, lerp(p0[2], p1[2]!, 1 - Math.pow(1 - s / tau, 2.5))];
  }
  const ramp = smoother((t - o.push + 0.02) / (o.tl + 0.12 - o.push + 0.02));
  placeRoot(b, [0, o.H * ramp, D * ramp]);
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id], land: V3 = [stand.legs[id].toe[0], o.H + rig.legs[id].padY, fz + D], off = id === 'LF' ? 0.35 * o.push : 0.75 * o.push;
    const tl = o.tl + (id === 'RF' ? 0.02 : 0);
    if (t <= off) continue;
    if (t < tl) {
      const s = (t - off) / (tl - off);
      flightLeg(ctx, b, L, id, s, stand.legs[id].toe, [[0.035, -0.2 - o.reach, 0.1], [0.035, -0.23 - o.reach, 0.12]], land, 0.6);
      // Carry the forepaw beyond the old edge before reaching down.
      const pts = [stand.legs[id].toe, [stand.legs[id].toe[0], 0.035 * k, edge + 0.08 * k] as V3,
        airPoint(ctx, b, id, [0.035, -0.23 - o.reach, 0.12]), land];
      const seg = Math.min(2, Math.floor(s * 3)), w = smooth(s * 3 - seg), a = pts[seg]!, c = pts[seg + 1]!;
      L.toe = [lerp(a[0], c[0], w), lerp(a[1], c[1], w), lerp(a[2], c[2], w)];
    }
    else L.toe = land;
  }
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id], land: V3 = [stand.legs[id].toe[0], o.H + rig.legs[id].padY, hz + D], tl = o.tl + 0.12 + (id === 'RH' ? 0.02 : 0);
    if (t <= o.push) continue;
    if (t < tl) flightLeg(ctx, b, L, id, (t - o.push) / (tl - o.push), stand.legs[id].toe, [[0.05, -0.12, -0.12], [0.05, -0.17, 0.0]], land);
    else L.toe = land;
  }
  return b;
}

const stepTerrain = (edgeAt: (ctx: Ctx) => number, H: number) => (ctx: Ctx): Terrain => {
  const e = edgeAt(ctx);
  return (_x, z) => (z >= e ? H : 0);
};

/** Landing from a jump: forepaws already down, chest dips, hind paws come down, recover to stand. */
function land(t: number, ctx: Ctx): Body {
  const M = ctx.M, k = M.legScale, sH = M.shoulderH, stand = idlePose(ctx);
  const air = cloneBody(stand); setTrunk(ctx.rig, air, { pelvisDrop: -0.1 * sH, chestDrop: 0.08 * sH });
  air.gaze = [-0.15, 0, 0, 1]; air.tail = tailShape({ base: 0.3, lift: 0.2, tip: 0.2 });
  const dip = cloneBody(stand); setTrunk(ctx.rig, dip, { pelvisDrop: 0.06 * sH, chestDrop: 0.22 * sH });
  for (const id of ['LF', 'RF'] as const) { dip.legs[id].fore = 0.3; dip.legs[id].abduct = 0.2; }
  const b = keyedLag(t, [[0, air], [0.13, dip, smooth], [0.3, stand], [0.5, stand]], { head: 0.03, tail: 0.08 });
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id], home = stand.legs[id].toe, tl = id === 'LH' ? 0.11 : 0.14;
    if (t < tl) {
      const s = t / tl, d = ctx.rig.legs[id];
      L.toe = [home[0], home[1] + 0.1 * k * (1 - s * s), home[2] - 0.05 * k * (1 - s)];
      L.rel = 1 - smooth(s); L.carpus = d.flexScale * 1.0 * (1 - s) + 0.8 * s; L.digits = d.dRest;
    }
  }
  b.gaze[0] += -0.08 * pulse(t, 0.02, 0.06, 0.08);
  return b;
}

/** Pounce: crouch, butt wiggle with treading hind paws, spring, pin with both forepaws. */
export function pounce(t: number, ctx: Ctx, o: { Dp: number; tCrouch: number; tWig: [number, number]; tSpring: number; tPin: number; tread?: boolean } = { Dp: 0.4, tCrouch: 0.2, tWig: [0.2, 0.42], tSpring: 0.46, tPin: 0.6 }): Body {
  const M = ctx.M, k = M.legScale, sH = M.shoulderH, rig = ctx.rig, stand = idlePose(ctx);
  const Dp = o.Dp * k;
  const crouch = cloneBody(stand);
  setTrunk(rig, crouch, { pelvisDrop: 0.3 * sH, chestDrop: 0.36 * sH, surge: -0.02 * k });
  for (const id of ['LH', 'RH'] as const) crouch.legs[id].meta = lerp(rig.legs[id].stanceMeta, flatMeta(rig, id), 0.5);
  for (const id of ['LF', 'RF'] as const) { crouch.legs[id].abduct = 0.3; crouch.legs[id].fore = 0.25; }
  crouch.gaze = [0, 0, 0, 1]; crouch.earL = [-0.1, 0, 0.12]; crouch.earR = [-0.1, 0, 0.12]; crouch.whisk = 0.35;
  crouch.tail = tailShape({ base: -0.55, lift: 0.1, tip: 0.2 });
  const wig = cloneBody(crouch); setTrunk(rig, wig, { pelvisDrop: 0.24 * sH, chestDrop: 0.37 * sH, surge: -0.02 * k });
  const spring = cloneBody(stand); setTrunk(rig, spring, { pelvisDrop: -0.02 * sH, chestDrop: -0.06 * sH, surge: 0.06 * k });
  spring.gaze = [-0.1, 0, 0, 1]; spring.tail = tailShape({ base: -0.1, lift: 0.1, tip: 0.2 }); spring.earL = crouch.earL; spring.earR = crouch.earR;
  const pin = shifted(crouch, [0, 0, Dp]); setTrunk(rig, pin, { pelvisDrop: 0.22 * sH, chestDrop: 0.34 * sH, arch: 0.15 });
  pin.pelvisOff[2] += Dp; pin.gaze = [-0.55, 0, 0, 1];
  for (const id of ['LF', 'RF'] as const) { pin.legs[id].fore = 0.4; pin.legs[id].share = 0.55; }
  const [w0, w1] = o.tWig;
  const strike = shifted(crouch, [0, 0, Dp]); setTrunk(rig, strike, { pelvisDrop: 0.12 * sH, chestDrop: 0.3 * sH, arch: 0.08 });
  strike.pelvisOff[2] += Dp * 0.92; strike.gaze = [-0.45, 0, 0, 1];
  const b = keyedLag(t, [[0, stand], [o.tCrouch, crouch], [w1, wig], [o.tSpring + 0.04, spring, smooth], [o.tPin, strike], [o.tPin + 0.15, pin], [ctx.T, pin]], { head: 0.03, tail: 0.08 });
  const wiggle = bump(t, w0, w0 + 0.05, w1 - 0.02, w1 + 0.03) * Math.sin((t - w0) * 2 * Math.PI * 4.5);
  b.pelvis[1] += 0.1 * wiggle; b.pelvis[2] += 0.06 * wiggle; b.pelvisOff[0] += 0.008 * k * wiggle;
  b.tail = b.tail.map((s, i) => [s[0], s[1] + 0.18 * smooth((i - 7) / 4) * Math.sin(t * 22) * bump(t, w0 - 0.1, w0, w1, w1 + 0.08), s[2]] as V3);
  const ramp = smoother((t - (o.tSpring - 0.01)) / (o.tPin + 0.12 - o.tSpring));
  placeRoot(b, [0, 0, Dp * ramp]);
  const fPin = (id: LegId): V3 => [rig.legs[id].side * 0.025 * k, rig.legs[id].padY, stand.legs.LF.toe[2] + Dp + 0.06 * k];
  for (const id of ['LF', 'RF'] as const) {
    const L = b.legs[id];
    if (t <= o.tSpring) continue;
    if (t < o.tPin) flightLeg(ctx, b, L, id, (t - o.tSpring) / (o.tPin - o.tSpring), stand.legs[id].toe, [[0.035, -0.14, 0.12]], fPin(id), 0.6);
    else { L.toe = fPin(id); L.yaw = 0; L.out = -0.15; L.curl = 0.2 * bump(t, o.tPin, o.tPin + 0.05, o.tPin + 0.3, o.tPin + 0.4); }
  }
  for (const id of ['LH', 'RH'] as const) {
    const L = b.legs[id], home = stand.legs[id].toe, landAt: V3 = [home[0], home[1], home[2] + Dp + 0.02 * k];
    const tread = id === 'LH' ? w0 + 0.04 : w0 + 0.12;
    if (o.tread !== false && t > tread && t < tread + 0.07) stepLeg(rig, L, id, t, tread, tread + 0.07, home, home, 0.018 * k, 0.5);
    else if (o.tread !== false && t > tread + 0.1 && t < tread + 0.17) stepLeg(rig, L, id, t, tread + 0.1, tread + 0.17, home, home, 0.018 * k, 0.5);
    if (t <= o.tSpring + 0.04) continue;
    if (t < o.tPin + 0.1) flightLeg(ctx, b, L, id, (t - o.tSpring - 0.04) / (o.tPin + 0.06 - o.tSpring), home, [[0.05, -0.16, -0.12]], landAt);
    else L.toe = landAt;
  }
  return b;
}

export function pounceStance(T: number, o: { tWig: [number, number]; tSpring: number; tPin: number; tread?: boolean } = { tWig: [0.2, 0.42], tSpring: 0.46, tPin: 0.6 }) {
  const w0 = o.tWig[0], tr = (id: LegId) => (id === 'LH' ? w0 + 0.04 : w0 + 0.12);
  if (o.tread === false) return { LF: [[0, o.tSpring], [o.tPin, T]], RF: [[0, o.tSpring], [o.tPin, T]], LH: [[0, o.tSpring + 0.04], [o.tPin + 0.1, T]], RH: [[0, o.tSpring + 0.04], [o.tPin + 0.1, T]] } as Partial<Record<LegId, [number, number][]>>;
  return {
    LF: [[0, o.tSpring], [o.tPin, T]], RF: [[0, o.tSpring], [o.tPin, T]],
    LH: [[0, tr('LH')], [tr('LH') + 0.07, tr('LH') + 0.1], [tr('LH') + 0.17, o.tSpring + 0.04], [o.tPin + 0.1, T]],
    RH: [[0, tr('RH')], [tr('RH') + 0.07, tr('RH') + 0.1], [tr('RH') + 0.17, o.tSpring + 0.04], [o.tPin + 0.1, T]],
  } as Partial<Record<LegId, [number, number][]>>;
}

/** Where the clip expects the ledge: its edge (z in the root frame at the start, m) and the floor change (m). */
const edgeExtras = (edgeZ: number, H: number) => ({ edgeZ: Math.round(edgeZ * 10000) / 10000, ledgeHeightM: H });
const edgeUp = (gap: number) => (ctx: Ctx) => idlePose(ctx).legs.LF.toe[2] + gap * ctx.M.legScale;
const edgeDown = (ctx: Ctx) => idlePose(ctx).legs.LF.toe[2] + 0.02 * ctx.M.legScale;
const UP_LOW: JumpUp = { H: 0.45, tk: 0.35, tc: 0.65, thl: 0.76, gap: 0.2, crouch: 0.26, frontLand: 0.08, scrabble: false };
const UP_HIGH: JumpUp = { H: 1.2, tk: 0.6, tc: 0.95, thl: 1.12, gap: 0.36, crouch: 0.34, frontLand: 0.1, scrabble: true };
const DOWN_LOW: JumpDown = { H: -0.45, tl: 0.45, push: 0.17, lean: 0.12, reach: 0.0, out: 0.22 };
const DOWN_HIGH: JumpDown = { H: -1.2, tl: 0.7, push: 0.22, lean: 0.22, reach: 0.12, out: 0.34 };

export const moveClips: ClipSpec[] = [
  {
    name: 'cat.move.jump_up_low', body: (t, ctx) => jumpUp(t, ctx, UP_LOW), tailSim: { wBase: 28, wTip: 12, zeta: 0.7 },
    terrain: stepTerrain(edgeUp(UP_LOW.gap), UP_LOW.H), extras: ctx => edgeExtras(edgeUp(UP_LOW.gap)(ctx), UP_LOW.H),
    stance: () => ({ LF: [[0, 0.29], [0.65, 0.7], [0.84, 0.9]], RF: [[0, 0.27], [0.67, 0.76]], LH: [[0, 0.35], [0.74, 0.9]], RH: [[0, 0.35], [0.76, 0.9]] }),
  },
  {
    name: 'cat.move.jump_up_high', body: (t, ctx) => jumpUp(t, ctx, UP_HIGH), tailSim: { wBase: 28, wTip: 12, zeta: 0.7 },
    terrain: stepTerrain(edgeUp(UP_HIGH.gap), UP_HIGH.H), extras: ctx => edgeExtras(edgeUp(UP_HIGH.gap)(ctx), UP_HIGH.H),
    stance: () => ({ LF: [[0, 0.54], [0.95, 1.1], [1.24, 1.3]], RF: [[0, 0.52], [0.97, 1.16]], LH: [[0, 0.6], [1.1, 1.3]], RH: [[0, 0.6], [1.12, 1.3]] }),
  },
  {
    name: 'cat.move.jump_down_low', body: (t, ctx) => jumpDown(t, ctx, DOWN_LOW), tailSim: { wBase: 28, wTip: 12, zeta: 0.7 },
    terrain: stepTerrain(edgeDown, DOWN_LOW.H), extras: ctx => edgeExtras(edgeDown(ctx), DOWN_LOW.H),
    stance: () => ({ LF: [[0, 0.35 * DOWN_LOW.push], [0.45, 0.8]], RF: [[0, 0.75 * DOWN_LOW.push], [0.47, 0.8]], LH: [[0, DOWN_LOW.push], [0.57, 0.8]], RH: [[0, DOWN_LOW.push], [0.59, 0.8]] }),
  },
  {
    name: 'cat.move.jump_down_high', body: (t, ctx) => jumpDown(t, ctx, DOWN_HIGH), tailSim: { wBase: 28, wTip: 12, zeta: 0.7 },
    terrain: stepTerrain(edgeDown, DOWN_HIGH.H), extras: ctx => edgeExtras(edgeDown(ctx), DOWN_HIGH.H),
    stance: () => ({ LF: [[0, 0.35 * DOWN_HIGH.push], [0.7, 1.1]], RF: [[0, 0.75 * DOWN_HIGH.push], [0.72, 1.1]], LH: [[0, DOWN_HIGH.push], [0.82, 1.1]], RH: [[0, DOWN_HIGH.push], [0.84, 1.1]] }),
  },
  {
    name: 'cat.move.land', body: land, tailSim: { wBase: 26, wTip: 11, zeta: 0.6 },
    stance: () => ({ LF: [[0, 0.5]], RF: [[0, 0.5]], LH: [[0.11, 0.5]], RH: [[0.14, 0.5]] }),
  },
  { name: 'cat.play.pounce', body: (t, ctx) => pounce(t, ctx), tailSim: { wBase: 28, wTip: 18, zeta: 0.8 }, stance: ctx => pounceStance(ctx.T) },
];
