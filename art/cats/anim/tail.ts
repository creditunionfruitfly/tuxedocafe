// Tail follow-through: each of the 12 joints chases its parent's world angle
// plus its authored bend through a damped spring, stiff at the base and loose
// at the tip, so body motion travels down the tail as a lagging wave. Loops
// run to a periodic steady state and close exactly.
import type { Body } from './body.ts';
import { solveTrunk, TAIL_DIRECTION } from './body.ts';
import type { TailSim } from './catalog.ts';
import { fk, type Rig } from './rig.ts';

export function simulateTail(rig: Rig, bodies: Body[], dt: number, loop: boolean, opts: TailSim) {
  const n = bodies.length, joints = rig.tail.length;
  // Base angles: heading and elevation of the tail root's rest direction in world.
  const restDir = TAIL_DIRECTION;
  const base = bodies.map(b => {
    const W = fk(rig, solveTrunk(rig, b));
    const d = restDir.clone().applyQuaternion(W.rot[rig.parent[rig.tail[0]!]!]!);
    return [Math.asin(Math.max(-1, Math.min(1, d.y))), Math.atan2(-d.x, -d.z)] as const;
  });
  // Unwrap heading so a turning body does not jump by 2*PI.
  for (let f = 1; f < n; f++) {
    const prev = base[f - 1]![1]; let h = base[f]![1];
    while (h - prev > Math.PI) h -= 2 * Math.PI;
    while (h - prev < -Math.PI) h += 2 * Math.PI;
    base[f] = [base[f]![0], h];
  }
  const omega = Array.from({ length: joints }, (_, i) => opts.wBase * Math.pow(opts.wTip / opts.wBase, i / (joints - 1)));
  const sub = 8, h = dt / sub;
  for (const axis of [0, 1] as const) {
    const target = (f: number, i: number) => bodies[f]!.tail[i]![axis];
    const baseAt = (f: number) => base[f]![axis];
    const phi = new Array(joints + 1).fill(0), vel = new Array(joints + 1).fill(0);
    const reset = () => { phi[0] = baseAt(0); for (let i = 1; i <= joints; i++) phi[i] = phi[i - 1] + target(0, i - 1); vel.fill(0); };
    reset();
    const cycles = loop ? Math.max(3, Math.ceil(4 / (dt * (n - 1)))) : 1;
    const out: number[][] = [];
    for (let c = 0; c < cycles; c++) {
      const record = c === cycles - 1;
      if (record) out.length = 0;
      for (let f = 0; f < n; f++) {
        if (record) out.push(phi.slice());
        if (f === n - 1) break;
        for (let s = 0; s < sub; s++) {
          const w = (s + 1) / sub;
          const b0 = baseAt(f) + (baseAt(f + 1) - baseAt(f)) * w;
          const v0 = (baseAt(f + 1) - baseAt(f)) / dt;
          phi[0] = b0; vel[0] = v0;
          for (let i = 1; i <= joints; i++) {
            const tgt = phi[i - 1] + target(f, i - 1) + (target(f + 1, i - 1) - target(f, i - 1)) * w;
            const o = omega[i - 1]!;
            const acc = o * o * (tgt - phi[i]) - 2 * opts.zeta * o * (vel[i] - vel[i - 1]);
            vel[i] += acc * h;
            phi[i] += vel[i] * h;
          }
        }
      }
      if (loop && !record) {
        // Continue from the end state, rebased onto frame 0's base (the loop repeats).
        const shift = baseAt(0) - baseAt(n - 1);
        for (let i = 0; i <= joints; i++) phi[i] += shift;
      }
    }
    const local = out.map(p => p.slice(1).map((v, i) => v - p[i]!));
    if (loop) {
      // Spread any residual seam error linearly so frame n-1 equals frame 0.
      const err = local[n - 1]!.map((v, i) => v - local[0]![i]!);
      local.forEach((row, f) => row.forEach((_, i) => { row[i] = row[i]! - err[i]! * f / (n - 1); }));
    }
    // Follow-through may lag the authored bend by at most ~25° per joint (soft limit, no kinks).
    local.forEach((row, f) => row.forEach((v, i) => {
      const tgt = target(f, i), dev = v - tgt;
      bodies[f]!.tail[i]![axis] = tgt + 0.44 * Math.tanh(dev / 0.44);
    }));
  }
}
