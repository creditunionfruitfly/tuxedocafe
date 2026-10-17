import { describe, expect, it } from 'vitest';
import type { ClipEvent } from '../../src/anim/catalog.ts';
import { advanceTime, visitCrossedEvents } from '../../src/anim/clip-timeline.ts';

const events: ClipEvent[] = [{ t: 0, name: 'start' }, { t: .25, name: 'quarter' }, { t: 1, name: 'end' }];
const crossed = (from: number, step: number, loop: boolean, fromStart = false): string[] => {
  const names: string[] = []; visitCrossedEvents(events, from, step, 1, loop, fromStart, e => names.push(e.name)); return names;
};

describe('clip timeline', () => {
  it('wraps looping clips and clamps one-shots', () => {
    expect(advanceTime(.9, .2, 1, true)).toBeCloseTo(.1, 9);
    expect(advanceTime(.9, 2.2, 1, true)).toBeCloseTo(.1, 9);
    expect(advanceTime(.9, .2, 1, false)).toBe(1);
    expect(advanceTime(0, -1, 1, false)).toBe(0);
    expect(advanceTime(.3, .1, 0, true)).toBe(0);
  });

  it('fires events once, including t=0 at the start and on every loop', () => {
    expect(crossed(0, .1, true, true)).toEqual(['start']);
    expect(crossed(0, .1, true)).toEqual([]);
    expect(crossed(.2, .1, true)).toEqual(['quarter']);
    expect(crossed(.95, .1, true)).toEqual(['end', 'start']);
    expect(crossed(.95, .1, false)).toEqual(['end']);
    expect(crossed(1, .1, false)).toEqual([]);
  });

  it('gives the same events whatever the step size', () => {
    const run = (step: number): string[] => {
      const names: string[] = []; let t = 0, first = true;
      for (let elapsed = 0; elapsed < 2.9; elapsed += step) {
        visitCrossedEvents(events, t, step, 1, true, first, e => names.push(e.name)); first = false; t = advanceTime(t, step, 1, true);
      }
      return names;
    };
    expect(run(1 / 30)).toEqual(run(1 / 10));
    expect(run(1 / 30)).toEqual(run(.1));
    expect(run(1 / 30)).toHaveLength(8);
  });
});
