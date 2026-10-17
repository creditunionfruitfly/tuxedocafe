// Small deterministic math kit for the cat animation generator: easing, splines,
// seeded noise and quaternion helpers. No Math.random and no wall-clock time.
import { Matrix4, Quaternion, Vector3 } from 'three';

export type V3 = [number, number, number];
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const v3lerp = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const v3add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const v3scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const wrap01 = (x: number) => x - Math.floor(x);
/** Signed angle wrap into (-PI, PI]. */
export const wrapPi = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);

/** 0..1 ramp between a and b. */
export const ramp = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
export const smooth = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
export const smoother = (t: number) => { const x = clamp(t, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };
export const easeOut = (t: number, p = 2) => 1 - Math.pow(1 - clamp(t, 0, 1), p);
export const easeIn = (t: number, p = 2) => Math.pow(clamp(t, 0, 1), p);
/** Smooth window: rises over [a,b], holds, falls over [c,d]. */
export const bump = (t: number, a: number, b: number, c: number, d: number) =>
  smooth(ramp(t, a, b)) * (1 - smooth(ramp(t, c, d)));
/** Fast attack, slow decay pulse starting at t0 (twitches, flicks). */
export const pulse = (t: number, t0: number, attack: number, decay: number) => {
  if (t < t0) return 0;
  if (t < t0 + attack) return smooth((t - t0) / attack);
  return Math.exp(-(t - t0 - attack) / decay) * (1 - smooth((t - t0 - attack - 4 * decay) / decay));
};
/** Damped oscillation after t0 (settles, overshoots). */
export const ring = (t: number, t0: number, freqHz: number, decay: number) =>
  t < t0 ? 0 : Math.sin(TAU * freqHz * (t - t0)) * Math.exp(-(t - t0) / decay);

/** Monotone cubic (Fritsch-Carlson) through [t, v] keys, held flat beyond the ends. */
export function curve(keys: readonly (readonly [number, number])[]): (t: number) => number {
  const n = keys.length;
  const xs = keys.map(k => k[0]), ys = keys.map(k => k[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i]! / d[i]!, b = m[i + 1]! / d[i]!, s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]!; m[i + 1] = k * b * d[i]!; }
  }
  return (t: number) => {
    if (t <= xs[0]!) return ys[0]!;
    if (t >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (t > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!, s = (t - xs[i]!) / h;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    return h00 * ys[i]! + h10 * h * m[i]! + h01 * ys[i + 1]! + h11 * h * m[i + 1]!;
  };
}

/** Periodic Catmull-Rom spline through [phase, value] keys on [0,1). */
export function loopCurve(keys: readonly (readonly [number, number])[]): (phase: number) => number {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  const n = k.length;
  return (phase: number) => {
    const p = wrap01(phase);
    let i = n - 1;
    for (let j = 0; j < n; j++) if (k[j]![0] <= p) i = j;
    const at = (j: number) => { const w = ((j % n) + n) % n, lap = Math.floor(j / n); return [k[w]![0] + lap, k[w]![1]] as const; };
    const [x0, y0] = at(i - 1), [x1, y1] = at(i), [x2, y2] = at(i + 1), [x3, y3] = at(i + 2);
    const pp = p < x1 ? p + 1 : p;
    const h = x2 - x1, s = (pp - x1) / h;
    const m1 = ((y2 - y1) / (x2 - x1) + (y1 - y0) / (x1 - x0)) / 2 * h;
    const m2 = ((y3 - y2) / (x3 - x2) + (y2 - y1) / (x2 - x1)) / 2 * h;
    return (2 * s ** 3 - 3 * s ** 2 + 1) * y1 + (s ** 3 - 2 * s ** 2 + s) * m1 + (-2 * s ** 3 + 3 * s ** 2) * y2 + (s ** 3 - s ** 2) * m2;
  };
}

/** Cubic Hermite between p0 and p1 with end slopes (per unit s). */
export const hermite = (p0: number, p1: number, m0: number, m1: number, s: number) =>
  (2 * s ** 3 - 3 * s ** 2 + 1) * p0 + (s ** 3 - 2 * s ** 2 + s) * m0 + (-2 * s ** 3 + 3 * s ** 2) * p1 + (s ** 3 - s ** 2) * m1;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth periodic noise (period seconds), roughly in [-1, 1]; harmonics of the loop so it closes. */
export function loopNoise(seed: number, period: number, harmonics: readonly number[] = [1, 2, 3, 5]) {
  const rnd = mulberry32(seed);
  const terms = harmonics.map((h, i) => ({ h, phase: rnd() * TAU, amp: (0.55 + 0.45 * rnd()) / (1 + i * 0.8) }));
  const norm = terms.reduce((s, x) => s + x.amp, 0);
  return (t: number) => terms.reduce((s, x) => s + x.amp * Math.sin(TAU * x.h * t / period + x.phase), 0) / norm;
}

/** Smooth aperiodic noise for one-shot clips. */
export function driftNoise(seed: number, hz: number) {
  const rnd = mulberry32(seed);
  const terms = [1, 1.73, 2.91, 4.37].map((f, i) => ({ f: f * hz, phase: rnd() * TAU, amp: 1 / (1 + i) }));
  const norm = terms.reduce((s, x) => s + x.amp, 0);
  return (t: number) => terms.reduce((s, x) => s + x.amp * Math.sin(TAU * x.f * t + x.phase), 0) / norm;
}

const _q = new Quaternion(), _v = new Vector3();
export const AX = new Vector3(1, 0, 0), AY = new Vector3(0, 1, 0), AZ = new Vector3(0, 0, 1);
export const qAxis = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle);
/** Body euler: yaw (left +, about Y), then pitch (nose up +), then roll (left side up +). */
export function qBody(pitchUp: number, yawLeft: number, roll: number) {
  return qAxis(AY, yawLeft).multiply(_q.setFromAxisAngle(AX, -pitchUp)).multiply(new Quaternion().setFromAxisAngle(AZ, roll));
}
/** Rotation whose X/Y/Z columns are an orthonormal frame built from a direction and a hinge axis. */
export function frameQuat(dir: Vector3, hinge: Vector3) {
  const e1 = dir.clone().normalize();
  const e2 = hinge.clone().addScaledVector(e1, -hinge.dot(e1));
  if (e2.lengthSq() < 1e-12) e2.copy(Math.abs(e1.x) < 0.9 ? AX : AY).addScaledVector(e1, -(Math.abs(e1.x) < 0.9 ? e1.x : e1.y));
  e2.normalize();
  const e3 = new Vector3().crossVectors(e1, e2);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(e1, e2, e3));
}
/** Quaternion power (scales the rotation angle). */
export function qPow(q: Quaternion, f: number) {
  const w = clamp(q.w, -1, 1), angle = 2 * Math.acos(Math.abs(w));
  if (angle < 1e-9) return new Quaternion();
  _v.set(q.x, q.y, q.z).normalize();
  if (w < 0) _v.negate();
  return new Quaternion().setFromAxisAngle(_v, angle * f);
}
/** Rotation angle of q away from identity. */
export const qAngle = (q: Quaternion) => 2 * Math.acos(clamp(Math.abs(q.w), 0, 1));
