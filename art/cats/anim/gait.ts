// In-place gait generator. Footfalls follow the catalog contact phases and
// duty factor; planted toes slide backward at the ground speed; swing paws
// lift sharply (carpus / hock flexion first), travel low and set down softly
// with zero ground-relative velocity. Girdle bob, roll and yaw are derived
// from the support pattern rather than imposed as equal sine waves.
import { type Body, type Leg, type SolveInfo, restBody, solve } from './body.ts';
import { type V3, clamp, curve, hermite, loopNoise, smooth, wrap01 } from './math.ts';
import { LEGS, type LegId, type Rig } from './rig.ts';

export interface GaitStyle {
  T: number;
  /** Catalog speed (adult m/s). The in-place ground speed is speed × legScale × fit. */
  speed: number;
  contacts: Record<LegId, number>;
  duty: number;
  /** Chest and pelvis drop below rest (fractions of shoulder height). */
  dropF: number; dropH: number;
  /** Peak toe lift during swing (fractions of shoulder height). */
  liftF: number; liftH: number;
  /** Peak carpal / hock flexion during swing (rad). */
  flexF: number; flexH: number;
  /** Heel roll-off at liftoff (rad). */
  rollF: number; rollH: number;
  /** Hind touchdown relative to the ipsilateral front print (m at legScale 1, + behind). */
  register: number;
  /** Front and hind stance centre offsets from the rest toe (fractions of stance length, + forward). */
  frontBias: number; hindBias: number;
  /** Track width as a fraction of the rest paw spacing. */
  width: number;
  /** Girdle bob, roll and yaw amplitudes (fractions of shoulder height / rad). */
  bob: number; roll: number; yaw: number;
  headPitch: number; headBob: number;
  /** Swing timing skew: < 1 brings the paw forward early. */
  skewF: number; skewH: number;
  ears: V3; tail: (i: number, phase: number) => V3;
  spinePitch: number;
  /** Preferred elbow / knee extension relative to rest. */
  flex: number;
  /** Extra per-phase trunk motion (gallop flexion): returns [pelvisPitch, spineFlex, pelvisRise, pelvisSurge]. */
  trunk?: (phase: number) => [number, number, number, number];
  seed: number;
}

export interface GaitPlan { style: GaitStyle; v: number; S: number; fit: number; zTd: Record<LegId, number>; x: Record<LegId, number> }

export const legPhase = (style: GaitStyle, id: LegId, phase: number) => {
  const u = wrap01(phase - style.contacts[id]);
  return u < style.duty ? { stance: true, s: u / style.duty, u } : { stance: false, s: (u - style.duty) / (1 - style.duty), u };
};

/** Stance-weighted support bump per girdle: high in single-support mid-stance, low in double support. */
function girdleBob(style: GaitStyle, front: boolean, phase: number) {
  const legs = LEGS.filter(id => (id[1] === 'F') === front);
  const one = (p: number) => legs.reduce((s, id) => { const lp = legPhase(style, id, p); return s + (lp.stance ? Math.sin(Math.PI * lp.s) ** 2 : 0); }, 0);
  let mean = 0;
  for (let k = 0; k < 64; k++) mean += one(k / 64) / 64;
  return one(phase) - mean;
}

export function planGait(rig: Rig, style: GaitStyle, fit: number): GaitPlan {
  const M = rig.M, v = style.speed * M.legScale * fit, stride = v * style.T, S = stride * style.duty;
  const zTd = {} as Record<LegId, number>, x = {} as Record<LegId, number>;
  for (const side of ['L', 'R'] as const) {
    const F = `${side}F` as LegId, H = `${side}H` as LegId;
    const restF = rig.legs[F].restToe, restH = rig.legs[H].restToe;
    // Stances centre under their girdles; then both shift (within a quarter stance)
    // toward the catalogued register of the hind paw on the front print.
    let zF = restF.z + S / 2 + style.frontBias * S, zH = restH.z + S / 2 + style.hindBias * S;
    const dc = wrap01(style.contacts[H] - style.contacts[F]);
    const want = dc * stride + style.register * M.legScale, have = zF - zH;
    const shift = clamp((want - have) / 2, -0.25 * S, 0.25 * S);
    zF += shift; zH -= shift;
    zTd[F] = zF; zTd[H] = zH;
    x[F] = restF.x * style.width; x[H] = restH.x * style.width;
  }
  return { style, v, S, fit, zTd, x };
}

const liftCurveF = curve([[0, 0], [0.12, 0.52], [0.34, 1], [0.62, 0.78], [0.84, 0.3], [0.95, 0.05], [1, 0]]);
const liftCurveH = curve([[0, 0], [0.15, 0.45], [0.4, 1], [0.7, 0.6], [0.88, 0.18], [0.96, 0.03], [1, 0]]);

export function baseLeg(rig: Rig, id: LegId, x: number, z: number, flex: number): Leg {
  const d = rig.legs[id];
  return {
    toe: [x, d.padY, z], heel: d.stanceHeel, toeP: 0, curl: 0, spread: 0, yaw: 0, out: 0.06, roll: 0,
    swing: 0, share: d.front ? 0.5 : 0.4, abduct: 0, flex, comfort: 1, c: [0, 0, 0], cw: 0,
  };
}

/** Planted paw at stance fraction s: the heel peels off late while the digits stay down. */
export function stanceLeg(rig: Rig, style: GaitStyle, leg: Leg, id: LegId, s: number) {
  const d = rig.legs[id], front = d.front, roll = front ? style.rollF : style.rollH;
  leg.heel = d.stanceHeel + roll * Math.pow(smooth((s - (front ? 0.5 : 0.42)) / (front ? 0.5 : 0.58)), 1.4);
  leg.spread = 0.04 * Math.sin(Math.PI * s);
  return leg;
}

/**
 * Swinging paw at swing fraction s from zLo to zTd, leaving and arriving with ground-relative
 * velocities vFrom / vTo (in-place m/s backward) over a swing of Tsw seconds.
 */
export function swingLeg(rig: Rig, style: GaitStyle, leg: Leg, id: LegId, s: number, zLo: number, zTd: number, vFrom: number, vTo: number, Tsw: number) {
  const d = rig.legs[id], front = d.front, M = rig.M, roll = front ? style.rollF : style.rollH, h0 = d.stanceHeel;
  const w = Math.pow(s, front ? style.skewF : style.skewH);
  leg.toe[2] = hermite(zLo, zTd, -vFrom * Tsw, -vTo * Tsw * 0.6, w);
  const lift = (front ? style.liftF : style.liftH) * M.shoulderH;
  leg.toe[1] = d.padY + lift * (front ? liftCurveF : liftCurveH)(s);
  const flex = front ? style.flexF : style.flexH;
  // Flex fast after liftoff, extend before touchdown, slight dorsiflexion just before contact.
  leg.heel = h0 + curve(front
    ? [[0, roll], [0.2, flex], [0.42, flex * 0.82], [0.72, 0.15], [0.88, -0.1], [1, 0]]
    : [[0, roll], [0.24, flex], [0.5, flex * 0.7], [0.78, 0.1], [0.9, -0.08], [1, 0]])(s);
  // Digits hang curled through the swing and open flat for the soft set-down.
  leg.toeP = curve(front
    ? [[0, 0], [0.2, flex + 0.3], [0.45, flex * 0.8 + 0.2], [0.75, 0.12], [0.9, -0.06], [1, 0]]
    : [[0, 0], [0.24, flex + 0.25], [0.5, flex * 0.7 + 0.15], [0.8, 0.08], [0.92, -0.04], [1, 0]])(s);
  leg.curl = 0.2 * Math.sin(Math.PI * clamp(s * 1.3, 0, 1));
  return leg;
}

function gaitLeg(rig: Rig, plan: GaitPlan, id: LegId, phase: number): Leg {
  const { style, v, S } = plan;
  const lp = legPhase(style, id, phase);
  const zTd = plan.zTd[id];
  const leg = baseLeg(rig, id, plan.x[id], zTd, style.flex);
  if (lp.stance) { leg.toe[2] = zTd - S * lp.s; stanceLeg(rig, style, leg, id, lp.s); }
  else swingLeg(rig, style, leg, id, lp.s, zTd - S, zTd, v, v, (1 - style.duty) * style.T);
  return leg;
}

export function gaitBody(rig: Rig, plan: GaitPlan, phase: number): Body {
  const { style } = plan, M = rig.M, b = restBody(rig);
  for (const id of LEGS) b.legs[id] = gaitLeg(rig, plan, id, phase);
  const bobF = girdleBob(style, true, phase) * style.bob * M.shoulderH;
  const bobH = girdleBob(style, false, phase) * style.bob * M.shoulderH;
  const trunk = style.trunk?.(phase) ?? [0, 0, 0, 0];
  const dropH = style.dropH * M.shoulderH - bobH - trunk[2] * M.shoulderH;
  const dropF = style.dropF * M.shoulderH - bobF - trunk[2] * M.shoulderH;
  const pitch = Math.asin(clamp((dropH - dropF) / M.trunk, -1, 1)) + style.spinePitch + trunk[0];
  // Hips drop on the swing side; the pelvis yaws so the protracted hind leg's hip leads.
  const z = (id: LegId) => b.legs[id].toe[2];
  const swingDrop = (id: LegId) => { const lp = legPhase(style, id, phase); return lp.stance ? 0 : Math.sin(Math.PI * lp.s); };
  const rollH = -style.roll * (swingDrop('LH') - swingDrop('RH'));
  const rollF = -style.roll * 0.8 * (swingDrop('LF') - swingDrop('RF'));
  const yawH = -style.yaw * (z('LH') - z('RH')) / Math.max(plan.S, 1e-6);
  const yawF = -style.yaw * 0.7 * (z('LF') - z('RF')) / Math.max(plan.S, 1e-6);
  b.pelvisOff = [0, -dropH, trunk[3] * M.shoulderH];
  b.pelvis = [pitch, yawH, rollH];
  const flex = trunk[1];
  b.spine = [0, 1, 2, 3, 4].map(k => [
    -flex * [0.3, 0.28, 0.22, 0.12, 0.08][k]!,
    (yawF - yawH) * [0.15, 0.2, 0.25, 0.25, 0.15][k]!,
    (rollF - rollH) * [0.1, 0.15, 0.25, 0.3, 0.2][k]!,
  ] as V3);
  const nz = loopNoise(style.seed, 1, [1, 2, 3]);
  b.gaze = [style.headPitch + style.headBob * (bobF / M.shoulderH) * 2 + 0.01 * nz(phase), 0.012 * nz(phase + 0.37), 0, 0.92];
  b.earL = [...style.ears]; b.earR = [...style.ears];
  b.tail = Array.from({ length: 12 }, (_, i) => style.tail(i, phase));
  return b;
}

/**
 * Largest stride fit (≤ 1) at which every leg reaches its targets without clamping, searching the
 * front / hind stance placement near the authored biases so each rig uses its own best footprint.
 */
export function fitGait(rig: Rig, style: GaitStyle, samples = 36): GaitStyle & { fit: number } {
  const ok = (s: GaitStyle, fit: number) => {
    const plan = planGait(rig, s, fit);
    for (let k = 0; k < samples; k++) {
      const info = {} as Record<LegId, SolveInfo>;
      solve(rig, gaitBody(rig, plan, k / samples), info);
      // Planted paws must be reached exactly; a swing paw may ride a little short of its arc.
      for (const id of LEGS) if (info[id].reachError > (legPhase(s, id, k / samples).stance ? 1e-5 : 0.25 * rig.M.shoulderH)) return false;
    }
    return true;
  };
  const fitOf = (s: GaitStyle) => {
    if (ok(s, 1)) return 1;
    let lo = 0.1, hi = 1;
    if (!ok(s, lo)) return 0;
    for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (ok(s, m)) lo = m; else hi = m; }
    return lo;
  };
  let best = { ...style, fit: -1 }, bestCost = Infinity;
  for (const df of [0, 0.15, -0.15, 0.3]) for (const dh of [0, 0.15, -0.15]) {
    const s = { ...style, frontBias: style.frontBias + df, hindBias: style.hindBias + dh };
    const fit = fitOf(s), cost = -fit + 0.02 * (Math.abs(df) + Math.abs(dh));
    if (cost < bestCost) { bestCost = cost; best = { ...s, fit }; }
  }
  return { ...best, fit: Math.floor(best.fit * 0.985 * 1000) / 1000 };
}

/** Stance intervals (seconds) for the catalog contacts and duty factor. */
export function gaitStance(style: GaitStyle): Partial<Record<LegId, [number, number][]>> {
  return Object.fromEntries(LEGS.map(id => [id, [[style.contacts[id] * style.T, (style.contacts[id] + style.duty) * style.T]]]));
}
