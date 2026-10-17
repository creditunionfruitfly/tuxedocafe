import { readFileSync, existsSync } from 'node:fs';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadCatTemplate, planCatAssets } from '../../../src/cats/cat-assets.ts';
import { createCatKit } from '../../../src/cats/cat-kit.ts';

export const hasProductionCat = (): boolean => existsSync('public/assets/art/cats/cat_master_lod0.glb') && existsSync('public/assets/art/cats/cat_anims.glb');
export async function productionKit() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // CPU pose/deformation checks do not decode images. Browser/offline checks use the real textures.
  loader.register(() => ({ name: 'CPU_texture_stub', loadTexture: async () => new Texture() }));
  return createCatKit(await loadCatTemplate(planCatAssets(path => existsSync(`public/assets/${path}`), 'desktop'), async path => {
    const bytes = readFileSync(`public/assets/${path}`);
    return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  }, async path => JSON.parse(readFileSync(`public/assets/${path}`, 'utf8'))));
}
