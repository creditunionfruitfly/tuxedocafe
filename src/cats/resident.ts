import { AnimationMixer, Mesh, SRGBColorSpace, type MeshStandardMaterial, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TextureLoader } from 'three';
import { assetUrl } from '../core/assets.ts';
import type { Rng } from '../core/rng.ts';
import type { Tier } from '../core/tiers.ts';
import { WALK_SPEED, Wander } from './wander.ts';

export interface Resident { readonly id: string; readonly root: Object3D; readonly wander: Wander; step(dt: number): void; render(alpha: number): void; dispose(): void }
// Materials that sample the shared body atlas; non-fur texels are white so anatomical tints survive.
const BODY = new Set(['cat_fur', 'cat_nose_leather', 'cat_paw_pads', 'cat_inner_ear', 'cat_mouth']);
export const residentLod = (tier: Tier): string => tier === 'low' ? 'lod2' : tier === 'phone' ? 'lod1' : 'lod0';

/** One resident on the shared master mesh, with its own coat and iris maps from the Artist's checkpoint. */
export async function loadResident(id: string, tier: Tier, rng: Rng, start: { x: number; z: number }): Promise<Resident> {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const textures = new TextureLoader(), size = tier === 'high' || tier === 'desktop' ? 2048 : 1024;
  const [model, anims, body, eye] = await Promise.all([
    loader.loadAsync(assetUrl(`art/cats/cat_master_${residentLod(tier)}.glb`)), loader.loadAsync(assetUrl('art/cats/cat_anims.glb')),
    textures.loadAsync(assetUrl(`art/cats/textures/${id}/body-${size}.jpg`)), textures.loadAsync(assetUrl(`art/cats/textures/${id}/eye.png`)),
  ]);
  for (const map of [body, eye]) { map.flipY = false; map.colorSpace = SRGBColorSpace; }
  const root = model.scene, owned = new Set<Texture>([body, eye]);
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    node.castShadow = true; node.frustumCulled = false;
    const material = node.material as MeshStandardMaterial;
    if (BODY.has(material.name)) { material.map = body; material.needsUpdate = true; }
    else if (material.name === 'cat_eye') { material.map?.dispose(); material.map = eye; material.needsUpdate = true; }
    if (material.map) owned.add(material.map);
  });
  const mixer = new AnimationMixer(root), clip = (name: string) => anims.animations.find(a => a.name === name);
  const idle = mixer.clipAction(clip('cat.loco.idle')!), walk = mixer.clipAction(clip('cat.loco.walk')!);
  idle.play(); walk.play(); walk.setEffectiveWeight(0);
  const wander = new Wander(rng, start);
  let blend = 0;
  return {
    id, root, wander,
    step(dt) {
      wander.step(dt);
      blend += Math.max(-dt * 4, Math.min(dt * 4, (wander.speed > .05 ? 1 : 0) - blend));
      walk.setEffectiveWeight(blend); idle.setEffectiveWeight(1 - blend); walk.timeScale = Math.max(.3, wander.speed / WALK_SPEED);
      mixer.update(dt);
    },
    render(alpha) {
      let turn = wander.yaw - wander.previousYaw; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      root.position.set(wander.previousX + (wander.x - wander.previousX) * alpha, 0, wander.previousZ + (wander.z - wander.previousZ) * alpha);
      root.rotation.y = wander.previousYaw + turn * alpha;
    },
    dispose() {
      mixer.stopAllAction();
      root.traverse(node => { if (node instanceof Mesh) { node.geometry.dispose(); (node.material as MeshStandardMaterial).dispose(); } });
      for (const texture of owned) texture.dispose();
    },
  };
}
