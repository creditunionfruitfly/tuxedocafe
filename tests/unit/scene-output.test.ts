import { expect, it } from 'vitest';
import { limitOutputPixelRatio, planAntialiasing } from '../../src/render/scene-output.ts';

it('chooses a sample count supported by both framebuffer attachments', () => {
  expect(planAntialiasing(8, [8, 4], [8, 4], 8)).toEqual({ native: 8, ratio: 1 });
  expect(planAntialiasing(8, [8, 4], [4], 8)).toEqual({ native: 4, ratio: Math.SQRT2 });
  expect(planAntialiasing(8, [8, 4], [8, 4], 4)).toEqual({ native: 4, ratio: Math.SQRT2 });
  expect(planAntialiasing(8, [4, 2], [2], 8)).toEqual({ native: 2, ratio: 2 });
  expect(planAntialiasing(8, [], [4], 4)).toEqual({ native: 0, ratio: 3 });
  expect(planAntialiasing(2, [4, 2], [4, 2], 4)).toEqual({ native: 2, ratio: 1 });
  expect(planAntialiasing(2, [4], [4], 4)).toEqual({ native: 0, ratio: Math.SQRT2 });
});

it('caps target memory by lowering output DPR while preserving coverage density', () => {
  const desktop = planAntialiasing(8, [4], [4], 4);
  expect(limitOutputPixelRatio(1920, 1080, 1, desktop, true, true, 16384)).toBe(1);
  const desktopRatio = limitOutputPixelRatio(3840, 2160, 2, desktop, true, true, 16384);
  expect(desktopRatio).toBeLessThan(1);
  const targetBytes = (w: number, h: number, dpr: number, scale: number, samples: number) =>
    Math.ceil(w * dpr * scale) * Math.ceil(h * dpr * scale) * 12 * (samples + 1);
  expect(targetBytes(3840, 2160, desktopRatio, desktop.ratio, desktop.native)).toBeLessThanOrEqual(320 * 1024 ** 2);
  const phone = planAntialiasing(2, [4], [4], 4);
  expect(limitOutputPixelRatio(915, 412, 1.35, phone, true, false, 4096)).toBe(1.35);
  const phoneRatio = limitOutputPixelRatio(3000, 1500, 1.35, phone, true, false, 4096);
  expect(targetBytes(3000, 1500, phoneRatio, phone.ratio, phone.native)).toBeLessThanOrEqual(64 * 1024 ** 2);
  expect(limitOutputPixelRatio(1920, 1080, 1, desktop, true, true, 2048))
    .toBeCloseTo(2048 / (1920 * desktop.ratio));
});
