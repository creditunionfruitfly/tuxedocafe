import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../src/anim/catalog.ts';
import { ExpressionPlayer, parseExpressions, sampleCurve } from '../../src/anim/expressions.ts';

const morph = (name: string): number => CATALOG.morphTargets.indexOf(name);

describe('expression curves', () => {
  it('synthesizes every catalog expression when the file is missing', () => {
    const library = parseExpressions(null, CATALOG);
    expect([...library.byName.keys()].sort()).toEqual(CATALOG.expressions.map(e => e.name).sort());
    const blink = library.byName.get('blink')!;
    expect(blink.durationS).toBe(.18);
    expect(blink.curves.map(c => c.morph)).toEqual([morph('blink_L'), morph('blink_R')]);
    expect(sampleCurve(blink.curves[0]!, 0)).toBe(0);
    expect(sampleCurve(blink.curves[0]!, .07)).toBe(1);
    expect(sampleCurve(blink.curves[0]!, .18)).toBe(0);
  });

  it('reads authored curves in several layouts and ignores unknown morphs', () => {
    const library = parseExpressions({
      fps: 10,
      expressions: [
        { name: 'blink', durationS: .2, curves: { blink_L: [0, 1, 0], blink_R: { times: [0, .1, .2], values: [0, .8, 0] }, nope: [1] } },
        { name: 'snarl', curves: { mouthOpen: [[0, 0], [.3, .9], [.6, 0]] } },
      ],
    }, CATALOG);
    const blink = library.byName.get('blink')!;
    expect(blink.curves).toHaveLength(2);
    expect(sampleCurve(blink.curves[0]!, .1)).toBe(1);
    expect(sampleCurve(blink.curves[1]!, .05)).toBeCloseTo(.4, 9);
    expect(sampleCurve(library.byName.get('snarl')!.curves[0]!, .3)).toBeCloseTo(.9, 9);
    expect(parseExpressions({ blink: { curves: { blink_L: [0, .5, 0] } } }, CATALOG).byName.get('blink')!.curves).toHaveLength(1);
  });

  it('plays, stretches, combines by maximum and expires', () => {
    const player = new ExpressionPlayer(parseExpressions(null, CATALOG)), out = new Float64Array(CATALOG.morphTargets.length);
    expect(player.play('missing')).toBe(false);
    player.play('slow_blink', 1, 3.6);
    player.play('blink', .5);
    player.advance(.06);
    player.accumulate(out);
    expect(out[morph('blink_L')]).toBeGreaterThan(0);
    expect(out[morph('blink_L')]).toBeLessThanOrEqual(.5);
    player.advance(1.5); out.fill(0); player.accumulate(out);
    expect(out[morph('blink_L')]).toBeCloseTo(1, 9);
    expect(player.isPlaying('blink')).toBe(false);
    player.advance(5); out.fill(0); player.accumulate(out);
    expect(out.every(v => v === 0)).toBe(true);
  });
});
