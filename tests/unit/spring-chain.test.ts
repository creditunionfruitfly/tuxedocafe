import { Bone, Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SpringChain, TAIL_SPRING } from '../../src/anim/spring-chain.ts';
import { worldPosition } from './helpers/synthetic-cat.ts';

/** A 12-link tail hanging off a moving base, like the cat's pelvis. */
function tail() {
  const root = new Group(), base = new Bone(); root.add(base); base.position.set(0, .3, 0);
  const links: Bone[] = []; let parent: Bone = base;
  for (let i = 0; i < 12; i++) { const link = new Bone(); link.position.set(0, i ? .012 : .03, -.038); parent.add(link); links.push(link); parent = link; }
  root.updateMatrixWorld(true);
  return { root, base, links, chain: new SpringChain(links, TAIL_SPRING) };
}

/** Swings the base smoothly (zero velocity at start and stop) for two cycles, then holds; tip trace at 10 Hz. */
function run(hz: number, seconds = 4, amplitude = .05): Vector3[] {
  const { root, base, links, chain } = tail(), dt = 1 / hz, rest = links.map(l => l.quaternion.clone()), trace: Vector3[] = [];
  let t = 0, nextSample = 0;
  while (t < seconds - 1e-9) {
    t += dt;
    base.position.x = t < Math.PI ? amplitude * (1 - Math.cos(4 * t)) : 0;
    links.forEach((l, i) => l.quaternion.copy(rest[i]!));
    root.updateMatrixWorld(true);
    chain.solve(dt, 0);
    if (t >= nextSample - 1e-9) { trace.push(worldPosition(links[11]!).sub(base.position)); nextSample += .1; }
  }
  return trace;
}

describe('spring chain', () => {
  it('is stable at 30, 60 and 144 Hz and agrees across rates', () => {
    const a = run(30), b = run(60), c = run(144), still = run(30, 4, 0).at(-1)!;
    for (const trace of [a, b, c]) for (const p of trace) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    // It swings while the base accelerates…
    expect(Math.max(...a.map(p => Math.abs(p.x - still.x)))).toBeGreaterThan(.02);
    // …and settles back onto the animated pose within 0.8 s of the base stopping.
    for (const trace of [a, b, c]) expect(trace.at(-1)!.distanceTo(still)).toBeLessThan(.002);
    // Trajectories at different rates stay close (a 48 cm tail; sampling differences only).
    a.forEach((p, i) => { expect(p.distanceTo(b[i]!)).toBeLessThan(.01); expect(p.distanceTo(c[i]!)).toBeLessThan(.015); });
  });

  it('lags the base and respects its angle limits', () => {
    const { root, base, links, chain } = tail();
    chain.solve(1 / 30, -1);
    base.position.x = .05; root.updateMatrixWorld(true);
    const animatedTip = worldPosition(links[11]!);
    chain.solve(1 / 30, -1);
    const tip = worldPosition(links[11]!);
    expect(tip.x).toBeLessThan(animatedTip.x);
    for (const link of links) expect(2 * Math.acos(Math.min(1, Math.abs(link.quaternion.w))) * 180 / Math.PI).toBeLessThanOrEqual(TAIL_SPRING.tipMaxDeg + 1e-6);
  });

  it('keeps the tip above the floor', () => {
    const { root, base, links, chain } = tail();
    // A drooping tail that would sweep through the floor.
    base.position.y = .1; base.rotation.x = -1.2; root.updateMatrixWorld(true);
    expect(worldPosition(links[11]!).y).toBeLessThan(0);
    for (let i = 0; i < 30; i++) { links.forEach(l => l.quaternion.identity()); root.updateMatrixWorld(true); chain.solve(1 / 30, .05); }
    for (const link of links) expect(worldPosition(link).y).toBeGreaterThan(.05 + TAIL_SPRING.collisionRadius - 1e-6);
  });
});
