import { AdditiveAnimationBlendMode, AnimationMixer, AnimationUtils, LoopOnce, LoopRepeat, Mesh, SRGBColorSpace, TextureLoader, type AnimationAction, type AnimationClip, type MeshStandardMaterial, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import cats from '../../data/cats.json' with { type: 'json' };
import builds from '../../data/cat-builds.json' with { type: 'json' };
import catalog from '../../data/animation-catalog.json' with { type: 'json' };
import { assetUrl } from '../core/assets.ts';
import type { Rng } from '../core/rng.ts';
import type { Tier } from '../core/tiers.ts';
import { walkable, type Waypoint } from '../scenes/navigation.ts';
import { Brain, type World } from './brain.ts';

export interface Resident { readonly id: string; readonly root: Object3D; readonly brain: Brain; step(dt: number, world: World): void; render(alpha: number): void }
export interface Cast { readonly residents: readonly Resident[]; step(dt: number, player: { x: number; z: number } | null): void; dispose(): void }
// Materials that sample the shared body atlas; non-fur texels are white so anatomical tints survive.
const BODY = new Set(['cat_fur', 'cat_nose_leather', 'cat_paw_pads', 'cat_inner_ear', 'cat_mouth']);
const SPACING = .8, FADE = .25;
const CATALOG = new Map(catalog.clips.map(clip => [clip.name, clip]));
/** Bands that pick the base gait clip from real speed (m/s at adult scale). */
const gaitFor = (speed: number): string => speed < .05 ? 'cat.loco.idle' : speed < 1.15 ? 'cat.loco.walk' : speed < 2.5 ? 'cat.loco.trot' : 'cat.loco.gallop';
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
  // Additive layers are authored against a reference pose; convert them once for every cat's mixer.
  const clips = new Map<string, AnimationClip>(anims.animations.map(clip => [clip.name, clip]));
  for (const [name, clip] of clips) {
    if (CATALOG.get(name)?.layer !== 'additive') continue;
    const additive = clip.clone(), [refName, refSeconds] = String(clip.userData?.additiveReference ?? '').split('@'), ref = clips.get(refName ?? '');
    AnimationUtils.makeClipAdditive(additive, ref ? Math.round(Number(refSeconds ?? 0) * 30) : 0, ref ?? additive, 30);
    additive.blendMode = AdditiveAnimationBlendMode; clips.set(name, additive);
  }
  const owned = new Set<{ dispose(): void }>(maps), placed: Waypoint[] = [], brains: Brain[] = [];
  model.scene.traverse(node => { if (node instanceof Mesh) { owned.add(node.geometry); const m = node.material as MeshStandardMaterial; owned.add(m); if (m.map) owned.add(m.map); } });
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
    const brain = new Brain(cat.id, rng, start, scale), mover = brain.mover, mixer = new AnimationMixer(root), actions = new Map<string, AnimationAction>();
    brains.push(brain);
    const action = (name: string): AnimationAction | null => {
      let found = actions.get(name);
      const clip = clips.get(name);
      if (!found && clip) { found = mixer.clipAction(clip); found.setLoop(CATALOG.get(name)?.loop ? LoopRepeat : LoopOnce, Infinity); found.clampWhenFinished = true; actions.set(name, found); }
      return found ?? null;
    };
    // The base gait loops always run; their weights follow speed, and an action fades them out.
    const gaits = ['cat.loco.idle', 'cat.loco.walk', 'cat.loco.trot', 'cat.loco.gallop'].map(name => action(name)!);
    for (const gait of gaits) { gait.play(); gait.setEffectiveWeight(0); }
    gaits[0]!.time = rng.range(0, gaits[0]!.getClip().duration);
    const weights = new Map<AnimationAction, number>();
    let current: AnimationAction | null = null, currentId = -1, transition = 0, transitionName: string | null = null;
    const fade = (target: AnimationAction, goal: number, dt: number, rate: number): void => {
      const w = weights.get(target) ?? 0, next = w + Math.max(-dt * rate, Math.min(dt * rate, goal - w));
      weights.set(target, next); target.setEffectiveWeight(next); if (next > 0 && !target.isRunning()) target.play();
    };
    return {
      id: cat.id, root, brain,
      step(dt, shared) {
        brain.step(dt, shared);
        for (const pulse of brain.pulses) {
          if (pulse === 'cat.loco.start' || pulse === 'cat.loco.stop') { if (!brain.action) { transitionName = pulse; transition = CATALOG.get(pulse)?.durationS ?? .5; } continue; }
          action(pulse)?.reset().setEffectiveWeight(1).play();
        }
        transition -= dt;
        const wanted = brain.action ?? (transition > 0 ? transitionName : null), id = brain.action ? brain.actionId : transition > 0 ? -2 : -1;
        if (id !== currentId) {
          current?.fadeOut(FADE); current = wanted ? action(wanted) : null; currentId = id;
          current?.reset().setEffectiveWeight(1).fadeIn(FADE).play();
        }
        if (current && wanted === 'cat.react.walk_away') current.timeScale = Math.max(.3, mover.speed / (.85 * scale));
        const speed = mover.speed / scale, gait = gaitFor(speed), base = current ? 0 : 1;
        for (const g of gaits) {
          fade(g, g.getClip().name === gait ? base : 0, dt, 1 / FADE);
          const authored = CATALOG.get(g.getClip().name)?.authoredSpeed ?? 0;
          if (authored) g.timeScale = Math.max(.3, speed / authored);
        }
        for (const [name, layer] of actions) if (CATALOG.get(name)?.layer === 'additive' && CATALOG.get(name)?.loop) fade(layer, brain.layers.includes(name) ? 1 : 0, dt, 4);
        for (const name of brain.layers) { const layer = action(name); if (layer && !weights.has(layer)) fade(layer, 0, dt, 4); }
        mixer.update(dt);
      },
      render(alpha) {
        let turn = mover.yaw - mover.previousYaw; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        root.position.set(mover.previousX + (mover.x - mover.previousX) * alpha, mover.previousY + (mover.y - mover.previousY) * alpha, mover.previousZ + (mover.z - mover.previousZ) * alpha);
        root.rotation.y = mover.previousYaw + turn * alpha;
      },
    };
  });
  return {
    residents,
    step(dt, player) { const shared: World = { player, cats: brains }; for (const resident of residents) resident.step(dt, shared); },
    dispose() { for (const item of owned) item.dispose(); },
  };
}
