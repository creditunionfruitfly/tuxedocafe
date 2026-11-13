import {
  Mesh, MeshStandardMaterial, ShaderChunk, SkinnedMesh, SRGBColorSpace, TextureLoader,
  type Texture, type WebGLRenderer,
} from 'three';
import { assetUrl } from '../core/assets.ts';
import type { Tier } from '../core/tiers.ts';

// White texels outside fur keep the anatomical vertex tints on the batched LODs.
const BODY = new Set(['cat_fur', 'cat_nose_leather', 'cat_paw_pads', 'cat_inner_ear', 'cat_mouth']);
const ROOT = 'art/cats/textures';

export interface ResidentTextures {
  body: Texture;
  eye: Texture;
  juniper?: { rightEye: Texture; normal: Texture };
}

async function loadJuniper(tier: Tier, renderer: WebGLRenderer): Promise<ResidentTextures> {
  const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
  const desktop = tier === 'high' || tier === 'desktop';
  const loader = new KTX2Loader().setWorkerLimit(desktop ? 2 : 1).detectSupport(renderer);
  const size = desktop ? 2048 : 1024;
  const results = await Promise.allSettled([
    `body-${size}`, 'eye-left-512', 'eye-right-512', `normal-${size}`,
  ].map(async name => loader.loadAsync(assetUrl(`${ROOT}/juniper/${name}.ktx2`))));
  if (loader.transcoderPending) loader.dispose();
  const [body, eye, rightEye, normal] = results;
  if (body?.status === 'fulfilled' && eye?.status === 'fulfilled' &&
      rightEye?.status === 'fulfilled' && normal?.status === 'fulfilled') {
    return { body: body.value, eye: eye.value, juniper: { rightEye: rightEye.value, normal: normal.value } };
  }
  for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
  throw new Error('Juniper texture load failed', { cause: results.find(result => result.status === 'rejected')?.reason });
}

export async function loadResidentTextures(id: string, tier: Tier, renderer: WebGLRenderer): Promise<ResidentTextures> {
  if (id === 'juniper') {
    try {
      return await loadJuniper(tier, renderer);
    } catch (error) {
      console.warn('Juniper’s compressed textures could not load', error);
    }
  }
  const loader = new TextureLoader();
  const map = async (name: string): Promise<Texture> => {
    const texture = await loader.loadAsync(assetUrl(`${ROOT}/${id}/${name}`));
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    return texture;
  };
  const [body, eye] = await Promise.all([map(`body-${tier === 'high' ? 2048 : 1024}.jpg`), map('eye.png')]);
  return { body, eye };
}

/** The low LOD batches both globes. Each globe's vertices are rigidly bound to its eye joint. */
function bindBatchedIris(material: MeshStandardMaterial, rightEye: Texture, rightJoint: number): void {
  material.onBeforeCompile = shader => {
    shader.uniforms.rightIris = { value: rightEye };
    shader.uniforms.rightEyeJoint = { value: rightJoint };
    shader.vertexShader = 'uniform float rightEyeJoint;\nvarying float useRightIris;\n' +
      shader.vertexShader.replace('#include <skinbase_vertex>', `#include <skinbase_vertex>
        useRightIris = abs(skinIndex.x - rightEyeJoint) < 0.5 ? 1.0 : 0.0;`);
    shader.fragmentShader = 'uniform sampler2D rightIris;\nvarying float useRightIris;\n' +
      shader.fragmentShader.replace('#include <map_fragment>', ShaderChunk.map_fragment.replace(
        'texture2D( map, vMapUv )',
        '(useRightIris > 0.5 ? texture2D( rightIris, vMapUv ) : texture2D( map, vMapUv ))',
      ));
  };
  material.customProgramCacheKey = () => 'juniper-batched-irises';
}

export function applyResidentTextures(mesh: Mesh, material: MeshStandardMaterial, textures: ResidentTextures): void {
  const { body, eye, juniper } = textures;
  if (BODY.has(material.name)) {
    material.map = body;
    if (juniper && material.name === 'cat_fur') {
      material.normalMap = juniper.normal;
      material.normalScale.setScalar(.66);
    }
  } else if (material.name === 'cat_eye') {
    material.map = juniper && mesh.name === 'cat_eye_R' ? juniper.rightEye : eye;
    if (juniper && mesh instanceof SkinnedMesh && mesh.name === 'cat_eyes') {
      const rightJoint = mesh.skeleton.bones.findIndex(bone => bone.name === 'eye_R');
      bindBatchedIris(material, juniper.rightEye, rightJoint);
    }
  }
}
