import { expect, it } from 'vitest';
import { planAntialiasing } from '../../src/render/scene-output.ts';

it('chooses a sample count supported by both framebuffer attachments', () => {
  expect(planAntialiasing(8, [8, 4], [8, 4], 8)).toEqual({ native: 8, ratio: 1 });
  expect(planAntialiasing(8, [8, 4], [4], 8)).toEqual({ native: 4, ratio: Math.SQRT2 });
  expect(planAntialiasing(8, [8, 4], [8, 4], 4)).toEqual({ native: 4, ratio: Math.SQRT2 });
  expect(planAntialiasing(8, [4, 2], [2], 8)).toEqual({ native: 2, ratio: 2 });
  expect(planAntialiasing(8, [], [4], 4)).toEqual({ native: 0, ratio: 3 });
  expect(planAntialiasing(2, [4, 2], [4, 2], 4)).toEqual({ native: 2, ratio: 1 });
  expect(planAntialiasing(2, [4], [4], 4)).toEqual({ native: 0, ratio: Math.SQRT2 });
});
