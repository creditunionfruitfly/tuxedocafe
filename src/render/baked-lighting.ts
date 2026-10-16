import { LightProbe, Mesh, MeshStandardMaterial, NoColorSpace, ShaderChunk, TextureLoader, type Object3D, type Texture } from 'three';
import { assetUrl } from '../core/assets.ts';

type RGB = [number, number, number];
export interface RoomProbe { position: RGB; sh: RGB[] }
export interface CafeBake {
  signature: string; resolution: number; exposure: number; probes: RoomProbe[];
  metadata: { directIncluded: boolean; colorSpace: string; encoding: 'rgbm' };
}

export function validateCafeBake(value: CafeBake): CafeBake {
  const vector = (v: number[]): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!value || !/^[a-f0-9]{64}$/.test(value.signature) || !Number.isFinite(value.exposure) || value.exposure <= 0
    || !Number.isInteger(value.resolution) || value.resolution < 256 || value.resolution > 4096
    || value.metadata?.colorSpace !== 'linear' || value.metadata.encoding !== 'rgbm' || typeof value.metadata.directIncluded !== 'boolean'
    || !Array.isArray(value.probes) || !value.probes.length
    || value.probes.some(p => !vector(p.position) || !Array.isArray(p.sh) || p.sh.length !== 9 || p.sh.some(v => !vector(v)))) {
    throw new Error('The café lighting bake is invalid.');
  }
  return value;
}

/** Preserve real-time GGX highlights; diffuse illumination comes from the atlas. */
export function bakedDiffuseShader(fragment: string, includesDirect: boolean): string {
  const marker = '#include <lights_fragment_maps>';
  const multiplier = 'lightMapTexel.rgb * lightMapIntensity';
  if (!fragment.includes(marker) || !ShaderChunk.lights_fragment_maps.includes(multiplier)) throw new Error('The pinned material shader no longer supports the café bake.');
  const maps = ShaderChunk.lights_fragment_maps.replace(multiplier, 'lightMapTexel.rgb * lightMapTexel.a * lightMapIntensity');
  return fragment.replace(marker, `
irradiance = vec3( 0.0 );
${maps}
iblIrradiance = vec3( 0.0 );
${includesDirect ? 'reflectedLight.directDiffuse = vec3( 0.0 );' : ''}
`);
}

/** Room probes supply diffuse radiance; the reflection cubemap supplies GGX only. */
export function useRoomProbe(root: Object3D): void {
  root.traverse(node => {
    if (!(node instanceof Mesh) || node.geometry.userData.bakedDaylight === true) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>',
          '#include <lights_fragment_maps>\niblIrradiance = vec3( 0.0 );');
      };
      material.customProgramCacheKey = () => 'cafe-room-probe'; material.needsUpdate = true;
    }
  });
}

/** Clone shared materials so a carried bowl never inherits static illumination. */
export function bindCafeBake(root: Object3D, lightMap: Texture, bake: CafeBake): () => void {
  lightMap.channel = 1; lightMap.flipY = false; lightMap.colorSpace = NoColorSpace;
  const clones = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  let receivers = 0;
  root.traverse(node => {
    if (!(node instanceof Mesh) || node.geometry.userData.bakedDaylight !== true) return;
    if (!node.geometry.hasAttribute('uv1')) throw new Error(`Baked mesh ${node.name} has no lightmap UVs.`);
    const convert = (material: MeshStandardMaterial): MeshStandardMaterial => {
      if (!(material instanceof MeshStandardMaterial)) throw new Error(`Baked mesh ${node.name} has no PBR material.`);
      let copy = clones.get(material);
      if (!copy) {
        copy = material.clone(); copy.lightMap = lightMap; copy.lightMapIntensity = bake.exposure;
        copy.onBeforeCompile = shader => { shader.fragmentShader = bakedDiffuseShader(shader.fragmentShader, bake.metadata.directIncluded); };
        copy.customProgramCacheKey = () => `cafe-bake-${Number(bake.metadata.directIncluded)}`;
        copy.needsUpdate = true; clones.set(material, copy);
      }
      return copy;
    };
    node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
    receivers++;
  });
  if (!receivers) throw new Error('The café contains no baked lighting receivers.');
  return () => { lightMap.dispose(); };
}

/** Reuses coefficients and weights; moving the player allocates no new objects. */
export function makeRoomProbe(samples: RoomProbe[]): { light: LightProbe; update(x: number, y: number, z: number): void } {
  const light = new LightProbe(), weights = new Float64Array(samples.length);
  return { light, update(x, y, z) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i]!.position, d = (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2;
      weights[i] = 1 / Math.max(.0025, d); sum += weights[i]!;
    }
    for (let coefficient = 0; coefficient < 9; coefficient++) {
      const v = light.sh.coefficients[coefficient]!; v.set(0, 0, 0);
      for (let i = 0; i < samples.length; i++) {
        const c = samples[i]!.sh[coefficient]!, w = weights[i]! / sum;
        v.x += c[0] * w; v.y += c[1] * w; v.z += c[2] * w;
      }
    }
  } };
}

export async function loadCafeBake(root: Object3D): Promise<{ probe: ReturnType<typeof makeRoomProbe>; dispose(): void }> {
  const response = await fetch(assetUrl('art/lighting/cafe-daylight.json'));
  if (!response.ok) throw new Error('The café lighting metadata could not load.');
  const bake = validateCafeBake(await response.json() as CafeBake);
  const texture = await new TextureLoader().loadAsync(assetUrl('art/lighting/cafe-daylight.png'));
  const dispose = bindCafeBake(root, texture, bake), probe = makeRoomProbe(bake.probes);
  probe.update(0, 1.3, 2.2);
  document.body.dataset.bake = bake.signature.slice(0, 12);
  document.body.dataset.bakeResolution = String(bake.resolution);
  return { probe, dispose };
}
