import { describe, expect, it } from 'vitest';
import { CATALOG, normalizeContacts, parseAdditiveReference, parseClipSpec, rawCatalogClip, stanceWeight } from '../../src/anim/catalog.ts';

describe('animation catalog', () => {
  it('reads every catalogued clip, the gait thresholds and the morph list', () => {
    expect(CATALOG.clips.length).toBe(67);
    expect(CATALOG.gaitThresholds).toEqual({ walkMax: 1.1, trotMax: 2.2 });
    expect(CATALOG.stackOrder).toEqual(['locomotion', 'action', 'additive', 'lookAt', 'legIK', 'springs']);
    expect(CATALOG.morphTargets).toContain('blink_L');
    expect(CATALOG.morphTargets).toContain('headKitten');
    const walk = CATALOG.byName.get('cat.loco.walk')!;
    expect(walk).toMatchObject({ layer: 'locomotion', loop: true, authoredSpeed: .7 });
    expect(walk.contacts!.LF).toEqual([[.25, .87]]);
    expect(CATALOG.byName.get('cat.move.jump_up_low')).toMatchObject({ rootMotion: true, layer: 'action' });
    expect(CATALOG.byName.get('cat.react.swat')!.events.map(e => e.name)).toEqual(['strike', 'sfx:cat.swat']);
    expect(CATALOG.byName.get('cat.layer.tail_up')!.additiveReference).toEqual({ kind: 'rest' });
  });

  it('accepts touchdown phases, [down, up] pairs and window lists for contacts', () => {
    expect(normalizeContacts({ LF: .9 }, .5)!.LF).toEqual([[.9, 1.4]]);
    expect(normalizeContacts({ RF: [.1, .4] }, null)!.RF).toEqual([[.1, .4]]);
    const list = normalizeContacts({ LH: [[.6, .2], [.1, .3]] }, null)!.LH!;
    expect(list[0]).toEqual([.1, .3]); expect(list[1]![0]).toBe(.6); expect(list[1]![1]).toBeCloseTo(1.2, 12);
    expect(normalizeContacts({}, null)).toBeNull();
    expect(normalizeContacts('nope', null)).toBeNull();
  });

  it('lets glTF extras override the catalog field by field', () => {
    const spec = parseClipSpec('cat.loco.walk', rawCatalogClip('cat.loco.walk'), { authoredSpeed: .8, events: [{ t: .5, name: 'step' }], additiveReference: { clip: 'cat.loco.idle', frame: 15 } }, 30, 1.2);
    expect(spec.authoredSpeed).toBe(.8);
    expect(spec.durationS).toBe(1.2);
    expect(spec.loop).toBe(true);
    expect(spec.events).toEqual([{ t: .5, name: 'step' }]);
    expect(spec.additiveReference).toEqual({ kind: 'clip', clip: 'cat.loco.idle', time: .5 });
    expect(parseClipSpec('cat.unknown', null, null, 30).layer).toBe('action');
  });

  it('parses additive references', () => {
    expect(parseAdditiveReference(undefined, 30)).toEqual({ kind: 'rest' });
    expect(parseAdditiveReference('bind', 30)).toEqual({ kind: 'rest' });
    expect(parseAdditiveReference('cat.loco.idle', 30)).toEqual({ kind: 'clip', clip: 'cat.loco.idle', time: 0 });
    expect(parseAdditiveReference({ clip: 'cat.rest.sit_idle', time: 1 }, 30)).toEqual({ kind: 'clip', clip: 'cat.rest.sit_idle', time: 1 });
  });

  it('ramps stance weight in before touchdown and out after lift-off, across the loop seam', () => {
    const windows = [[.9, 1.4]] as const;
    expect(stanceWeight(windows, .95)).toBe(1);
    expect(stanceWeight(windows, .2)).toBe(1);
    expect(stanceWeight(windows, .6)).toBe(0);
    expect(stanceWeight(windows, .87)).toBeGreaterThan(0);
    expect(stanceWeight(windows, .87)).toBeLessThan(1);
    expect(stanceWeight(undefined, .5)).toBe(0);
  });
});
