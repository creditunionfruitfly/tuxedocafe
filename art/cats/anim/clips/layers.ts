// Additive layers (tail, ears, purr breathing, skin twitch, lean-in). Each is an offset from a documented
// reference frame (extras.additiveReference "clip@seconds"); keys are reference x offset on the catalogued
// bones only, so subtracting the reference recovers the layer.
import { Quaternion } from 'three';
import type { ClipSpec } from '../catalog.ts';
import { tailRotations } from '../body.ts';
import { type V3, AX, AY, AZ, bump, curve, loopCurve, pulse, qAxis, qBody, smooth } from '../math.ts';
import { breath, tailShape } from '../poses.ts';
import type { Pose, Rig } from '../rig.ts';

const TAU = Math.PI * 2;
const tailNames = Array.from({ length: 12 }, (_, i) => `tail_${String(i + 1).padStart(2, '0')}`);

/** Offsets that take the reference tail to a target shape (per-joint [lift, toRight, twist]). */
function tailTo(rig: Rig, ref: Pose, shape: V3[], from = 0): Record<string, Quaternion> {
  const out: Record<string, Quaternion> = {}, rotations = tailRotations(rig, shape);
  for (let i = from; i < 12; i++) {
    const idx = rig.index(tailNames[i]!);
    out[tailNames[i]!] = ref.q[idx]!.clone().invert().multiply(rotations[i]!);
  }
  return out;
}

/** Ear rotation as the body solver builds it: [swivel back, flatten outward, tilt forward] and tip bend. */
const earQ = (s: 1 | -1, e: V3) => qAxis(AZ, -s * e[1]).multiply(qAxis(AX, e[2])).multiply(qAxis(AY, s * e[0]));
const tipQ = (s: 1 | -1, f: number, o: number) => qAxis(AX, f).multiply(qAxis(AZ, -s * o));
function earsTo(rig: Rig, ref: Pose, L: V3, R: V3, tipL: [number, number] = [0, 0], tipR: [number, number] = [0, 0]): Record<string, Quaternion> {
  const rel = (name: string, q: Quaternion) => ref.q[rig.index(name)]!.clone().invert().multiply(q);
  return {
    ear_L_01: rel('ear_L_01', earQ(1, L)), ear_R_01: rel('ear_R_01', earQ(-1, R)),
    ear_L_02: rel('ear_L_02', tipQ(1, ...tipL)), ear_R_02: rel('ear_R_02', tipQ(-1, ...tipR)),
  };
}

export const layerClips: ClipSpec[] = [
  {
    // Friendly, confident: the tail stands vertical with a soft tip curl that sways a little.
    name: 'cat.layer.tail_up',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: (t, ctx, ref) => {
        const sway = loopCurve([[0, 0], [0.3, 0.6], [0.55, 0.2], [0.8, -0.5]])(t / 2);
        const curl = 0.85 + 0.1 * Math.sin(TAU * (t / 2 + 0.2));
        return tailTo(ctx.rig, ref, tailShape({ base: 1.32, lift: 0.22, tip: curl, tipSide: 0.18 * sway, side: 0.06 * sway }));
      },
    },
  },
  {
    // Uncertain: low and close to the hocks, barely moving.
    name: 'cat.layer.tail_low',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: (t, ctx, ref) => tailTo(ctx.rig, ref, tailShape({ base: -0.95, lift: -0.25, tip: 0.18, side: 0.04 * Math.sin(TAU * t / 2) })),
    },
  },
  {
    // Overstimulated: fast side-to-side lashing driven from the base, the wave travelling to the tip.
    name: 'cat.layer.tail_lash',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: t => {
        const T = 0.8, out: Record<string, Quaternion> = {};
        tailNames.forEach((n, i) => {
          // Asymmetric stroke: a quicker sweep one way, a slower return; amplitude grows along the tail.
          const ph = t / T - i * 0.045;
          const yaw = (0.2 + 0.05 * i / 11) * (Math.sin(TAU * ph) + 0.25 * Math.sin(2 * TAU * ph + 0.6));
          const lift = i === 0 ? 0.1 : 0.015;
          out[n] = qAxis(AY, yaw).multiply(qAxis(AX, lift));
        });
        return out;
      },
    },
  },
  {
    // Attentive or mildly annoyed: only the last third flicks, once per loop, with a quick snap and a slower return.
    name: 'cat.layer.tail_flick',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: t => {
        const out: Record<string, Quaternion> = {};
        tailNames.slice(6).forEach((n, k) => {
          const w = (k + 1) / 6, f = pulse(t, 0.35 + k * 0.025, 0.07, 0.12) - 0.35 * pulse(t, 0.6 + k * 0.025, 0.08, 0.14);
          out[n] = qAxis(AY, 0.42 * w * f).multiply(qAxis(AX, 0.12 * w * f));
        });
        return out;
      },
    },
  },
  {
    // Interested: both ears upright and pointed forward, each making small independent adjustments.
    name: 'cat.layer.ears_forward',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: (t, ctx, ref) => {
        const a = 0.05 * Math.sin(TAU * t / 2), b2 = 0.04 * Math.sin(TAU * (t / 2 + 0.37));
        return earsTo(ctx.rig, ref, [-0.22 + a, -0.06, 0.14], [-0.2 + b2, -0.06, 0.14], [0.05, 0], [0.05, 0]);
      },
    },
  },
  {
    // Irritated or frightened: rotated back and flattened sideways (airplane ears), with a restless flutter.
    name: 'cat.layer.ears_back',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: (t, ctx, ref) => {
        const f = 0.06 * Math.sin(TAU * t) + 0.02 * Math.sin(2 * TAU * t + 1), g = 0.06 * Math.sin(TAU * (t + 0.13)) + 0.02 * Math.sin(2 * TAU * (t + 0.13) + 1);
        return earsTo(ctx.rig, ref, [0.8 + f, 0.85, -0.12], [0.8 + g, 0.85, -0.12], [-0.12, 0.1], [-0.12, 0.1]);
      },
    },
  },
  {
    // A single quick twitch of the left ear (the engine alternates sides by mirroring), the right ear sympathetic.
    name: 'cat.layer.ear_twitch',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: t => {
        const w = pulse(t, 0.02, 0.035, 0.05) - 0.25 * pulse(t, 0.12, 0.04, 0.06), s = 0.25 * pulse(t, 0.05, 0.04, 0.05);
        return {
          ear_L_01: qAxis(AY, 0.55 * w).multiply(qAxis(AZ, -0.18 * w)), ear_L_02: qAxis(AX, -0.2 * w),
          ear_R_01: qAxis(AY, -0.15 * s), ear_R_02: new Quaternion(),
        };
      },
    },
  },
  {
    // Purring: slightly deeper, steady breathing in the ribs (two cycles a second would be the purr itself; this is the breath).
    name: 'cat.layer.purr_breath',
    additive: {
      reference: 'cat.rest.sit_idle@0',
      offsets: t => {
        const x = breath(t, 2) - 0.5, hum = 0.004 * Math.sin(TAU * 25 * t / 2);
        return { spine_02: qBody(0.05 * x + hum, 0, 0), spine_03: qBody(0.035 * x, 0, 0), spine_04: qBody(-0.05 * x - hum, 0, 0) };
      },
    },
  },
  {
    // A ripple along the back near the touch threshold: small fast rotations travelling from shoulders to rump.
    name: 'cat.layer.skin_twitch',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: t => {
        const out: Record<string, Quaternion> = {};
        ['spine_05', 'spine_04', 'spine_03', 'spine_02'].forEach((n, k) => {
          const t0 = 0.03 + k * 0.045, w = Math.sin(TAU * 11 * (t - t0)) * bump(t, t0, t0 + 0.04, t0 + 0.12, t0 + 0.25);
          out[n] = qBody(0.03 * w, 0, 0.035 * w);
        });
        return out;
      },
    },
  },
  {
    // Leaning into a stroking hand at the cat's left: head and neck press and roll into it, the body follows a little.
    name: 'cat.layer.lean_in',
    additive: {
      reference: 'cat.loco.idle@0',
      offsets: t => {
        const press = 0.75 + 0.25 * smooth(0.5 + 0.5 * Math.sin(TAU * t / 1.5)), rub = Math.sin(TAU * t / 1.5);
        return {
          spine_04: qBody(0, 0.04 * press, -0.05 * press),
          neck_01: qBody(-0.04 * press, 0.12 * press + 0.03 * rub, -0.1 * press),
          neck_02: qBody(-0.03 * press, 0.1 * press + 0.03 * rub, -0.12 * press),
          head: qBody(0.06 * press, 0.08 * press, -0.22 * press - 0.06 * rub),
        };
      },
    },
  },
];

void curve;
