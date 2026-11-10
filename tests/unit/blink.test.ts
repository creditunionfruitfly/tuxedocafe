import { expect, it } from 'vitest';
import { CatBlink } from '../../src/cats/blink.ts';
import { Brain } from '../../src/cats/brain.ts';
import { createRng } from '../../src/core/rng.ts';

const DT = 1 / 30;
it('keeps one seeded cadence with long relaxed closures and rare brief alert blinks', () => {
  for (const [mood, min, max] of [['relaxed', 6, 12], ['alert', 8, 20]] as const) {
    const lids = new CatBlink(createRng(mood));
    lids.step(0, mood, false);
    let elapsed = 0, started = false;
    while (!started && elapsed <= max + DT) {
      elapsed += DT; lids.step(DT, mood, false); started = lids.closed(.08) > 0;
    }
    expect(started).toBe(true); expect(elapsed).toBeGreaterThanOrEqual(min); expect(elapsed).toBeLessThanOrEqual(max + DT);
    if (mood === 'relaxed') {
      expect(lids.closed(.2)).toBeCloseTo(.5); expect(lids.closed(.4)).toBe(1);
      expect(lids.closed(.69)).toBe(1); expect(lids.closed(.9)).toBeCloseTo(.5); expect(lids.closed(1.11)).toBe(0);
    } else {
      expect(lids.closed(.05)).toBeCloseTo(.5); expect(lids.closed(.1)).toBe(1); expect(lids.closed(.21)).toBe(0);
    }
  }
});

it('reads a returned affection cue but suppresses rapid repeats, and stays shut during sleep', () => {
  const brain = new Brain('mochi', createRng('affection'), { x: .6, z: -1.5 });
  brain.affinity = brain.cap * .8; brain.engaged = true;
  brain.interrupt([{ kind: 'clip', clip: 'cat.rest.sit_idle', seconds: 20 }]);
  const world = { player: null, cats: [brain] }, before = brain.affinity;
  expect(brain.slowBlink()).toBe(true); brain.step(DT, world);
  expect(brain.affinity).toBeCloseTo(before + .005);
  expect(brain.pulses).toContain('cat.social.slow_blink'); expect(brain.blink.closed(.4)).toBe(1);
  for (let i = 0; i < 60; i++) brain.step(DT, world);
  brain.slowBlink(); brain.step(DT, world);
  expect(brain.pulses).toContain('cat.social.slow_blink'); expect(brain.blink.closed(.4)).toBe(0);
  brain.interrupt([{ kind: 'clip', clip: 'cat.rest.sleep_curl', seconds: 5 }]);
  brain.step(DT, world); expect(brain.blink.sleeping).toBe(true);
  for (let i = 0; i < 30; i++) brain.step(DT, world);
  expect(brain.blink.closed()).toBe(1);
  brain.interrupt([{ kind: 'clip', clip: 'cat.rest.wake_stretch' }]); brain.step(DT, world);
  expect(brain.blink.sleeping).toBe(false); expect(brain.blink.closed(.2)).toBeCloseTo(.5); expect(brain.blink.closed(.4)).toBeCloseTo(0);
});
