import { describe, expect, it } from 'vitest';
import { applySpringStep, springStep, type SpringStep } from '../../src/anim/spring.ts';

/** Releases a unit offset and samples the state at `times` with a given step. */
function response(hz: number, zeta: number, dt: number, times: number[]): number[][] {
  const step: SpringStep = { a: 0, b: 0, c: 0, d: 0 }, state = Float64Array.of(1, 0), out: number[][] = [];
  let t = 0;
  for (const sample of times) {
    while (t + dt <= sample + 1e-9) { applySpringStep(springStep(hz, zeta, dt, step), state, 0, 1); t += dt; }
    out.push([state[0]!, state[1]!]);
  }
  return out;
}

describe('damped spring', () => {
  for (const zeta of [.3, 1, 2.5]) {
    it(`is exact and stable at 30, 60 and 144 Hz (ζ = ${zeta})`, () => {
      const at30 = response(3, zeta, 1 / 30, [1, 2]), at60 = response(3, zeta, 1 / 60, [1, 2]), at144 = response(3, zeta, 1 / 144, [1, 2]);
      for (const other of [at60, at144]) other.forEach((sample, i) => {
        expect(sample[0]).toBeCloseTo(at30[i]![0]!, 6); expect(sample[1]).toBeCloseTo(at30[i]![1]!, 5);
      });
      // Energy decays: the offset after 2 s is small and finite.
      expect(Math.abs(at144[1]![0]!)).toBeLessThan(.05);
    });
  }

  it('matches the analytic underdamped solution', () => {
    const hz = 2, zeta = .2, w = 2 * Math.PI * hz, wd = w * Math.sqrt(1 - zeta * zeta), t = .37;
    const [[x]] = response(hz, zeta, t, [t]) as [[number, number]];
    expect(x).toBeCloseTo(Math.exp(-zeta * w * t) * (Math.cos(wd * t) + zeta * w / wd * Math.sin(wd * t)), 9);
  });

  it('stays bounded even with huge steps', () => {
    const state = Float64Array.of(1, 50), step = springStep(8, .1, 10, { a: 0, b: 0, c: 0, d: 0 });
    for (let i = 0; i < 100; i++) applySpringStep(step, state, 0, 1);
    expect(Math.abs(state[0]!)).toBeLessThan(1e-6);
    expect(springStep(3, .5, 0, { a: 0, b: 0, c: 0, d: 0 })).toEqual({ a: 1, b: 0, c: 0, d: 1 });
  });
});
