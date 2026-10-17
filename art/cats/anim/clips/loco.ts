// Locomotion clips: idle, walk, trot, gallop, walk away, start, stop and turns.
import { type Body, type Leg, mirrorBody, mixBody } from '../body.ts';
import type { ClipSpec, Ctx, Stance } from '../catalog.ts';
import {
  type GaitPlan, type GaitStyle, baseLeg, fitGait, gaitBody, gaitStance, legPhase, planGait, registerOf, stanceLeg, swingLeg,
} from '../gait.ts';
import { type V3, bump, clamp, curve, hermite, loopCurve, loopNoise, pulse, smooth } from '../math.ts';
import { addBreath, earFlick, setTrunk, standBody, standTail, stepLeg } from '../poses.ts';
import { LEGS, type LegId, type Rig } from '../rig.ts';

const DEG = Math.PI / 180;
const round = (x: number, d = 1000) => Math.round(x * d) / d;
const contacts = (ctx: Ctx) => ctx.clip.contacts as Record<LegId, number>;

const plans = new WeakMap<Rig, Map<string, GaitPlan>>();
/** The fitted plan for a gait clip (cached per rig and clip). */
export function gaitPlan(name: string, style: (ctx: Ctx) => GaitStyle, ctx: Ctx): GaitPlan {
  let byRig = plans.get(ctx.rig);
  if (!byRig) plans.set(ctx.rig, byRig = new Map());
  let plan = byRig.get(name);
  if (!plan) {
    const s = style(ctx), f = fitGait(ctx.rig, s);
    byRig.set(name, plan = planGait(ctx.rig, s, f.fit, f.centreF, f.centreH));
  }
  return plan;
}

const ctxFor = (ctx: Ctx, name: string): Ctx => {
  const clip = ctx.catalog.clips.find(c => c.name === name)!;
  return { ...ctx, clip, T: clip.durationS, n: Math.round(clip.durationS * ctx.catalog.fps) };
};

export function gaitExtras(plan: GaitPlan) {
  return {
    rigSpeed: round(plan.v), strideFit: plan.fit, strideM: round(plan.L), stanceLengthM: round(plan.S),
    hindRegisterM: round(registerOf(plan, 'L')),
    speedNote: plan.fit < 1
      ? 'This skeleton cannot reach the catalogued stride at authoredSpeed; planted paws slide at rigSpeed (scale playback by authoredSpeed / rigSpeed or let leg IK lock the pads).'
      : 'Planted paws slide backward at exactly authoredSpeed.',
  };
}

export function gaitClip(name: string, style: (ctx: Ctx) => GaitStyle, tailSim = { wBase: 30, wTip: 14, zeta: 0.7 },
  decorate?: (b: Body, t: number, ctx: Ctx, plan: GaitPlan) => Body): ClipSpec {
  return {
    name,
    body: (t, ctx) => {
      const plan = gaitPlan(name, style, ctx), b = gaitBody(ctx.rig, plan, t / ctx.T);
      return decorate ? decorate(b, t, ctx, plan) : b;
    },
    tailSim,
    stance: ctx => gaitStance(gaitPlan(name, style, ctx).style),
    groundSpeed: (_t, ctx) => gaitPlan(name, style, ctx).v,
    extras: ctx => gaitExtras(gaitPlan(name, style, ctx)),
  };
}

// ---------------------------------------------------------------- gait styles

/** Walk tail: carried low-mid in a soft S; a slow, asymmetric side sway (the tail simulation adds the lagging wave). */
const walkTail = (i: number, phase: number): V3 => {
  const lift = i === 0 ? -0.3 : i < 6 ? -0.085 : 0.085;
  const sway = loopCurve([[0, 0.02], [0.18, 0.045], [0.42, -0.01], [0.62, -0.04], [0.85, -0.005]]);
  return [lift, sway(phase - i * 0.035) * (0.5 + i / 14), 0];
};

export const walkStyle = (ctx: Ctx): GaitStyle => ({
  T: ctx.T, speed: ctx.clip.authoredSpeed ?? 0.7, contacts: contacts(ctx), duty: ctx.clip.dutyFactor ?? 0.62,
  dropF: 0.03, dropH: 0.02, pitch: 0, liftF: 0.13, liftH: 0.1, carpusF: 1.75, carpusH: 1.6, curlF: 0.2, curlH: 0.1,
  metaF: [-4 * DEG, 0, 46 * DEG], metaH: [-4 * DEG, 0, 24 * DEG], heelOffF: 0.6, heelOffH: 0.75, matchTd: 0.55,
  width: 0.85, register: 0.005, frontBias: 0, hindBias: -0.12, bob: 0.025, roll: 0.04, yaw: 0.06, blade: 0.03, glide: 0.05,
  headPitch: -0.07, headBob: 0.25, skewF: 0.85, skewH: 1, foreK: 0.5, ears: [0, 0, 0.04], tail: walkTail, seed: ctx.seed,
});

export const trotStyle = (ctx: Ctx): GaitStyle => ({
  ...walkStyle(ctx), speed: ctx.clip.authoredSpeed ?? 1.6, contacts: contacts(ctx), duty: ctx.clip.dutyFactor ?? 0.45,
  dropF: 0.04, dropH: 0.03, liftF: 0.16, liftH: 0.13, carpusF: 1.95, carpusH: 1.75, curlF: 0.25, curlH: 0.15,
  metaF: [-6 * DEG, -2 * DEG, 50 * DEG], metaH: [-6 * DEG, -2 * DEG, 30 * DEG], heelOffF: 0.5, heelOffH: 0.62, matchTd: 0.45,
  register: 0.03, frontBias: 0, hindBias: -0.1, bob: 0.02, roll: 0.03, yaw: 0.045, blade: 0.035, glide: 0.06,
  headPitch: -0.05, headBob: 0.1, skewF: 0.8, skewH: 0.9, ears: [0.05, 0, 0.06],
  tail: (i, phase) => [i === 0 ? -0.12 : i < 7 ? -0.035 : 0.05,
    (0.04 * Math.sin(2 * Math.PI * (2 * phase - 0.12 - i * 0.03)) + 0.015 * Math.sin(2 * Math.PI * (phase + 0.2))) * (0.3 + i / 11), 0],
});

// Gallop: spine flexion is the engine of the stride; gathered (+) around hind touchdown, extended (-) around front touchdown.
const gallopFlex = loopCurve([[0, 0.82], [0.12, 0.5], [0.28, -0.15], [0.42, -0.5], [0.52, -0.38], [0.66, 0.12], [0.8, 0.7], [0.92, 0.95]]);
const gallopPitch = loopCurve([[0, 0.03], [0.2, 0.1], [0.38, 0.05], [0.52, -0.06], [0.7, -0.09], [0.88, -0.02]]);
const gallopRise = loopCurve([[0, -0.01], [0.2, -0.03], [0.4, 0.02], [0.55, -0.03], [0.76, -0.04], [0.93, 0.03]]);
const gallopSurge = loopCurve([[0, 0.06], [0.25, 0.03], [0.45, -0.02], [0.65, -0.03], [0.85, 0.04]]);
export const gallopStyle = (ctx: Ctx): GaitStyle => ({
  ...walkStyle(ctx), speed: ctx.clip.authoredSpeed ?? 3.5, contacts: contacts(ctx), duty: ctx.clip.dutyFactor ?? 0.3,
  dropF: 0.06, dropH: 0.05, liftF: 0.22, liftH: 0.19, carpusF: 2.1, carpusH: 1.85, curlF: 0.3, curlH: 0.2,
  metaF: [-10 * DEG, -6 * DEG, 52 * DEG], metaH: [-10 * DEG, -6 * DEG, 34 * DEG], heelOffF: 0.4, heelOffH: 0.5, matchTd: 0.35,
  register: -0.06, frontBias: 0.05, hindBias: 0.05, width: 0.75, bob: 0.0, roll: 0.025, yaw: 0.025, blade: 0.04, glide: 0.08,
  headPitch: -0.1, headBob: 0.0, skewF: 0.75, skewH: 0.8, ears: [0.55, 0.3, -0.05],
  trunk: p => { const f = gallopFlex(p); return [f * 0.5 + gallopPitch(p), f, gallopRise(p), gallopSurge(p)]; },
  // The tail streams out low: its base counters the pelvis rocking so it does not whip into the floor.
  tail: (i, phase) => [i === 0 ? -0.08 + 0.6 * (gallopFlex(phase) * 0.5 + gallopPitch(phase)) : i < 6 ? -0.02 : 0.012,
    0.025 * Math.sin(2 * Math.PI * (phase - i * 0.05)) * (i / 11), 0],
});

export const walkAwayStyle = (ctx: Ctx): GaitStyle => ({
  ...walkStyle(ctx), speed: ctx.clip.authoredSpeed ?? 0.85, contacts: contacts(ctx), duty: ctx.clip.dutyFactor ?? 0.6,
  dropF: 0.02, dropH: 0.015, liftF: 0.1, liftH: 0.08, carpusF: 1.4, carpusH: 1.3, matchTd: 0.6,
  bob: 0.016, roll: 0.025, yaw: 0.04, blade: 0.025, headPitch: -0.03, headBob: 0.08, skewF: 0.9, ears: [0.75, 0.35, -0.08],
  tail: (i, phase) => {
    const flick = Math.max(pulse(phase, 0.28, 0.04, 0.05), pulse(phase, 0.78, 0.04, 0.06) * 0.7) * smooth((i - 6) / 5);
    return [i === 0 ? -0.72 : i < 6 ? -0.05 : 0.035, 0.5 * flick + 0.02 * Math.sin(2 * Math.PI * phase) * (i / 11), 0];
  },
});

// ---------------------------------------------------------------- idle, start and stop share one footprint

/** Walk plan, ground travel of start / stop, and the idle footprint that makes idle, start, walk and stop line up. */
export function walkFoot(ctx: Ctx) {
  const wctx = ctxFor(ctx, 'cat.loco.walk');
  const plan = gaitPlan('cat.loco.walk', walkStyle, wctx);
  const D = plan.v * plan.style.T * 0.25; // start and stop each cover a quarter stride (half the walk speed over 0.5 s)
  const stand = standBody(ctx.rig);
  const foot = {} as Record<LegId, V3>;
  for (const id of LEGS) {
    const d = ctx.rig.legs[id];
    // Forepaws stand naturally (they step in start and stop); hind paws sit where both clips keep one planted.
    foot[id] = [plan.x[id], d.padY, d.front ? stand.legs[id].toe[2] : plan.zTd[id] - D];
  }
  return { plan, D, foot, wctx };
}

export function idleBody(ctx: Ctx): Body {
  const b = standBody(ctx.rig), { foot } = walkFoot(ctx);
  for (const id of LEGS) b.legs[id].toe = [...foot[id]];
  return b;
}

function idleClip(): ClipSpec {
  return {
    name: 'cat.loco.idle',
    body: (t, ctx) => {
      const M = ctx.M, k = M.legScale, b = idleBody(ctx), T = ctx.T;
      const n1 = loopNoise(ctx.seed, T, [1, 2, 3]), n2 = loopNoise(ctx.seed + 7, T, [1, 2]);
      // Weight drifts between fore and hind and a little side to side over the planted paws.
      const shift = loopCurve([[0, 0], [0.22, 0.6], [0.45, 0.5], [0.7, -0.45], [0.88, -0.2]]);
      setTrunk(ctx.rig, b, {
        pelvisDrop: (0.02 + 0.006 * n2(t + 0.6)) * M.shoulderH, chestDrop: (0.03 + 0.008 * shift(t / T)) * M.shoulderH,
        surge: (0.008 * shift(t / T) + 0.003 * n1(t)) * k, lateral: 0.004 * k * n2(t), roll: 0.018 * n2(t + 0.3),
      });
      addBreath(b, t, 2, 0.028);
      // Gaze holds, then shifts quickly (the head follows the eyes) and returns to rest for the loop.
      const look = curve([[0, 0], [0.7, 0], [0.92, 0.16], [2.1, 0.13], [2.3, -0.08], [3.35, -0.06], [3.6, 0], [4, 0]]);
      const nod = curve([[0, 0], [0.75, 0], [0.95, 0.04], [2.2, 0.03], [2.35, -0.02], [3.5, -0.01], [3.7, 0], [4, 0]]);
      b.gaze = [-0.06 + nod(t) + 0.01 * n1(t + 2), look(t), 0.03 * look(t), 0.9];
      const eye = look(t + 0.06) - look(t);
      b.eyes = [eye * 2, 0, eye * 2, 0];
      earFlick(b, t, 1.3, -1, 0.55, 0.6); earFlick(b, t, 3.0, 1, 0.3, 0.4);
      b.tail = b.tail.map((s, i) => [s[0], s[1] + 0.35 * pulse(t, 2.6, 0.06, 0.12) * smooth((i - 7) / 4) + 0.06 * n2(t + 0.5) * (i / 11), s[2]] as V3);
      return b;
    },
    tailSim: { wBase: 30, wTip: 12, zeta: 0.6 },
    stance: ctx => Object.fromEntries(LEGS.map(id => [id, [[0, ctx.T]]])),
  };
}

/** Swing toe z between two planted positions with ground-matched end velocities (in-place m/s backward). */
const swingZ = (s: number, z0: number, z1: number, v0: number, v1: number, Tsw: number, match: number) => hermite(z0, z1, -v0 * Tsw, -v1 * Tsw * match, s);

/**
 * Walk liftoff times inside start (walk phase 0.75 + t^2) and stop (walk phase t - t^2): the left forepaw's walk
 * liftoff during start and the right hind's during stop (catalog contacts LH 0, LF .25, RH .5, RF .75).
 */
function times(style: GaitStyle) {
  const liftLF = ((style.contacts.LF + style.duty) % 1 + 1) % 1, liftRH = ((style.contacts.RH + style.duty) % 1 + 1) % 1;
  return { startLiftLF: Math.sqrt(clamp(liftLF - 0.75, 0.01, 0.24)), stopLiftRH: (1 - Math.sqrt(1 - 4 * clamp(liftRH, 0.01, 0.24))) / 2 };
}

/** Idle to walk phase 0 (start) or walk phase 0 to idle (stop) on the walk's footfall schedule. */
function startStopClip(name: string, starting: boolean): ClipSpec {
  // Walk phase as a function of time: speed ramps linearly 0 -> walk (start) or walk -> 0 (stop).
  const phi = (t: number) => (starting ? 0.75 + t * t : t - t * t);
  const speedAt = (t: number, v: number) => v * (starting ? 2 * t : 1 - 2 * t);
  return {
    name,
    body: (t, ctx) => {
      const { plan, foot } = walkFoot(ctx), { style, v, S } = plan, T = ctx.T, rig = ctx.rig, sH = ctx.M.shoulderH;
      const G = (x: number) => plan.v * style.T * (starting ? phi(x) - 0.75 : phi(x));
      const ph = phi(t);
      const walk = gaitBody(rig, plan, ((ph % 1) + 1) % 1);
      const idle = idleBody({ ...ctx, clip: ctx.catalog.clips.find(c => c.name === 'cat.loco.idle')! });
      const w = starting ? smooth(t / T) : 1 - smooth(t / T);
      const b = mixBody(idle, walk, w);
      const Tsw = (1 - style.duty) * style.T;
      const walkStanceLeg = (id: LegId, z: number) => {
        const L = baseLeg(rig, id, plan.x[id], z, style);
        const lp = legPhase(style, id, ((ph % 1) + 1) % 1);
        stanceLeg(rig, style, L, id, lp.stance ? lp.s : lp.s < 0.5 ? 1 : 0);
        // Fade the walk's heel peel in or out with the gait.
        const st = idle.legs[id];
        L.meta = st.meta + (L.meta - st.meta) * w; L.dig = st.dig + (L.dig - st.dig) * w;
        return L;
      };
      for (const id of LEGS) {
        let L: Leg;
        if (starting) {
          if (id === 'RH') L = walkStanceLeg(id, foot.RH[2] - G(t));
          else if (id === 'RF') {
            // First paw to move: a short step from the idle stance onto the walk track.
            const t0 = 0.02, t1 = 0.22, zLand = plan.zTd.RF - S * (phi(t1) - 0.75) / style.duty;
            if (t <= t0) L = walkStanceLeg(id, foot.RF[2] - G(t));
            else if (t < t1) { L = walkStanceLeg(id, 0); stepLeg(rig, L, id, t, t0, t1, [plan.x.RF, foot.RF[1], foot.RF[2] - G(t0)], [plan.x.RF, foot.RF[1], zLand], 0.07 * sH, 1.4); }
            else L = walkStanceLeg(id, zLand - (G(t) - G(t1)));
          } else if (id === 'LH') {
            const t0 = 0.17, z0 = foot.LH[2] - G(t0);
            if (t <= t0) L = walkStanceLeg(id, foot.LH[2] - G(t));
            else {
              L = baseLeg(rig, id, plan.x.LH, 0, style);
              const s = (t - t0) / (T - t0);
              swingLeg(rig, style, L, id, s, z0, plan.zTd.LH, v, (T - t0), plan.lift.LH, plan.land.LH);
              L.toe[2] = swingZ(s, z0, plan.zTd.LH, speedAt(t0, v), v, T - t0, style.matchTd);
            }
          } else {
            // LF: planted until its walk liftoff, then the walk swing with the liftoff point blended in.
            const tl = times(style).startLiftLF, zl = foot.LF[2] - G(tl), pl = phi(tl);
            if (t <= tl) L = walkStanceLeg(id, foot.LF[2] - G(t));
            else {
              L = baseLeg(rig, id, plan.x.LF, 0, style);
              const s = (ph - pl) / (1 - style.duty);
              swingLeg(rig, style, L, id, s, plan.zTd.LF - S, plan.zTd.LF, v, Tsw, plan.lift.LF, plan.land.LF);
              L.toe[2] += (zl - (plan.zTd.LF - S)) * (1 - smooth(s / 0.34));
            }
          }
        } else {
          if (id === 'LH') L = walkStanceLeg(id, plan.zTd.LH - G(t));
          else if (id === 'RF') {
            const sRF = legPhase(style, 'RF', 0).s, t0 = 0.27, t1 = 0.46, z0 = plan.zTd.RF - sRF * S - G(t0);
            if (t <= t0) L = walkStanceLeg(id, plan.zTd.RF - sRF * S - G(t));
            else if (t < t1) { L = walkStanceLeg(id, 0); stepLeg(rig, L, id, t, t0, t1, [plan.x.RF, foot.RF[1], z0], [foot.RF[0], foot.RF[1], foot.RF[2] + G(T) - G(t1)], 0.05 * sH, 1.2); }
            else L = walkStanceLeg(id, foot.RF[2] + G(T) - G(t));
          } else if (id === 'RH') {
            // Hind paw comes under: walk liftoff, then a shortening step to the idle stance.
            const t0 = times(style).stopLiftRH, t1 = 0.4, sRH = legPhase(style, 'RH', 0).s, z0 = plan.zTd.RH - sRH * S - G(t0);
            if (t <= t0) L = walkStanceLeg(id, plan.zTd.RH - sRH * S - G(t));
            else if (t < t1) {
              L = baseLeg(rig, id, plan.x.RH, 0, style);
              const s = (t - t0) / (t1 - t0);
              const zl = foot.RH[2] + G(T) - G(t1);
              swingLeg(rig, style, L, id, s, z0, zl, speedAt(t0, v), (t1 - t0), plan.lift.RH, plan.land.RH);
              L.toe[2] = swingZ(s, z0, zl, speedAt(t0, v), speedAt(t1, v), t1 - t0, 1);
              L.toe[1] = foot.RH[1] + (L.toe[1] - foot.RH[1]) * 0.75;
            } else L = walkStanceLeg(id, foot.RH[2] + G(T) - G(t));
          } else {
            // LF: finishes its swing early and sets down on the idle stance.
            const t1 = 0.24, s0 = legPhase(style, 'LF', 0).s;
            if (t < t1) {
              L = baseLeg(rig, id, plan.x.LF, 0, style);
              const s = s0 + (1 - s0) * (t / t1);
              swingLeg(rig, style, L, id, s, plan.zTd.LF - S, plan.zTd.LF, v, Tsw, plan.lift.LF, plan.land.LF);
              L.toe[2] += (foot.LF[2] + G(T) - G(t1) - plan.zTd.LF) * smooth((s - s0) / (1 - s0));
            } else L = walkStanceLeg(id, foot.LF[2] + G(T) - G(t));
          }
        }
        b.legs[id] = L;
      }
      // The head lowers a touch as weight moves forward (start), lifts as the cat settles (stop).
      b.gaze[0] += starting ? -0.05 * bump(t / T, 0.1, 0.4, 0.8, 1.2) : 0.04 * bump(t / T, 0.4, 0.8, 1, 1.1);
      return b;
    },
    tailSim: { wBase: 30, wTip: 11, zeta: 0.55 },
    groundSpeed: (t, ctx) => speedAt(t, walkFoot(ctx).plan.v),
    stance: ctx => {
      const tt = times(walkFoot(ctx).plan.style);
      return (starting
        ? { RH: [[0, 0.5]], RF: [[0, 0.02], [0.22, 0.5]], LH: [[0, 0.17]], LF: [[0, tt.startLiftLF]] }
        : { LH: [[0, 0.5]], RH: [[0, tt.stopLiftRH], [0.4, 0.5]], LF: [[0.24, 0.5]], RF: [[0, 0.27], [0.46, 0.5]] }) as Stance;
    },
    extras: ctx => ({ rigSpeed: round(walkFoot(ctx).plan.v / 2), speedProfile: starting ? 'linear 0 to walk speed' : 'linear walk speed to 0' }),
  };
}

// ---------------------------------------------------------------- turns (authored left, mirrored right)

const TURN_STEPS: [LegId, number, number][] = [
  ['LF', 0.05, 0.25], ['RH', 0.12, 0.3], ['RF', 0.2, 0.4], ['LH', 0.3, 0.47],
  ['LF', 0.38, 0.58], ['RH', 0.46, 0.63], ['RF', 0.53, 0.72], ['LH', 0.6, 0.77],
];
const turnYaw = (t: number) => 90 * DEG * curve([[0, 0], [0.06, 0], [0.2, 0.17], [0.45, 0.6], [0.62, 0.88], [0.74, 0.99], [0.8, 1]])(t);

function turnBody(ctx: Ctx, t: number): Body {
  const b = idleBody(ctx), foot = walkFoot(ctx).foot, k = ctx.M.legScale, sH = ctx.M.shoulderH;
  const psi = turnYaw(t);
  b.rootYaw = psi;
  const rot = (p: V3, a: number): V3 => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
  for (const id of LEGS) {
    const steps = TURN_STEPS.filter(s => s[0] === id).sort((a, c) => a[1] - c[1]);
    let yawNow = 0, pos = foot[id], airborne = false;
    const L = b.legs[id], front = id[1] === 'F';
    for (let i = 0; i < steps.length; i++) {
      const [, t0, t1] = steps[i]!;
      const target = i === steps.length - 1 ? 90 * DEG : Math.min(90 * DEG, turnYaw(t1 + 0.05));
      const to = rot(foot[id], target);
      if (t >= t1) { pos = to; yawNow = target; continue; }
      if (t > t0) {
        stepLeg(ctx.rig, L, id, t, t0, t1, pos, to, (front ? 0.08 : 0.055) * sH, front ? 1.3 : 1.1);
        L.yaw = yawNow + (target - yawNow) * smooth((t - t0) / (t1 - t0));
        airborne = true;
      }
      break;
    }
    if (!airborne) { L.toe = [...pos]; L.yaw = yawNow; }
  }
  // Head and gaze lead, the shoulders follow, the pelvis lags.
  const lead = bump(t, 0.0, 0.16, 0.38, 0.68), chest = bump(t, 0.05, 0.26, 0.48, 0.78);
  b.gaze = [-0.05, 0.42 * lead, 0.06 * lead, 0.95];
  b.eyes = [0.22 * bump(t, 0, 0.07, 0.18, 0.32), 0, 0.22 * bump(t, 0, 0.07, 0.18, 0.32), 0];
  b.pelvis[1] -= 0.16 * chest;
  b.spine = b.spine.map((s, i) => [s[0], s[1] + 0.46 * chest * [0.12, 0.18, 0.22, 0.24, 0.24][i]!, s[2] - 0.04 * chest] as V3);
  b.pelvisOff[0] -= 0.01 * k * chest;
  b.tail = standTail().map((s, i) => [s[0], s[1] - 0.25 * chest * (i / 11), s[2]] as V3);
  b.earL[0] -= 0.22 * lead; b.earR[0] += 0.14 * lead;
  return b;
}

function turnStance(): Stance {
  const out: Stance = {};
  for (const id of LEGS) {
    const steps = TURN_STEPS.filter(s => s[0] === id).sort((a, b) => a[1] - b[1]);
    const iv: [number, number][] = [];
    let from = 0;
    for (const [, t0, t1] of steps) { iv.push([from, t0]); from = t1; }
    iv.push([from, 0.8]);
    out[id] = iv;
  }
  return out;
}

export function mirrorStance(s: Stance): Stance {
  return { LF: s.RF, RF: s.LF, LH: s.RH, RH: s.LH };
}

export const locoClips: ClipSpec[] = [
  idleClip(),
  gaitClip('cat.loco.walk', walkStyle),
  gaitClip('cat.loco.trot', trotStyle, { wBase: 34, wTip: 18, zeta: 0.8 }),
  gaitClip('cat.loco.gallop', gallopStyle, { wBase: 38, wTip: 22, zeta: 0.85 }),
  gaitClip('cat.react.walk_away', walkAwayStyle, { wBase: 30, wTip: 15, zeta: 0.65 }),
  startStopClip('cat.loco.start', true),
  startStopClip('cat.loco.stop', false),
  { name: 'cat.loco.turn_left', body: (t, ctx) => turnBody(ctx, t), tailSim: { wBase: 28, wTip: 10, zeta: 0.55 }, stance: turnStance },
  { name: 'cat.loco.turn_right', body: (t, ctx) => mirrorBody(turnBody(ctx, t)), tailSim: { wBase: 28, wTip: 10, zeta: 0.55 }, stance: () => mirrorStance(turnStance()) },
];
