/**
 * The exact solution of a damped harmonic oscillator x'' + 2ζω x' + ω² x = 0
 * over one step, as a 2×2 transition [x, v] → [a·x + b·v, c·x + d·v]. Being
 * exact, it is unconditionally stable and gives identical states at shared
 * times whatever the step size (for a target held during the step), which is
 * what "frame-rate independent" means for the tail and ear springs.
 */
export interface SpringStep { a: number; b: number; c: number; d: number }

export function springStep(frequencyHz: number, dampingRatio: number, dt: number, out: SpringStep): SpringStep {
  const omega = 2 * Math.PI * Math.max(1e-4, frequencyHz), zeta = Math.max(0, dampingRatio);
  if (dt <= 0) { out.a = 1; out.b = 0; out.c = 0; out.d = 1; return out; }
  if (Math.abs(zeta - 1) < 1e-4) {
    const e = Math.exp(-omega * dt);
    out.a = e * (1 + omega * dt); out.b = e * dt; out.c = -e * omega * omega * dt; out.d = e * (1 - omega * dt);
  } else if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta), e = Math.exp(-zeta * omega * dt), cos = Math.cos(wd * dt), sin = Math.sin(wd * dt);
    out.a = e * (cos + zeta * omega / wd * sin); out.b = e * sin / wd;
    out.c = -e * omega * omega / wd * sin; out.d = e * (cos - zeta * omega / wd * sin);
  } else {
    const root = Math.sqrt(zeta * zeta - 1), r1 = -omega * (zeta - root), r2 = -omega * (zeta + root);
    const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt), k = 1 / (r1 - r2);
    out.a = (r1 * e2 - r2 * e1) * k; out.b = (e1 - e2) * k;
    out.c = r1 * r2 * (e2 - e1) * k; out.d = (r1 * e1 - r2 * e2) * k;
  }
  return out;
}

/** Advances offset x and velocity v (any number of axes, stored [x0, v0, x1, v1, …]) in place. */
export function applySpringStep(step: SpringStep, state: Float64Array, offset: number, axes: number): void {
  for (let i = 0; i < axes; i++) {
    const o = offset + i * 2, x = state[o]!, v = state[o + 1]!;
    state[o] = step.a * x + step.b * v; state[o + 1] = step.c * x + step.d * v;
  }
}
