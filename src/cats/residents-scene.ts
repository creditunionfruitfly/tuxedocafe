import { Vector3, type Camera, type Scene } from 'three';
import type { EventBus } from '../core/events.ts';
import { createRng } from '../core/rng.ts';
import type { Tier } from '../core/tiers.ts';
import { RESIDENTS } from './builds.ts';
import { createResidentCat } from './cat-instance.ts';
import { loadCatKit, disposeCatKit } from './load-kit.ts';
import { animationInterval, chooseLod } from './lod.ts';
import { CatSurfaces } from './surfaces.ts';

/** M2 integration seam: passive resident presentation only; needs/utility/BT belong to M2-5. */
export async function mountResidents(scene: Scene, tier: Tier, bus: EventBus) {
  const kit = await loadCatKit(tier), surfaces = new CatSurfaces(), rng = createRng('m2:resident-presentation'), point = new Vector3();
  const cats = RESIDENTS.map((data, i) => {
    const cat = createResidentCat(kit, data, { bus, rng: rng.fork(data.id), shadows: false });
    cat.animation.phase = i % 3; cat.animation.place(-2.1 + i % 4 * 1.25, 0, -1.4 - Math.floor(i / 4) * 1.4, Math.PI + i * .25);
    scene.add(cat.root); return cat;
  });
  const release = await Promise.all(cats.map(cat => surfaces.bind(cat, tier)));
  document.body.dataset.cats = String(cats.length);
  return {
    tick(dt: number): void { for (const cat of cats) cat.animation.tick(dt); },
    render(alpha: number, camera: Camera): void {
      camera.getWorldPosition(point);
      for (const cat of cats) {
        const distance = cat.animation.position.distanceTo(point);
        cat.setLevel(tier === 'low' || tier === 'phone' ? (distance < 2 ? 1 : 2) : chooseLod(distance, tier, cat.level)); cat.animation.interval = animationInterval(distance); cat.animation.render(alpha);
      }
    },
    dispose(): void { for (const done of release) done(); for (const cat of cats) cat.dispose(); disposeCatKit(kit); },
  };
}
