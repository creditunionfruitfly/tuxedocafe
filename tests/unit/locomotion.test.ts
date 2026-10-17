import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../src/anim/catalog.ts';
import { gaitTimeScale, gaitWeights, GAITS, MAX_TIME_SCALE, MIN_TIME_SCALE, normalizeSpeed, selectGait, speedFactor } from '../../src/anim/locomotion.ts';

const thresholds = CATALOG.gaitThresholds;

describe('locomotion blending', () => {
  it('selects gaits at the catalog thresholds (walk < 1.1 m/s, trot < 2.2 m/s, gallop above)', () => {
    expect(selectGait(0, thresholds)).toBe('idle');
    expect(selectGait(.5, thresholds)).toBe('walk');
    expect(selectGait(1.0999, thresholds)).toBe('walk');
    expect(selectGait(1.1, thresholds)).toBe('trot');
    expect(selectGait(2.1999, thresholds)).toBe('trot');
    expect(selectGait(2.2, thresholds)).toBe('gallop');
    expect(selectGait(4, thresholds)).toBe('gallop');
  });

  it('weights sum to one and the dominant weight matches the selected gait', () => {
    const weights = new Float64Array(4);
    for (let s = 0; s <= 5; s += .01) {
      gaitWeights(s, thresholds, weights);
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      let best = 0; for (let i = 1; i < 4; i++) if (weights[i]! > weights[best]!) best = i;
      const selected = selectGait(s, thresholds);
      if (Math.abs(s - thresholds.walkMax) > .005 && Math.abs(s - thresholds.trotMax) > .005 && s > .2) expect(GAITS[best], `at ${s.toFixed(2)} m/s`).toBe(selected);
    }
    expect(Array.from(gaitWeights(1.1, thresholds, weights)).slice(1, 3).map(w => w.toFixed(3))).toEqual(['0.500', '0.500']);
  });

  it('rescales speed by scale × leg length so small cats change gait sooner', () => {
    const kitten = speedFactor(.6, .9);
    expect(kitten).toBeCloseTo(.54, 9);
    expect(selectGait(normalizeSpeed(1, kitten), thresholds)).toBe('trot');
    expect(selectGait(normalizeSpeed(1, speedFactor(1, 1)), thresholds)).toBe('walk');
  });

  it('plays clips at the rate that keeps the stride on the ground, within limits', () => {
    expect(gaitTimeScale(.7, .7)).toBe(1);
    expect(gaitTimeScale(1.05, .7)).toBeCloseTo(1.5, 9);
    expect(gaitTimeScale(.01, .7)).toBe(MIN_TIME_SCALE);
    expect(gaitTimeScale(10, .7)).toBe(MAX_TIME_SCALE);
    expect(gaitTimeScale(1, 0)).toBe(1);
  });
});
