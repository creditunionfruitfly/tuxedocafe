import { CatAnimation } from '../../../src/anim/cat-animation.ts';
import { CATALOG } from '../../../src/anim/catalog.ts';
import { ClipLibrary, restPoseOf } from '../../../src/anim/clip-library.ts';
import { parseExpressions } from '../../../src/anim/expressions.ts';
import { CatRig } from '../../../src/anim/rig.ts';
import { standInClips } from '../../../src/anim/stand-in-clips.ts';
import { EventBus } from '../../../src/core/events.ts';
import { createRng } from '../../../src/core/rng.ts';
import { SKELETON, syntheticCat } from './synthetic-cat.ts';

/** A full cat runtime on the synthetic rig with the procedural stand-in clips. */
export function syntheticRuntime(options: { id?: string; twist?: boolean } = {}) {
  const cat = syntheticCat({ twist: options.twist });
  const rig = new CatRig(cat.root, cat.bones);
  const library = new ClipLibrary(standInClips(CATALOG, rig), restPoseOf(rig));
  const bus = new EventBus(), events: string[] = [];
  bus.on('cat:anim-event', e => events.push(`${e.cat}:${e.clip}:${e.name}`));
  const animation = new CatAnimation({
    id: options.id ?? 'mochi', rig, clips: library.bind(rig, () => 1), expressions: parseExpressions(null, CATALOG),
    rng: createRng(`test:${options.id ?? 'mochi'}`), ikChains: SKELETON.ikChains, speedFactor: 1, bus,
  });
  return { cat, rig, library, bus, events, animation };
}
