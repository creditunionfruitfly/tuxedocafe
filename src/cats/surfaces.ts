import { MeshStandardMaterial, NoColorSpace, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { assetUrl, hasAsset } from '../core/assets.ts';
import type { Tier } from '../core/tiers.ts';
import type { ResidentCat } from './cat-instance.ts';
import { isPhoneTier } from './lod.ts';

/** Body/eye colour is sRGB; normal, roughness and future coat masks remain linear data. */
export function surfacePaths(id: string, tier: Tier): { body: string; eye: string; coat: string; normal: string; roughness: string } {
  const folder = `art/cats/textures/${id}`, shared = 'art/cats/textures/shared';
  return { body: `${folder}/body-${isPhoneTier(tier) ? 1024 : 2048}.jpg`, eye: `${folder}/eye.png`, coat: `${folder}/coat.png`, normal: `${shared}/fur-normal.png`, roughness: `${shared}/fur-roughness.png` };
}
interface Entry { refs: number; promise: Promise<Texture>; texture: Texture | null }

/** Reference-counted shared maps; switching residents releases their full-size colour map. */
export class CatSurfaces {
  readonly #maps = new Map<string, Entry>();
  readonly #load: (path: string) => Promise<Texture>;
  readonly #has: (path: string) => boolean;
  constructor(load: (path: string) => Promise<Texture> = path => new TextureLoader().loadAsync(assetUrl(path)), has: (path: string) => boolean = hasAsset) {
    this.#load = load; this.#has = has;
  }
  /** `coatMask` is opt-in until a fur shader actually samples its linear RGBA channels. */
  async bind(cat: ResidentCat, tier: Tier, options: { coatMask?: boolean } = {}): Promise<() => void> {
    const paths = surfacePaths(cat.id, tier), releases: (() => void)[] = [];
    const acquire = async (path: string, colour: boolean): Promise<Texture | null> => {
      if (!this.#has(path)) return null;
      let entry = this.#maps.get(path);
      if (!entry) {
        const created: Entry = { refs: 0, texture: null, promise: Promise.resolve(null as unknown as Texture) };
        created.promise = this.#load(path).then(texture => {
          texture.flipY = false; texture.colorSpace = colour ? SRGBColorSpace : NoColorSpace; created.texture = texture;
          if (!created.refs) texture.dispose(); return texture;
        });
        this.#maps.set(path, created); entry = created;
      }
      entry.refs++;
      const owned = entry;
      releases.push(() => { if (--owned.refs === 0) { owned.texture?.dispose(); if (this.#maps.get(path) === owned) this.#maps.delete(path); } });
      return entry.promise;
    };
    try {
      const [body, eye, coat, normal, roughness] = await Promise.all([acquire(paths.body, true), acquire(paths.eye, true), options.coatMask ? acquire(paths.coat, false) : null, acquire(paths.normal, false), acquire(paths.roughness, false)]);
      for (const material of cat.materials) {
        if (!(material instanceof MeshStandardMaterial)) continue;
        if (material.name === 'cat_fur') {
          if (body) { material.map = body; material.color.set('#ffffff'); }
          material.normalMap = normal; material.roughnessMap = roughness; material.normalScale.set(.25, .25);
          if (coat) material.userData.catCoatMask = coat;
        }
        if (material.name === 'cat_eye' && eye) { material.map = eye; material.color.set('#ffffff'); }
        material.needsUpdate = true;
      }
    } catch (error) { for (const release of releases) release(); throw error; }
    let released = false;
    return () => { if (released) return; released = true; for (const release of releases) release(); };
  }
}
