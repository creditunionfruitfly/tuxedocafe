import type { Material } from 'three';

export interface MaterialShaderPatch {
  /** Include any structural variant in this key; uniforms do not change it. */
  readonly key: string;
  readonly apply: Material['onBeforeCompile'];
}

const patchesByMaterial = new WeakMap<Material, Map<string, MaterialShaderPatch>>();

/** Compose in registration order without replacing three.js's material or an earlier hook. */
export function addMaterialPatch(material: Material, patch: MaterialShaderPatch): void {
  let patches = patchesByMaterial.get(material);
  if (!patches) {
    const registry = new Map<string, MaterialShaderPatch>();
    const previousHook = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey();
    material.onBeforeCompile = function (shader, renderer) {
      previousHook.call(this, shader, renderer);
      for (const { apply } of registry.values()) apply.call(this, shader, renderer);
    };
    material.customProgramCacheKey = () => JSON.stringify([previousKey, ...registry.keys()]);
    patchesByMaterial.set(material, registry);
    patches = registry;
  }
  if (patches.has(patch.key)) return;
  patches.set(patch.key, patch);
  material.needsUpdate = true;
}
