import { describe, expect, it } from 'vitest';
import { BlinkScheduler } from '../../src/anim/blink.ts';
import { createRng } from '../../src/core/rng.ts';

const blinkTimes = (seed: string, step: number, seconds = 60): number[] => {
  const scheduler = new BlinkScheduler(createRng(seed)), times: number[] = [];
  for (let t = step; t <= seconds + 1e-9; t += step) if (scheduler.advance(step)) times.push(Math.round(t * 30));
  return times;
};

describe('blink scheduler', () => {
  it('blinks every 3–8 s from a seeded stream, the same on every replay', () => {
    const times = blinkTimes('cat:mochi', 1 / 30);
    expect(times.length).toBeGreaterThanOrEqual(60 / 8 - 1);
    expect(times.length).toBeLessThanOrEqual(60 / 3);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(3 * 30 - 1);
      expect(times[i]! - times[i - 1]!).toBeLessThanOrEqual(8 * 30 + 1);
    }
    expect(blinkTimes('cat:mochi', 1 / 30)).toEqual(times);
    expect(blinkTimes('cat:pixel', 1 / 30)).not.toEqual(times);
  });

  it('skips a blink while suppressed but keeps the schedule', () => {
    const scheduler = new BlinkScheduler(createRng('x'));
    const wait = scheduler.remaining;
    expect(scheduler.advance(wait + .01, true)).toBe(false);
    expect(scheduler.remaining).toBeGreaterThanOrEqual(3 - .02);
  });
});
