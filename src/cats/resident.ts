import { AnimationMixer, Mesh, SRGBColorSpace, TextureLoader, type MeshStandardMaterial, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import cats from '../../data/cats.json' with { type: 'json' };
import builds from '../../data/cat-builds.json' with { type: 'json' };
import { assetUrl } from '../core/assets.ts';
import type { Rng } from '../core/rng.ts';
import type { Tier } from '../core/tiers.ts';
import { walkable, type Waypoint } from '../scenes/navigation.ts';
import { WALK_SPEED, Wander } from './wander.ts';

export interface Resident { readonly id: string; readonly root: Object3D; readonly wander: Wander; step(dt: number): void; render(alpha: number): void }
export interface Cast { readonly residents: readonly Resident[]; dispose(): void }
// Materials that sample the shared body atlas; non-fur texels are white so anatomical tints survive.
const BODY = new Set(['cat_fur', 'cat_nose_leather', 'cat_paw_pads', 'cat_inner_ear', 'cat_mouth']);
const SPACING = .8;
export const residentLod = (tier: Tier): string => tier === 'low' ? 'lod2' : tier === 'phone' ? 'lod1' : 'lod0';
export const residentScale = (id: string): number => {
  const model = cats.cats.find(cat => cat.id === id)!.model;
  return (builds.builds as Record<string, { scale: number }>)[model.build]!.scale * model.scale;
};

/** A spot on open floor away from the cats already placed, from this cat's own stream. */
export function startSpot(rng: Rng, taken: readonly Waypoint[]): Waypoint {
  for (let tries = 0; tries < 40; tries++) {
    const spot = { x: rng.range(-4.5, 4.5), z: rng.range(-4.5, 2.5) };
    if (walkable(spot.x, spot.z) && taken.every(other => Math.hypot(other.x - spot.x, other.z - spot.z) > SPACING)) return spot;
  }
  return { x: .6, z: -1.5 };
}

/** Every resident on the shared master mesh, each with its own coat, iris, build scale and RNG stream. */
export async function loadCast(tier: Tier, world: Rng): Promise<Cast> {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const textures = new TextureLoader(), size = tier === 'high' ? 2048 : 1024;
  const map = (url: string): Promise<Texture> => textures.loadAsync(assetUrl(url)).then(texture => { texture.flipY = false; texture.colorSpace = SRGBColorSpace; return texture; });
  const [model, anims, ...maps] = await Promise.all([
    loader.loadAsync(assetUrl(`art/cats/cat_master_${residentLod(tier)}.glb`)), loader.loadAsync(assetUrl('art/cats/cat_anims.glb')),
    ...cats.cats.flatMap(cat => [map(`art/cats/textures/${cat.id}/body-${size}.jpg`), map(`art/cats/textures/${cat.id}/eye.png`)]),
  ]);
  const idleClip = anims.animations.find(a => a.name === 'cat.loco.idle')!, walkClip = anims.animations.find(a => a.name === 'cat.loco.walk')!;
  const owned = new Set<{ dispose(): void }>(maps), placed: Waypoint[] = [], wanders: Wander[] = [];
  model.scene.traverse(node => { if (node instanceof Mesh) { owned.add(node.geometry); const m = node.material as MeshStandardMaterial; owned.add(m); if (m.map) owned.add(m.map); } });
  // Cats keep a polite distance: no one picks a stroll target beside another cat or its destination.
  const crowded = (self: Wander) => (x: number, z: number) => wanders.some(other => other !== self &&
    (Math.hypot(other.x - x, other.z - z) < SPACING || (other.target && Math.hypot(other.target.x - x, other.target.z - z) < SPACING)));
  const residents = cats.cats.map((cat, index): Resident => {
    const rng = world.fork(`cat:${cat.id}`), scale = residentScale(cat.id);
    const start = cat.id === 'mochi' ? { x: .6, z: -1.5 } : startSpot(rng, placed);
    placed.push(start);
    const root = clone(model.scene);
    root.scale.setScalar(scale);
    root.traverse(node => {
      if (!(node instanceof Mesh)) return;
      node.castShadow = true; node.frustumCulled = false;
      const material = (node.material as MeshStandardMaterial).clone(); node.material = material; owned.add(material);
      if (BODY.has(material.name)) material.map = maps[index * 2]!;
      else if (material.name === 'cat_eye') material.map = maps[index * 2 + 1]!;
    });
    const wander: Wander = new Wander(rng, start, { speed: WALK_SPEED * scale, avoid: (x, z): boolean => crowded(wander)(x, z) });
    wanders.push(wander);
    const mixer = new AnimationMixer(root), idle = mixer.clipAction(idleClip), walk = mixer.clipAction(walkClip);
    idle.play(); walk.play(); walk.setEffectiveWeight(0);
    // Desynchronize idle breathing so the cast never moves in lockstep.
    idle.time = rng.range(0, idleClip.duration);
    let blend = 0;
    return {
      id: cat.id, root, wander,
      step(dt) {
        wander.step(dt);
        blend += Math.max(-dt * 4, Math.min(dt * 4, (wander.speed > .05 ? 1 : 0) - blend));
        walk.setEffectiveWeight(blend); idle.setEffectiveWeight(1 - blend); walk.timeScale = Math.max(.3, wander.speed / (WALK_SPEED * scale));
        mixer.update(dt);
      },
      render(alpha) {
        let turn = wander.yaw - wander.previousYaw; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        root.position.set(wander.previousX + (wander.x - wander.previousX) * alpha, 0, wander.previousZ + (wander.z - wander.previousZ) * alpha);
        root.rotation.y = wander.previousYaw + turn * alpha;
      },
    };
  });
  return { residents, dispose() { for (const item of owned) item.dispose(); } };
}
