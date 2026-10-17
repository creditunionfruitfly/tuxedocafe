// In-place gait generator. Footfalls follow the catalog contact phases and
// duty factor; planted toes slide backward at exactly the in-place ground
// speed; swing paws peel off heel-first (wrist or hock rises while the pads
// stay down), fold at the carpus / hock, travel low and set down softly with
// near-zero ground-relative velocity. Girdle bob, roll and yaw follow the
// support pattern rather than equal sine waves.
import { type Body, type Leg, restBody, solve } from './body.ts';
import type { LegInfo } from './legs.ts';
import { type V3, clamp, curve, hermite, loopNoise, smooth, wrap01 } from './math.ts';
import { LEGS, type LegId, type Rig } from './rig.ts';

const DEG = Math.PI / 180;

export interface GaitStyle {
  T: number;
  /** In-place ground speed (m/s) before fitting: the catalog authoredSpeed. */
  speed: number;
  contacts: Record<LegId, number>;
  duty: number;
  /** Girdle drop below the rest stance (fractions of shoulder height) and extra trunk pitch (rad, + nose up). */
  dropF: number; dropH: number; pitch: number;
  /** Peak toe lift in swing (fractions of shoulder height). */
  liftF: number; liftH: number;
  /** Peak swing flexion at the carpus / hock (rad) and digit curl (rad). */
  carpusF: number; carpusH: number; curlF: number; curlH: number;
  /** Stance metapodial pitch at touchdown, mid-stance and liftoff (rad, relative to the rig's standing pitch); heel-off starts at this stance fraction. */
  metaF: [number, number, number]; metaH: [number, number, number]; heelOffF: number; heelOffH: number;
  /** Fraction of the swing velocity matched at touchdown (1 = paw arrives at rest relative to the ground). */
  matchTd: number;
  /** Track width relative to the rest paw spacing. */
  width: number;
  /** Hind touchdown relative to the ipsilateral front print (m, + behind); a soft goal within reach. */
  register: number;
  /** Preferred stance centres relative to the shoulder / hip joint (fractions of the stance length, + forward). */
  frontBias: number; hindBias: number;
  /** Girdle bob, hip/shoulder roll and yaw amplitudes (fraction of shoulder height / rad). */
  bob: number; roll: number; yaw: number;
  /** Scapula slide amplitude (fraction of shoulder height): the stance blade rides up; glide: forward with protraction. */
  blade: number; glide: number;
  headPitch: number; headBob: number;
  /** Swing timing: < 1 brings the paw forward early. */
  skewF: number; skewH: number;
  /** Elbow outward / forearm preference gain (forearm angle follows this share of the limb's protraction). */
  foreK: number;
  ears: V3; tail: (i: number, phase: number) => V3;
  /** Extra per-phase trunk motion (gallop): [pelvis pitch, spine flexion (+ gathers), girdle rise (fraction), surge (fraction)]. */
  trunk?: (phase: number) => [number, number, number, number];
  seed: number;
}

export interface GaitPlan {
  style: GaitStyle;
  /** In-place ground speed actually used (m/s), stride length and stance length (m). */
  v: number; L: number; S: number; fit: number;
  /** Touchdown z (root frame) and lateral x per paw. */
  zTd: Record<LegId, number>; x: Record<LegId, number>;
  /** Measured free-mode joint angles at liftoff and touchdown (for seamless swing blending). */
  lift: Record<LegId, { carpus: number; digits: number }>; land: Record<LegId, { carpus: number; digits: number }>;
}

export const legPhase = (style: GaitStyle, id: LegId, phase: number) => {
  const u = wrap01(phase - style.contacts[id]);
  return u < style.duty ? { stance: true, s: u / style.duty, u } : { stance: false, s: (u - style.duty) / (1 - style.duty), u };
};

/** Stance-weighted support per girdle: high in single-support mid-stance (vaulting), low in double support. */
function girdleBob(style: GaitStyle, front: boolean, phase: number) {
  const legs = LEGS.filter(id => (id[1] === 'F') === front);
  const one = (p: number) => legs.reduce((s, id) => { const lp = legPhase(style, id, p); return s + (lp.stance ? Math.sin(Math.PI * lp.s) ** 2 : 0); }, 0);
  let mean = 0;
  for (let k = 0; k < 64; k++) mean += one(k / 64) / 64;
  return one(phase) - mean;
}

const liftCurveF = curve([[0, 0], [0.08, 0.3], [0.26, 0.92], [0.38, 1], [0.6, 0.72], [0.8, 0.3], [0.93, 0.06], [1, 0]]);
const liftCurveH = curve([[0, 0], [0.1, 0.28], [0.3, 0.88], [0.45, 1], [0.68, 0.62], [0.86, 0.2], [0.95, 0.04], [1, 0]]);
/** Swing blend from planted to free distal angles and back. */
const relCurve = (s: number) => smooth(s / 0.14) * (1 - smooth((s - 0.8) / 0.18));

/** A planted paw at stance fraction s: digits flat, then the heel peels off while the pads stay down. */
export function stanceLeg(rig: Rig, style: GaitStyle, leg: Leg, id: LegId, s: number) {
  const d = rig.legs[id], m = d.front ? style.metaF : style.metaH, off = d.front ? style.heelOffF : style.heelOffH;
  const peel = smooth((s - off) / (1 - off));
  leg.meta = d.stanceMeta + (s < 0.5 ? m[0] + (m[1] - m[0]) * smooth(s / 0.5) : m[1] + (m[2] - m[1]) * Math.pow(peel, 1.3));
  leg.dig = d.digRestPitch + (d.front ? 0.75 : 0.65) * Math.pow(peel, 1.8);
  leg.spread = 0.05 * Math.sin(Math.PI * clamp(s * 1.2, 0, 1));
  leg.rel = 0;
  return leg;
}

/**
 * A swinging paw at swing fraction s from zLo to zTd, leaving and arriving with ground-relative velocity matched
 * (in-place speed v, swing duration Tsw). Distal angles go free shortly after liftoff and planted again before contact.
 */
export function swingLeg(rig: Rig, style: GaitStyle, leg: Leg, id: LegId, s: number, zLo: number, zTd: number, v: number, Tsw: number,
  lift: { carpus: number; digits: number }, land: { carpus: number; digits: number }) {
  const d = rig.legs[id], front = d.front, M = rig.M;
  const w = Math.pow(s, front ? style.skewF : style.skewH);
  leg.toe[2] = hermite(zLo, zTd, -v * Tsw, -v * Tsw * style.matchTd, w);
  leg.toe[1] = d.padY + (front ? style.liftF : style.liftH) * M.shoulderH * (front ? liftCurveF : liftCurveH)(s);
  // Planted angles at both ends (heel peeled at liftoff, touchdown pitch at contact).
  const m = front ? style.metaF : style.metaH;
  leg.meta = d.stanceMeta + m[2] + (m[0] - m[2]) * smooth(s);
  leg.dig = d.digRestPitch + (front ? 0.75 : 0.65) * (1 - smooth(s / 0.3));
  leg.rel = relCurve(s);
  const peak = (front ? style.carpusF : style.carpusH) * d.flexScale;
  // Carpus: fold fast after liftoff, open through mid-swing, reach slightly extended before contact.
  leg.carpus = front
    ? curve([[0, lift.carpus], [0.12, lift.carpus + 0.55 * (peak - lift.carpus)], [0.3, peak], [0.48, peak * 0.78], [0.72, 0.15 * peak], [0.86, land.carpus - 0.08], [1, land.carpus]])(s)
    : curve([[0, lift.carpus], [0.16, lift.carpus + 0.5 * (peak - lift.carpus)], [0.36, peak], [0.58, peak * 0.85], [0.8, land.carpus + 0.1], [1, land.carpus]])(s);
  const curl = front ? style.curlF : style.curlH;
  leg.digits = curve([[0, lift.digits], [0.2, curl], [0.5, curl * 0.8], [0.8, land.digits - 0.1], [1, land.digits]])(s);
  leg.curl = 0.25 * Math.sin(Math.PI * clamp(s * 1.25, 0, 1));
  return leg;
}

export function baseLeg(rig: Rig, id: LegId, x: number, z: number, style: GaitStyle): Leg {
  const d = rig.legs[id];
  return {
    toe: [x, d.padY, z], c: [0, 0, 0], cw: 0, meta: d.stanceMeta + (d.front ? style.metaF[1] : style.metaH[1]), dig: d.digRestPitch, rel: 0,
    carpus: 0, digits: d.dRest, curl: 0, spread: 0, yaw: 0, out: d.front ? 0.05 : 0.08, roll: 0,
    share: 0.38, swing: 0, fore: d.foreRest, foreW: d.front ? 1.2 : 0.3, foreK: style.foreK,
    abduct: 0, slide: 0, glide: 0,
  };
}

function gaitLeg(rig: Rig, plan: GaitPlan, id: LegId, phase: number): Leg {
  const { style, v, S } = plan;
  const lp = legPhase(style, id, phase);
  const zTd = plan.zTd[id];
  const leg = baseLeg(rig, id, plan.x[id], zTd, style);
  if (lp.stance) { leg.toe[2] = zTd - S * lp.s; stanceLeg(rig, style, leg, id, lp.s); }
  else swingLeg(rig, style, leg, id, lp.s, zTd - S, zTd, v, (1 - style.duty) * style.T, plan.lift[id], plan.land[id]);
  return leg;
}

export function gaitBody(rig: Rig, plan: GaitPlan, phase: number): Body {
  const { style } = plan, M = rig.M, b = restBody(rig), sH = M.shoulderH;
  for (const id of LEGS) b.legs[id] = gaitLeg(rig, plan, id, phase);
  const bobF = girdleBob(style, true, phase) * style.bob * sH;
  const bobH = girdleBob(style, false, phase) * style.bob * sH;
  const trunk = style.trunk?.(phase) ?? [0, 0, 0, 0];
  const dropH = style.dropH * sH - bobH - trunk[2] * sH;
  const dropF = style.dropF * sH - bobF - trunk[2] * sH;
  const pitch = Math.asin(clamp((dropH - dropF) / M.girdle, -1, 1)) + style.pitch + trunk[0];
  const swingW = (id: LegId) => { const lp = legPhase(style, id, phase); return lp.stance ? 0 : Math.sin(Math.PI * lp.s); };
  // The hip and shoulder sag a little on the swing side; the pelvis yaws so the protracted hind leg's hip leads.
  const rollH = style.roll * (swingW('RH') - swingW('LH'));
  const rollF = 0.7 * style.roll * (swingW('RF') - swingW('LF'));
  const z = (id: LegId) => b.legs[id].toe[2];
  const yawH = -style.yaw * (z('LH') - z('RH')) / Math.max(plan.S, 1e-6);
  const yawF = -0.6 * style.yaw * (z('LF') - z('RF')) / Math.max(plan.S, 1e-6);
  b.pelvisOff = [0, -dropH, trunk[3] * sH];
  b.pelvis = [pitch, yawH, rollH];
  const flex = trunk[1];
  b.spine = [0, 1, 2, 3, 4].map(k => [
    -flex * [0.3, 0.28, 0.22, 0.12, 0.08][k]!,
    (yawF - yawH) * [0.14, 0.22, 0.26, 0.24, 0.14][k]!,
    (rollF - rollH) * [0.1, 0.15, 0.25, 0.3, 0.2][k]!,
  ] as V3);
  // Shoulder blades ride up on the stance side.
  for (const id of ['LF', 'RF'] as const) {
    const lp = legPhase(style, id, phase);
    b.legs[id].slide = style.blade * sH * (lp.stance ? Math.sin(Math.PI * lp.s) ** 0.8 : -0.35 * Math.sin(Math.PI * lp.s));
    const zMid = plan.zTd[id] - plan.S / 2;
    b.legs[id].glide = style.glide * sH * Math.tanh(1.3 * (b.legs[id].toe[2] - zMid) / Math.max(plan.S / 2, 1e-6)) / Math.tanh(1.3);
  }
  const nz = loopNoise(style.seed, 1, [1, 2, 3]);
  b.gaze = [style.headPitch + style.headBob * (bobF / sH) * 2 + 0.008 * nz(phase), 0.012 * nz(phase + 0.37), 0, 0.9];
  b.earL = [...style.ears]; b.earR = [...style.ears];
  b.tail = Array.from({ length: 12 }, (_, i) => style.tail(i, phase));
  return b;
}

/** Plan a gait: stride from the in-place speed, touchdown points from girdle-relative stance centres. */
export function planGait(rig: Rig, style: GaitStyle, fit: number, centreF: number, centreH: number): GaitPlan {
  const v = style.speed * fit, L = v * style.T, S = L * style.duty;
  const zTd = {} as Record<LegId, number>, x = {} as Record<LegId, number>;
  for (const id of LEGS) {
    const d = rig.legs[id];
    const shoulder = rig.restWorld[d.a]!;
    // Stance centre: under the shoulder / hip joint, offset by the fitted centre (m).
    const mid = d.front ? shoulder.z + centreF : shoulder.z + centreH;
    zTd[id] = mid + S / 2;
    x[id] = d.restToe.x * style.width;
  }
  const empty = () => ({ LF: { carpus: 0, digits: 0 }, RF: { carpus: 0, digits: 0 }, LH: { carpus: 0, digits: 0 }, RH: { carpus: 0, digits: 0 } });
  const plan: GaitPlan = { style, v, L, S, fit, zTd, x, lift: empty(), land: empty() };
  measureEnds(rig, plan);
  return plan;
}

/** Solve the liftoff and touchdown frames of each paw to read the joint angles the swing must start and end with. */
function measureEnds(rig: Rig, plan: GaitPlan) {
  for (const id of LEGS) {
    const c = plan.style.contacts[id];
    for (const [phase, key] of [[c + plan.style.duty - 1e-6, 'lift'], [c, 'land']] as const) {
      const info: Partial<Record<LegId, LegInfo>> = {};
      solve(rig, gaitBody(rig, plan, wrap01(phase)), info);
      plan[key][id] = { carpus: info[id]!.carpus, digits: info[id]!.digits };
    }
  }
}

/** Register achieved: hind touchdown behind the ipsilateral front print (m, + behind). */
export function registerOf(plan: GaitPlan, side: 'L' | 'R') {
  const F = `${side}F` as LegId, H = `${side}H` as LegId;
  const dc = wrap01(plan.style.contacts[H] - plan.style.contacts[F]);
  return plan.zTd[F] - plan.zTd[H] - dc * plan.L;
}

export interface FitReport { fit: number; centreF: number; centreH: number; maxReach: number; register: number }

/**
 * Fit the stance centres (and, only if the rig cannot reach the stride, the stride) so every planted
 * paw is reached exactly with margin; among reachable centres prefer the catalogued hind register.
 */
export function fitGait(rig: Rig, style: GaitStyle, samples = 24): FitReport {
  const sH = rig.M.shoulderH;
  const evalCentres = (fit: number, cF: number, cH: number) => {
    const plan = planGait(rig, style, fit, cF, cH);
    let maxF = 0, maxH = 0, missF = 0, missH = 0;
    for (let k = 0; k < samples; k++) {
      const info: Partial<Record<LegId, LegInfo>> = {};
      solve(rig, gaitBody(rig, plan, k / samples), info);
      for (const id of LEGS) {
        const r = info[id]!, stance = legPhase(style, id, k / samples).stance, front = id[1] === 'F';
        const miss = stance ? r.reachError : Math.max(0, r.reachError - 0.15 * sH);
        if (front) { maxF = Math.max(maxF, r.reach); missF = Math.max(missF, miss); } else { maxH = Math.max(maxH, r.reach); missH = Math.max(missH, miss); }
      }
    }
    return { plan, maxF, maxH, missF, missH };
  };
  const search = (fit: number) => {
    const S = style.speed * fit * style.T * style.duty;
    let bestF = 0, bestH = 0, costF = Infinity, costH = Infinity, okF = false, okH = false;
    const grid = Array.from({ length: 13 }, (_, i) => (i - 6) / 6 * 0.45 * S);
    for (const g of grid) {
      const r = evalCentres(fit, g, 0);
      const c = (r.missF > 1e-5 ? 10 + r.missF : 0) + Math.max(0, r.maxF - 0.93) * 5 + 0.3 * Math.abs(g / Math.max(S, 1e-6) - style.frontBias);
      if (c < costF) { costF = c; bestF = g; okF = r.missF <= 1e-5; }
    }
    for (const g of grid) {
      const r = evalCentres(fit, bestF, g);
      const reg = registerOf(r.plan, 'L');
      const c = (r.missH > 1e-5 ? 10 + r.missH : 0) + Math.max(0, r.maxH - 0.93) * 5 + 0.3 * Math.abs(g / Math.max(S, 1e-6) - style.hindBias)
        + 0.15 * Math.abs(reg - style.register) / Math.max(S, 1e-6);
      if (c < costH) { costH = c; bestH = g; okH = r.missH <= 1e-5; }
    }
    return { ok: okF && okH, cF: bestF, cH: bestH };
  };
  let fit = 1, res = search(1);
  if (!res.ok) {
    let lo = 0.2, hi = 1;
    for (let it = 0; it < 10; it++) { const m = (lo + hi) / 2, r = search(m); if (r.ok) { lo = m; res = r; } else hi = m; }
    fit = Math.floor(lo * 0.98 * 1000) / 1000;
    res = search(fit);
  }
  const final = evalCentres(fit, res.cF, res.cH);
  return { fit, centreF: res.cF, centreH: res.cH, maxReach: Math.max(final.maxF, final.maxH), register: registerOf(final.plan, 'L') };
}

/** Stance intervals (seconds) for the catalog contacts and duty factor. */
export function gaitStance(style: GaitStyle): Partial<Record<LegId, [number, number][]>> {
  return Object.fromEntries(LEGS.map(id => [id, [[style.contacts[id] * style.T, (style.contacts[id] + style.duty) * style.T]]]));
}

export { DEG };
