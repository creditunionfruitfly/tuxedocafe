import { describe, expect, it } from 'vitest';
import { syntheticRuntime } from './helpers/synthetic-runtime.ts';

const DT = 1 / 30;

describe('animator (mixer stack)', () => {
  it('blends idle, walk, trot and gallop by speed and keeps their footfalls in phase', () => {
    const { animation } = syntheticRuntime(), a = animation.animator;
    const weight = (name: string): number => a.tracks.get(name)!.weight;
    a.setLocomotion(0, 0); a.advance(DT);
    expect(weight('cat.loco.idle')).toBeCloseTo(1, 9);
    for (let i = 0; i < 30; i++) { a.setLocomotion(.7, 0); a.advance(DT); }
    expect(weight('cat.loco.walk')).toBeGreaterThan(.95);
    expect(a.locoWeight).toBeGreaterThan(.95);
    a.setLocomotion(1.1, 0); a.advance(DT);
    expect(weight('cat.loco.walk')).toBeCloseTo(weight('cat.loco.trot'), 6);
    const walk = a.tracks.get('cat.loco.walk')!, trot = a.tracks.get('cat.loco.trot')!;
    expect(walk.time / walk.duration).toBeCloseTo(trot.time / trot.duration, 9);
    a.setLocomotion(3, 0); a.advance(DT);
    expect(weight('cat.loco.gallop')).toBeGreaterThan(.9);
  });

  it('rescales gait selection by the speed factor (scale × leg length)', () => {
    const { animation } = syntheticRuntime(), a = animation.animator;
    a.speedFactor = .54;
    for (let i = 0; i < 20; i++) { a.setLocomotion(1, 0); a.advance(DT); }
    expect(a.tracks.get('cat.loco.trot')!.weight).toBeGreaterThan(a.tracks.get('cat.loco.walk')!.weight);
  });

  it('turns in place with the turn clips and plays start and stop at the edges of motion', () => {
    const { animation } = syntheticRuntime(), a = animation.animator;
    a.setLocomotion(0, 1.5); a.advance(DT);
    expect(a.tracks.get('cat.loco.turn_left')!.weight).toBeGreaterThan(.9);
    a.setLocomotion(0, -1.5); a.advance(DT);
    expect(a.tracks.get('cat.loco.turn_right')!.weight).toBeGreaterThan(.9);
    a.setLocomotion(.7, 0); a.advance(DT);
    expect(a.tracks.get('cat.loco.start')!.weight).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) a.advance(DT);
    a.setLocomotion(0, 0); a.advance(DT);
    expect(a.tracks.get('cat.loco.stop')!.weight).toBeGreaterThan(0);
  });

  it('cross-fades full-body actions over locomotion and returns', () => {
    const { animation } = syntheticRuntime(), a = animation.animator;
    expect(a.play('cat.rest.sit_down', .2)).toBe(true);
    a.advance(DT);
    const early = a.tracks.get('cat.rest.sit_down')!.weight;
    expect(early).toBeGreaterThan(0); expect(early).toBeLessThan(1);
    for (let i = 0; i < 10; i++) a.advance(DT);
    expect(a.tracks.get('cat.rest.sit_down')!.weight).toBe(1);
    expect(a.action).toBe('cat.rest.sit_down');
    a.play('cat.rest.sit_idle', .2); for (let i = 0; i < 3; i++) a.advance(DT);
    const sum = a.tracks.get('cat.rest.sit_down')!.weight + a.tracks.get('cat.rest.sit_idle')!.weight;
    expect(sum).toBeCloseTo(1, 9);
    a.stopAction(.1); for (let i = 0; i < 10; i++) a.advance(DT);
    expect(a.action).toBeNull();
    expect(a.tracks.get('cat.loco.idle')!.weight).toBeCloseTo(1, 9);
    expect(a.play('cat.nope')).toBe(false);
  });

  it('layers additive clips with eased weights and plays one-shots once', () => {
    const { animation } = syntheticRuntime(), a = animation.animator;
    expect(a.setLayer('cat.layer.tail_up', 1)).toBe(true);
    expect(a.setLayer('cat.rest.sit_idle', 1)).toBe(false);
    for (let i = 0; i < 15; i++) a.advance(DT);
    expect(a.layerWeight('cat.layer.tail_up')).toBe(1);
    a.trigger('cat.layer.ear_twitch');
    for (let i = 0; i < 30; i++) a.advance(DT);
    expect(a.layerWeight('cat.layer.ear_twitch')).toBe(0);
    a.setLayer('cat.layer.ears_back', 1); for (let i = 0; i < 15; i++) a.advance(DT);
    expect(a.morphs[a.catalog.morphTargets.indexOf('earFlatten_L')]).toBeGreaterThan(.9);
  });

  it('emits clip events (sfx: ids included) only from clips with weight', () => {
    const { animation, events } = syntheticRuntime(), a = animation.animator, sink = (clip: string, name: string): void => { events.push(`${clip}:${name}`); };
    a.play('cat.rest.sleep_curl', 0);
    a.advance(DT, sink);
    expect(events).toEqual(['cat.rest.sleep_curl:sfx:cat.sleep']);
    for (let i = 0; i < 8 * 30; i++) a.advance(DT, sink);
    expect(events.filter(e => e.endsWith('sfx:cat.sleep'))).toHaveLength(2);
    events.length = 0;
    a.play('cat.react.swat', 0); for (let i = 0; i < 20; i++) a.advance(DT, sink);
    expect(events).toEqual(['cat.react.swat:strike', 'cat.react.swat:sfx:cat.swat']);
  });

  it('reports locomotion contacts in the walk footfall order', () => {
    const { animation } = syntheticRuntime(), a = animation.animator, order: string[] = [];
    let previous = [0, 0, 0, 0];
    for (let i = 0; i < 60; i++) {
      a.setLocomotion(.7, 0); a.advance(DT);
      ['LF', 'RF', 'LH', 'RH'].forEach((paw, k) => { if (a.contacts[k]! >= .5 && previous[k]! < .5 && i > 20) order.push(paw); });
      previous = Array.from(a.contacts);
    }
    expect(order.slice(0, 4).join(',')).toMatch(/LH,LF,RH,RF|LF,RH,RF,LH|RH,RF,LH,LF|RF,LH,LF,RH/);
  });

  it('previews any clip alone with pause and scrub', () => {
    const { animation } = syntheticRuntime(), a = animation.animator;
    expect(a.preview('cat.layer.tail_lash')).toBe(true);
    a.advance(DT);
    expect(a.tracks.get('cat.layer.tail_lash')!.weight).toBe(1);
    expect(a.tracks.get('cat.loco.idle')!.weight).toBe(1);
    a.previewPaused = true; a.setPreviewTime(.4); a.advance(DT);
    expect(a.previewTime).toBeCloseTo(.4, 9);
    a.preview('cat.move.jump_up_high'); a.previewPaused = false; a.advance(DT);
    expect(a.rootMotion).toBe(1);
    a.preview(null); a.advance(DT);
    expect(a.previewClip).toBeNull();
  });
});
