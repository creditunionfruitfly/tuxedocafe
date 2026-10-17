import { describe, expect, it } from 'vitest';
import { CAT_ANIMS, MASTER_LODS, planCatAssets } from '../../src/cats/cat-assets.ts';
import { animationInterval, chooseLod, nearestAvailable } from '../../src/cats/lod.ts';
import { surfacePaths } from '../../src/cats/surfaces.ts';

describe('resident asset budgets', () => {
  it('skips LOD0 for phones and chooses only files present in the build', () => {
    const files = new Set([...MASTER_LODS, CAT_ANIMS]);
    const desktop = planCatAssets(path => files.has(path), 'desktop'), phone = planCatAssets(path => files.has(path), 'low');
    expect(desktop.lods).toEqual(MASTER_LODS); expect(phone.lods[0]).toBeNull(); expect(phone.lods[1]).toBe(MASTER_LODS[1]); expect(phone.expressions).toBeNull();
    expect(planCatAssets(() => false, 'desktop').source).toBe('placeholder');
  });
  it('selects detail with hysteresis and reduces only pose evaluation in the distance', () => {
    expect(chooseLod(1, 'desktop')).toBe(0); expect(chooseLod(1, 'low')).toBe(1); expect(chooseLod(3.6, 'desktop', 0)).toBe(0);
    expect(chooseLod(4, 'desktop', 0)).toBe(1); expect(nearestAvailable(0, [false, true, true])).toBe(1); expect(animationInterval(10)).toBe(3);
  });
  it('loads 1024 colour on phones and 2048 on desktop; data maps are shared', () => {
    expect(surfacePaths('mochi', 'low').body).toBe('art/cats/textures/mochi/body-1024.jpg');
    expect(surfacePaths('mochi', 'desktop').body).toBe('art/cats/textures/mochi/body-2048.jpg');
    expect(surfacePaths('mochi', 'desktop').normal).toBe(surfacePaths('waffles', 'desktop').normal);
  });
});
