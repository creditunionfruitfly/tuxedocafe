import {
  Color, Mesh, MeshStandardMaterial, ShaderChunk, SkinnedMesh, SRGBColorSpace, TextureLoader,
  type Texture, type WebGLRenderer,
} from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import cats from '../../data/cats.json' with { type: 'json' };
import { assetUrl } from '../core/assets.ts';
import type { Tier } from '../core/tiers.ts';

const BODY = new Set(['cat_fur', 'cat_nose_leather', 'cat_paw_pads', 'cat_inner_ear', 'cat_mouth']);
const ROOT = 'art/cats/textures';

const pixelCoat = cats.cats.find(cat => cat.id === 'pixel')!.model.coat;
const tabbyCoats = {
  biscuit: cats.cats.find(cat => cat.id === 'biscuit')!.model.coat,
  pepper: cats.cats.find(cat => cat.id === 'pepper')!.model.coat,
};
const usesTabbyFinish = (id: string): id is keyof typeof tabbyCoats => id === 'biscuit' || id === 'pepper';

interface ResidentTextures {
  body: Texture;
  eye: Texture;
  rightEye?: Texture;
  normal?: Texture;
}

const usesKtx = (id: string): boolean => id === 'juniper' || id === 'pixel' || usesTabbyFinish(id);

const bodySize = (tier: Tier): number => tier === 'high' || tier === 'desktop' ? 2048 : 1024;

async function loadCompressed(id: string, size: number, loader: KTX2Loader): Promise<ResidentTextures> {
  const ktx = (name: string): Promise<Texture> => loader.loadAsync(assetUrl(`${ROOT}/${id}/${name}.ktx2`));
  const separateIrises = id === 'juniper';
  const results = await Promise.allSettled([
    ktx(`body-${size}`),
    ktx(separateIrises ? 'eye-left-512' : 'eye-512'),
    id === 'pepper' ? undefined : ktx(`normal-${size}`),
    separateIrises ? ktx('eye-right-512') : undefined,
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    for (const result of results) if (result.status === 'fulfilled') result.value?.dispose();
    throw failure.reason;
  }
  const [body, eye, normal, rightEye] = results.map(result => (result as PromiseFulfilledResult<Texture | undefined>).value);
  return { body: body!, eye: eye!, normal, rightEye };
}

async function loadResident(id: string, tier: Tier, compressed: KTX2Loader | undefined): Promise<ResidentTextures> {
  const loader = new TextureLoader();
  const map = async (name: string): Promise<Texture> => {
    const texture = await loader.loadAsync(assetUrl(`${ROOT}/${id}/${name}`));
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    return texture;
  };
  if (compressed && usesKtx(id)) {
    try {
      return await loadCompressed(id, bodySize(tier), compressed);
    } catch (error) {
      console.warn(`${id} compressed textures could not load`, error);
    }
  }
  const size = usesTabbyFinish(id) ? bodySize(tier) : tier === 'high' ? 2048 : 1024;
  const results = await Promise.allSettled([map(`body-${size}.jpg`), map('eye.png')]);
  const [body, eye] = results;
  if (body?.status === 'fulfilled' && eye?.status === 'fulfilled') return { body: body.value, eye: eye.value };
  for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
  throw new Error(`Could not load ${id} textures`, { cause: results.find(result => result.status === 'rejected')?.reason });
}

/** One transcoder and worker pool for the whole cast, including phone tiers. */
export async function loadResidentTextures(ids: readonly string[], tier: Tier, renderer: WebGLRenderer): Promise<ResidentTextures[]> {
  let compressed: KTX2Loader | undefined;
  if (ids.some(usesKtx)) {
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
    compressed = new KTX2Loader().setWorkerLimit(tier === 'high' || tier === 'desktop' ? 2 : 1).detectSupport(renderer);
  }
  try {
    const results = await Promise.allSettled(ids.map(id => loadResident(id, tier, compressed)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
      for (const result of results) {
        if (result.status === 'fulfilled') for (const texture of Object.values(result.value)) texture?.dispose();
      }
      throw failure.reason;
    }
    return results.map(result => (result as PromiseFulfilledResult<ResidentTextures>).value);
  } finally {
    if (compressed?.transcoderPending) compressed.dispose();
  }
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

function applyPixelFinish(mesh: Mesh, material: MeshStandardMaterial): void {
  // On the lower LODs the nose, pads and ears share the body draw.
  const batched = mesh.geometry.hasAttribute('_surface');
  const fur = batched ? '1.0 - smoothstep(0.25, 0.75, pixelSurface)' : '1.0';
  material.roughness = .76;
  material.onBeforeCompile = shader => {
    shader.uniforms.pixelSheenColor = { value: new Color(pixelCoat.palette.sheen) };
    shader.uniforms.pixelSheen = { value: pixelCoat.sheen };
    if (batched) {
      shader.vertexShader = 'attribute float _surface; varying float pixelSurface;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\npixelSurface = _surface;');
    }
    const surface = batched ? 'varying float pixelSurface;\n' : '';
    shader.fragmentShader = surface + 'uniform vec3 pixelSheenColor; uniform float pixelSheen;\n' +
      shader.fragmentShader.replace('#include <opaque_fragment>', `
        // Keep enough soft fill to read the black pelt in the shadows.
        float pixelFacing = saturate(dot(nonPerturbedNormal, normalize(vViewPosition)));
        float pixelRim = pow(1.0 - pixelFacing, 2.8);
        vec3 pixelLuma = vec3(0.2126, 0.7152, 0.0722);
        float pixelLight = saturate(1.25 * dot(totalDiffuse, pixelLuma) / max(dot(diffuseColor.rgb, pixelLuma), 0.001));
        float pixelUpper = smoothstep(0.0, 0.92, dot(normal, viewMatrix[1].xyz));
        vec3 pixelTint = mix(vec3(dot(pixelSheenColor, pixelLuma)), pixelSheenColor, 0.28);
        float pixelReflection = 0.28 * pixelUpper + 0.52 * pixelRim;
        // Reduce the standard dielectric reflection on fur, including the room PMREM.
        outgoingLight += (pixelTint * pixelLight * (0.36 + pixelSheen * pixelReflection)
          - 0.30 * totalSpecular) * (${fur});
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey = () => batched ? 'pixel-bombay-batched' : 'pixel-bombay-fur';
}

function applyTabbyFinish(mesh: Mesh, material: MeshStandardMaterial, sheen: number): void {
  const batched = mesh.geometry.hasAttribute('_surface');
  material.roughness = .84;
  material.onBeforeCompile = shader => {
    shader.uniforms.tabbySheen = { value: sheen };
    if (batched) {
      shader.vertexShader = 'attribute float _surface; varying float tabbySurface;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntabbySurface = _surface;');
    }
    const surface = batched ? 'varying float tabbySurface;\n' : '';
    const fur = batched ? '1.0 - step(0.5, tabbySurface)' : '1.0';
    shader.fragmentShader = surface + 'uniform float tabbySheen;\n' +
      shader.fragmentShader.replace('#include <opaque_fragment>', `
        float grazing = 1.0 - saturate(dot(nonPerturbedNormal, normalize(vViewPosition)));
        outgoingLight += totalDiffuse * (0.24 * tabbySheen * pow2(grazing)) * (${fur});
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey = () => batched ? 'tabby-batched' : 'tabby-fur';
}

export function applyResidentTextures(mesh: Mesh, material: MeshStandardMaterial, textures: ResidentTextures, id: string): void {
  const { body, eye, normal, rightEye } = textures;
  if (BODY.has(material.name)) {
    material.map = body;
    // The tabby reworks and the compressed Pixel atlas include their own leather pigment.
    if (usesTabbyFinish(id) || (id === 'pixel' && normal)) material.vertexColors = false;
    if (id === 'pepper' && material.name === 'cat_nose_leather') material.roughness = .58;
    if (material.name === 'cat_fur') {
      if (normal) {
        material.normalMap = normal;
        material.normalScale.setScalar(id === 'pixel' ? .85 : .66);
      }
      if (id === 'pixel') applyPixelFinish(mesh, material);
      if (usesTabbyFinish(id)) applyTabbyFinish(mesh, material, tabbyCoats[id].sheen);
    }
  } else if (material.name === 'cat_eye') {
    material.map = mesh.name === 'cat_eye_R' && rightEye ? rightEye : eye;
    if (rightEye && mesh instanceof SkinnedMesh && mesh.name === 'cat_eyes') {
      const rightJoint = mesh.skeleton.bones.findIndex(bone => bone.name === 'eye_R');
      bindBatchedIris(material, rightEye, rightJoint);
    }
  } else if (id === 'pixel' && material.name === 'cat_cornea') {
    material.color.set('#070609');
    material.roughness = .075;
  } else if (usesTabbyFinish(id) && material.name === 'cat_cornea') {
    material.color.set(id === 'pepper' ? '#343724' : '#3B2A19');
    material.roughness = .075;
  } else if (id === 'pixel' && material.name === 'cat_whisker') {
    material.color.set('#302a31');
  }
}
