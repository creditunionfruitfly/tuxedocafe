import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Texture } from 'three';
import { assetUrl, hasAsset } from '../core/assets.ts';
import type { Tier } from '../core/tiers.ts';
import { loadCatTemplate, planCatAssets } from './cat-assets.ts';
import { createCatKit, type CatKit } from './cat-kit.ts';

/** Called only by the cat flag and viewer: default first play never downloads M2 assets. */
export async function loadCatKit(tier: Tier): Promise<CatKit> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return createCatKit(await loadCatTemplate(planCatAssets(hasAsset, tier), path => loader.loadAsync(assetUrl(path)),
    async path => { const response = await fetch(assetUrl(path)); if (!response.ok) throw new Error(`Cat asset ${path}: ${response.status}`); return response.json(); }));
}

/** Templates share geometry, materials and texture objects across resident instances. */
export function disposeCatKit(kit: CatKit, retained?: CatKit): void {
  const geometries = new Set<import('three').BufferGeometry>(), materials = new Set<import('three').Material>(), textures = new Set<Texture>();
  const keptGeometry = new Set<import('three').BufferGeometry>(), keptMaterial = new Set<import('three').Material>(), keptTexture = new Set<Texture>();
  const gather = (target: CatKit, geometry: Set<import('three').BufferGeometry>, material: Set<import('three').Material>, texture: Set<Texture>): void => {
    for (const root of target.template.lods) root?.traverse(node => {
      const mesh = node as import('three').Mesh;
      if (!mesh.isMesh) return;
      geometry.add(mesh.geometry);
      for (const item of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.add(item);
    });
    for (const item of material) for (const value of Object.values(item)) if (value instanceof Texture) texture.add(value);
  };
  gather(kit, geometries, materials, textures);
  if (retained) gather(retained, keptGeometry, keptMaterial, keptTexture);
  for (const geometry of geometries) if (!keptGeometry.has(geometry)) geometry.dispose();
  for (const material of materials) if (!keptMaterial.has(material)) material.dispose();
  for (const texture of textures) if (!keptTexture.has(texture)) texture.dispose();
}
