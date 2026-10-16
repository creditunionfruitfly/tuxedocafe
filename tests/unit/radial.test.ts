import { expect, it } from 'vitest';
import { radialRate } from '../../src/input/radial.ts';
import controls from '../../data/interaction.json' with { type: 'json' };
const rate = () => ({ yaw: 0, pitch: 0 });
it('ignores offsets inside the drag dead zone', () => { expect(radialRate(controls.dragThresholdPx, 0, true, false, rate())).toEqual({ yaw: 0, pitch: 0 }); });
it('turns yaw from horizontal offset and pitch from vertical offset', () => {
  const right = radialRate(60, 0, true, false, rate()); expect(right.yaw).toBeLessThan(0); expect(right.pitch).toBeCloseTo(0, 10);
  const up = radialRate(0, -60, true, false, rate()); expect(up.pitch).toBeGreaterThan(0); expect(up.yaw).toBeCloseTo(0, 10);
  const diagonal = radialRate(40, 40, true, false, rate()); expect(diagonal.yaw).toBeCloseTo(diagonal.pitch, 10);
});
it('scales turn speed with drag magnitude up to the cap', () => {
  const speeds = [20, 50, 80, 400].map(px => -radialRate(px, 0, true, false, rate()).yaw);
  expect(speeds[0]).toBeLessThan(speeds[1]!); expect(speeds[1]).toBeLessThan(speeds[2]!);
  expect(speeds[3]).toBeCloseTo(controls.radialMaxRadPerSecondTouch, 10);
  expect(Math.hypot(...Object.values(radialRate(300, 300, false, false, rate())))).toBeCloseTo(controls.radialMaxRadPerSecondMouse, 10);
});
it('is more sensitive on touch and gentler with reduced motion', () => {
  const touch = -radialRate(60, 0, true, false, rate()).yaw, mouse = -radialRate(60, 0, false, false, rate()).yaw;
  expect(touch).toBeGreaterThan(mouse);
  expect(-radialRate(400, 0, true, true, rate()).yaw).toBeCloseTo(controls.radialMaxRadPerSecondTouch * controls.reducedMotionLookScale, 10);
});
