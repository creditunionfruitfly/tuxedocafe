import { describe, expect, it } from 'vitest';
import { createSupportHit, flatGround, withSlope, withStep } from '../../src/anim/ground.ts';

describe('support planes', () => {
  it('layers steps and slopes over a floor', () => {
    const hit = createSupportHit();
    const ground = withSlope(withStep(flatGround(0), { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, .1), { minX: -2, maxX: -1, minZ: -1, maxZ: 1 }, -1, 0, 0, 45, -Math.PI / 2);
    expect(ground(.5, .5, hit)).toBe(true); expect(hit.height).toBe(.1);
    expect(ground(3, 3, hit)).toBe(true); expect(hit.height).toBe(0); expect(hit.normal.y).toBe(1);
    ground(-1.5, 0, hit);
    expect(hit.height).toBeCloseTo(.5, 9);
    expect(hit.normal.x).toBeCloseTo(Math.SQRT1_2, 9); expect(hit.normal.y).toBeCloseTo(Math.SQRT1_2, 9);
  });
});
