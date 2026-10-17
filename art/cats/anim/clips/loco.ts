// Locomotion clips: idle, walk, trot, gallop, turns, start, stop, walk away.
import { type Body, mirrorBody, mixBody } from '../body.ts';
import type { ClipSpec, Ctx, Stance } from '../catalog.ts';
import { type GaitPlan, type GaitStyle, baseLeg, fitGait, gaitBody, gaitStance, legPhase, planGait, stanceLeg, swingLeg } from '../gait.ts';
import { type V3, DEG, bump, curve, loopCurve, loopNoise, pulse, smooth, wrap01 } from '../math.ts';
import { addBreath, earFlick, setTrunk, standBody, step, STANCE_WIDTH } from '../poses.ts';
import { LEGS, type LegId } from '../rig.ts';

const plans = new Map<string, GaitPlan>();
const round = (x: number) => Math.round(x * 1000) / 1000;
const contacts = (ctx: Ctx) => ctx.clip.contacts as Record<LegId, number>;

/** The fitted plan for a gait clip (cached per clip). */
export function gaitPlan(name: string, style: (ctx: Ctx) => GaitStyle, ctx: Ctx): GaitPlan {
  let plan = plans.get(name);
  if (!plan) {
    const fitted = fitGait(ctx.rig, style(ctx));
    plans.set(name, plan = planGait(ctx.rig, fitted, fitted.fit));
  }
  return plan;
}

const ctxFor = (ctx: Ctx, name: string): Ctx => {
  const clip = ctx.catalog.clips.find(c => c.name === name)!;
  return { ...ctx, clip, T: clip.durationS };
};

export function gaitClip(name: string, style: (ctx: Ctx) => GaitStyle, tailSim = { wBase: 30, wTip: 14, zeta: 0.7 },
  decorate?: (b: Body, t: number, ctx: Ctx) => Body): ClipSpec {
  return {
    name,
    body: (t, ctx) => { const b = gaitBody(ctx.rig, gaitPlan(name, style, ctx), t / ctx.T); return decorate ? decorate(b, t, ctx) : b; },
    tailSim,
    stance: ctx => gaitStance(gaitPlan(name, style, ctx).style),
    groundSpeed: (_t, ctx) => gaitPlan(name, style, ctx).v,
    extras: ctx => {
      const plan = gaitPlan(name, style, ctx);
      return { rigSpeed: round(plan.v), strideFit: plan.fit, legScale: round(ctx.M.legScale), stanceLengthM: round(plan.S) };
    },
  };
}

// ---------------------------------------------------------------- gait styles

const walkTail = (i: number, phase: number): V3 => {
  const lift = i === 0 ? -0.28 : i < 6 ? -0.11 : 0.075;
  const side = (0.035 * Math.sin(2 * Math.PI * (phase - 0.1)) + 0.012 * Math.sin(4 * Math.PI * phase + 0.8)) * (0.4 + i / 11);
  return [lift, side, 0];
};

export const walkStyle = (ctx: Ctx): GaitStyle => ({
  T: ctx.T, speed: ctx.clip.authoredSpeed ?? 0.7, contacts: contacts(ctx), duty: ctx.clip.dutyFactor ?? 0.62,
  dropF: 0.06, dropH: 0.04, liftF: 0.12, liftH: 0.085, flexF: 1.0, flexH: 0.55, rollF: 0.45, rollH: 0.3,
  register: 0.005, frontBias: -0.25, hindBias: -0.15, width: STANCE_WIDTH, bob: 0.03, roll: 0.05, yaw: 0.07, headPitch: -0.07, headBob: 0.25,
  skewF: 0.85, skewH: 1, ears: [0, 0, 0.04], tail: walkTail, spinePitch: 0, flex: 0.96, seed: ctx.seed,
});

const trotStyle = (ctx: Ctx): GaitStyle => ({
  ...walkStyle(ctx), speed: ctx.clip.authoredSpeed ?? 1.6, contacts: contacts(ctx), duty: ctx.clip.dutyFactor ?? 0.45,
  dropF: 0.045, dropH: 0.035, liftF: 0.15, liftH: 0.12, flexF: 1.25, flexH: 0.75, rollF: 0.55, rollH: 0.4,
  register: 0.02, frontBias: -0.15, hindBias: -0.2, bob: 0.04, roll: 0.04, yaw: 0.05, headPitch: -0.05, headBob: 0.12,
  skewF: 0.8, skewH: 0.9, ears: [0.05, 0, 0.06], flex: 0.95,
  tail: (i, phase) => [i === 0 ? -0.1 : i < 7 ? -0.03 : 0.05, 0.05 * Math.sin(2 * Math.PI * (2 * phase - 0.15)) * (0.3 + i / 11) + 0.02 * Math.sin(2 * Math.PI * phase), 0],
});

// Rotary gallop: spine flexion is the engine of the stride (gathered, then extended phases).
const gallopFlex = loopCurve([[0, 0.55], [0.12, 0.38], [0.28, -0.1], [0.4, -0.42], [0.5, -0.32], [0.64, 0.05], [0.8, 0.45], [0.92, 0.62]]);
const gallopPitch = loopCurve([[0, 0.02], [0.18, 0.1], [0.36, 0.06], [0.5, -0.06], [0.68, -0.1], [0.86, -0.02]]);
const gallopRise = loopCurve([[0, 0.0], [0.2, -0.03], [0.42, 0.05], [0.58, -0.01], [0.74, -0.04], [0.92, 0.04]]);
const gallopSurge = loopCurve([[0, 0.06], [0.25, 0.02], [0.45, -0.06], [0.65, -0.03], [0.85, 0.04]]);
const gallopStyle = (ctx: Ctx): GaitStyle => ({
  ...walkStyle(ctx), speed: ctx.clip.authoredSpeed ?? 3.5, contacts: contacts(ctx), duty: ctx.clip.dutyFactor ?? 0.3,
  dropF: 0.07, dropH: 0.06, liftF: 0.2, liftH: 0.17, flexF: 1.45, flexH: 0.95, rollF: 0.7, rollH: 0.55,
  register: -0.06, frontBias: 0.05, hindBias: 0.1, width: STANCE_WIDTH * 0.85, bob: 0.0, roll: 0.03, yaw: 0.03,
  headPitch: -0.08, headBob: 0.0, skewF: 0.75, skewH: 0.8, ears: [0.55, 0.3, -0.05], flex: 0.9,
  trunk: p => { const f = gallopFlex(p); return [f * 0.5 + gallopPitch(p), f, gallopRise(p), gallopSurge(p)]; },
  tail: (i, phase) => [i === 0 ? -0.05 : i < 6 ? -0.025 : 0.01, 0.03 * Math.sin(2 * Math.PI * (phase - i * 0.04)) * (i / 11), 0],
});

const walkAwayStyle = (ctx: Ctx): GaitStyle => ({
  ...walkStyle(ctx), speed: ctx.clip.authoredSpeed ?? 0.85, contacts: contacts(ctx), duty: ctx.clip.dutyFactor ?? 0.6,
  dropF: 0.05, dropH: 0.035, liftF: 0.09, liftH: 0.065, flexF: 0.8, flexH: 0.42, rollF: 0.35, rollH: 0.25,
  bob: 0.018, roll: 0.03, yaw: 0.04, headPitch: -0.03, headBob: 0.1, skewF: 0.9, ears: [0.75, 0.35, -0.08], flex: 0.98,
  tail: (i, phase) => {
    const flick = Math.max(pulse(phase, 0.28, 0.04, 0.05), pulse(phase, 0.78, 0.04, 0.06) * 0.7) * smooth((i - 6) / 5);
    return [i === 0 ? -0.75 : i < 6 ? -0.06 : 0.04, 0.5 * flick + 0.02 * Math.sin(2 * Math.PI * phase) * (i / 11), 0];
  },
});

// ---------------------------------------------------------------- idle, start and stop share one footprint

/** Walk plan, ground travel during start/stop, and the idle footprint that makes start, walk and stop line up. */
export function walkFoot(ctx: Ctx) {
  const wctx = ctxFor(ctx, 'cat.loco.walk');
  const plan = gaitPlan('cat.loco.walk', walkStyle, wctx);
  const D = 0.5 * plan.v * 0.5; // start and stop both cover half the walk speed over 0.5 s
  const foot = {} as Record<LegId, V3>;
  for (const id of LEGS) {
    const d = ctx.rig.legs[id];
    foot[id] = [plan.x[id], d.padY, d.front ? d.restToe.z : plan.zTd[id] - D];
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
      // Weight drifts between fore and hind, and a little side to side, over the planted paws.
      setTrunk(ctx.rig, b, {
        pelvisDrop: (0.035 + 0.008 * n2(t + 0.6)) * M.shoulderH, chestDrop: (0.05 + 0.01 * n1(t + 1.3)) * M.shoulderH,
        surge: 0.008 * k * n1(t), lateral: 0.005 * k * n2(t), roll: 0.02 * n2(t + 0.3),
      });
      addBreath(b, t, 2, 0.03);
      // Gaze holds, then shifts quickly (head follows the eyes), returning to rest for the loop.
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

const vStart = (u: number) => smooth(u), gStart = (u: number) => u ** 3 - u ** 4 / 2;
const vStop = (u: number) => 1 - smooth(u), gStop = (u: number) => u - u ** 3 + u ** 4 / 2;

/** Idle to walk phase 0 (start) or walk phase 0 to idle (stop) with the walk's footfall schedule. */
function startStopClip(name: string, starting: boolean): ClipSpec {
  const G = (t: number, ctx: Ctx, v: number) => v * ctx.T * (starting ? gStart(t / ctx.T) : gStop(t / ctx.T));
  return {
    name,
    body: (t, ctx) => {
      const { plan, foot } = walkFoot(ctx), { style, v, S } = plan, T = ctx.T, rig = ctx.rig;
      const Gt = G(t, ctx, v), GT = G(T, ctx, v), Tsw = (1 - style.duty) * style.T;
      const phase = starting ? t + 0.5 : t; // walk phase (walk T = 1 s)
      const walk = gaitBody(rig, plan, wrap01(phase));
      const idle = idleBody({ ...ctx, clip: ctx.catalog.clips.find(c => c.name === 'cat.loco.idle')! });
      const w = starting ? smooth(t / T) : 1 - smooth(t / T);
      const b = mixBody(idle, walk, w);
      for (const id of LEGS) {
        const L = baseLeg(rig, id, plan.x[id], 0, style.flex);
        const zEnd = (zAtEnd: number) => zAtEnd + (GT - Gt); // planted paw that reaches zAtEnd at t = T
        if (starting) {
          if (id === 'RH') { L.toe[2] = zEnd(plan.zTd.RH - legPhase(style, 'RH', 0).s * S); stanceLeg(rig, style, L, id, legPhase(style, 'RH', phase).s); }
          else if (id === 'RF') {
            const touch = 0.25, zTouch = (plan.zTd.RF - legPhase(style, 'RF', 0).s * S) + (GT - G(touch, ctx, v));
            if (t < touch) {
              const st = step(t, 0.04, touch, [foot.RF[0], foot.RF[1], foot.RF[2] - G(0.04, ctx, v)], [plan.x.RF, foot.RF[1], zTouch], 0.09 * ctx.M.shoulderH);
              L.toe = st.pos; if (t < 0.04) L.toe[2] = foot.RF[2] - Gt;
              if (st.air) { const f = Math.sin(Math.PI * st.s); L.heel += 0.9 * f; L.toeP = 1.1 * f; }
            } else { L.toe[2] = zTouch - (Gt - G(touch, ctx, v)); stanceLeg(rig, style, L, id, legPhase(style, 'RF', phase).s); }
          } else {
            const lift = id === 'LH' ? 0.12 : 0.37;
            if (t <= lift) { L.toe[2] = foot[id][2] - Gt; stanceLeg(rig, style, L, id, legPhase(style, id, phase).s); }
            else {
              const s = (t - lift) / Tsw, zLift = foot[id][2] - G(lift, ctx, v);
              const zLo = plan.zTd[id] - S, zTd = plan.zTd[id];
              swingLeg(rig, style, L, id, s, zLo, zTd, v, v, Tsw);
              const s1 = id === 'LH' ? 1 : (0.5 - lift) / Tsw;
              L.toe[2] += (1 - Math.min(1, s / s1)) * (zLift - zLo);
            }
          }
        } else {
          const restEnd = foot[id][2];
          if (id === 'LH') { L.toe[2] = zEnd(restEnd); stanceLeg(rig, style, L, id, 0.1 * t / T); }
          else if (id === 'RH') {
            const lift = 0.12, z0 = plan.zTd.RH - legPhase(style, 'RH', 0).s * S;
            if (t <= lift) { L.toe[2] = z0 - Gt; stanceLeg(rig, style, L, id, legPhase(style, 'RH', t).s); }
            else swingLeg(rig, style, L, id, Math.min(1, (t - lift) / (T - lift)), z0 - G(lift, ctx, v), restEnd, v * vStop(lift / T), 0, T - lift);
          } else if (id === 'LF') {
            const s0 = legPhase(style, 'LF', 0).s, touch = 0.25;
            const zTouch = restEnd + (GT - G(touch, ctx, v));
            if (t < touch) {
              const s = s0 + (1 - s0) * t / touch;
              swingLeg(rig, style, L, id, s, plan.zTd.LF - S, plan.zTd.LF, v, vStop(touch / T) * v, Tsw);
              L.toe[2] += smooth(t / touch) * (zTouch - plan.zTd.LF);
            } else { L.toe[2] = zTouch - (Gt - G(touch, ctx, v)); stanceLeg(rig, style, L, id, 0); }
          } else {
            const lift = 0.3, touch = 0.47, s0 = legPhase(style, 'RF', 0).s;
            const zLift = plan.zTd.RF - s0 * S - G(lift, ctx, v);
            if (t <= lift) { L.toe[2] = plan.zTd.RF - s0 * S - Gt; stanceLeg(rig, style, L, id, legPhase(style, 'RF', t).s); }
            else if (t < touch) {
              const st = step(t, lift, touch, [plan.x.RF, foot.RF[1], zLift], [foot.RF[0], foot.RF[1], restEnd + (GT - G(touch, ctx, v))], 0.07 * ctx.M.shoulderH);
              const heelLift = stanceLeg(rig, style, baseLeg(rig, id, 0, 0, 1), id, legPhase(style, 'RF', lift).s).heel;
              L.toe = st.pos; const f = Math.sin(Math.PI * st.s);
              L.heel = heelLift + (L.heel - heelLift) * smooth(st.s * 1.4) + 0.7 * f; L.toeP = 0.9 * f;
            } else L.toe[2] = restEnd + (GT - Gt);
          }
        }
        b.legs[id] = L;
      }
      // The head lowers a touch as weight moves forward (start), lifts as the cat settles (stop).
      b.gaze[0] += (starting ? -0.05 * bump(t / T, 0.1, 0.4, 0.8, 1.2) : 0.04 * bump(t / T, 0.4, 0.8, 1, 1.1));
      return b;
    },
    tailSim: { wBase: 30, wTip: 11, zeta: 0.55 },
    groundSpeed: (t, ctx) => walkFoot(ctx).plan.v * (starting ? vStart(t / ctx.T) : vStop(t / ctx.T)),
    stance: ctx => (starting
      ? { RH: [[0, 0.5]], RF: [[0, 0.04], [0.25, 0.5]], LH: [[0, 0.12]], LF: [[0, 0.37]] }
      : { LH: [[0, 0.5]], RH: [[0, 0.12]], LF: [[0.25, 0.5]], RF: [[0, 0.3], [0.47, 0.5]] }) as Stance,
    extras: ctx => ({ rigSpeed: round(walkFoot(ctx).plan.v / 2), legScale: round(ctx.M.legScale), speedProfile: starting ? 'smoothstep 0 to walk' : 'smoothstep walk to 0' }),
  };
}

// ---------------------------------------------------------------- turns (authored left, mirrored right)

const TURN_STEPS: [LegId, number, number][] = [
  ['LF', 0.04, 0.24], ['RH', 0.1, 0.3], ['RF', 0.18, 0.38], ['LH', 0.28, 0.47],
  ['LF', 0.38, 0.57], ['RH', 0.45, 0.64], ['RF', 0.52, 0.72], ['LH', 0.6, 0.78],
];
const turnYaw = (t: number) => 90 * DEG * curve([[0, 0], [0.06, 0], [0.2, 0.18], [0.45, 0.6], [0.62, 0.88], [0.74, 1], [0.8, 1]])(t);

function turnBody(ctx: Ctx, t: number): Body {
  const b = idleBody(ctx), foot = walkFoot(ctx).foot, k = ctx.M.legScale;
  const psi = turnYaw(t);
  b.rootYaw = psi;
  const rot = (p: V3, a: number): V3 => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
  for (const id of LEGS) {
    const steps = TURN_STEPS.filter(s => s[0] === id).sort((a, c) => a[1] - c[1]);
    let yawNow = 0, pos = foot[id], airborne = false;
    const L = b.legs[id];
    for (let i = 0; i < steps.length; i++) {
      const [, t0, t1] = steps[i]!;
      const target = i === steps.length - 1 ? 90 * DEG : Math.min(90 * DEG, turnYaw(t1 + 0.05));
      const to = rot(foot[id], target);
      if (t >= t1) { pos = to; yawNow = target; continue; }
      if (t > t0) {
        const st = step(t, t0, t1, pos, to, (id[1] === 'F' ? 0.08 : 0.05) * ctx.M.shoulderH);
        L.toe = st.pos; L.yaw = yawNow + (target - yawNow) * smooth(st.s);
        const f = Math.sin(Math.PI * st.s);
        L.heel += (id[1] === 'F' ? 0.8 : 0.5) * f; L.toeP = (id[1] === 'F' ? 1.0 : 0.6) * f;
        airborne = true;
      }
      break;
    }
    if (!airborne) { L.toe = [...pos]; L.yaw = yawNow; }
  }
  // Head and gaze lead, the shoulders follow, the pelvis lags.
  const lead = bump(t, 0.0, 0.18, 0.4, 0.7), chest = bump(t, 0.06, 0.28, 0.5, 0.78);
  b.gaze = [-0.05, psi + 0.42 * lead, 0.06 * lead, 0.95];
  b.eyes = [0.2 * bump(t, 0, 0.08, 0.2, 0.35), 0, 0.2 * bump(t, 0, 0.08, 0.2, 0.35), 0];
  b.pelvis[1] -= 0.16 * chest;
  b.spine = b.spine.map((s, i) => [s[0], s[1] + 0.48 * chest * [0.12, 0.18, 0.22, 0.24, 0.24][i]!, s[2] - 0.05 * chest] as V3);
  b.pelvisOff[0] -= 0.012 * k * chest;
  b.tail = b.tail.map((s, i) => [s[0], s[1] - 0.25 * chest * (i / 11), s[2]] as V3);
  b.earL[0] -= 0.25 * lead; b.earR[0] += 0.15 * lead;
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

export function mirrorStance(s: Stance): Stance {
  return { LF: s.RF, RF: s.LF, LH: s.RH, RH: s.LH };
}
