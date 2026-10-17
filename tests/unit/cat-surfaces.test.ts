import { describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial, NoColorSpace, SRGBColorSpace, Texture } from 'three';
import type { ResidentCat } from '../../src/cats/cat-instance.ts';
import { CatSurfaces, surfacePaths } from '../../src/cats/surfaces.ts';

function cat(id = 'miso'): ResidentCat {
  return { id, materials: ['cat_fur', 'cat_eye', 'cat_nose_leather'].map(name => { const material = new MeshStandardMaterial(); material.name = name; return material; }) } as unknown as ResidentCat;
}

describe('resident surfaces', () => {
  it('loads sampled phone maps only and opts into the linear coat mask for a future shader', async () => {
    const textures = new Map<string, Texture>(), resident = cat();
    const surfaces = new CatSurfaces(async path => { const texture = new Texture(); textures.set(path, texture); return texture; }, () => true);
    const release = await surfaces.bind(resident, 'phone'), paths = surfacePaths(resident.id, 'phone');
    expect(paths.body).toContain('body-1024.jpg'); expect(surfacePaths(resident.id, 'desktop').body).toContain('body-2048.jpg');
    for (const key of ['body', 'eye'] as const) expect(textures.get(paths[key])!.colorSpace).toBe(SRGBColorSpace);
    for (const key of ['normal', 'roughness'] as const) expect(textures.get(paths[key])!.colorSpace).toBe(NoColorSpace);
    expect([...textures.values()].every(texture => texture.flipY === false)).toBe(true);
    const fur = resident.materials[0] as MeshStandardMaterial;
    expect(fur.map).toBe(textures.get(paths.body)); expect(textures.has(paths.coat)).toBe(false);
    expect((resident.materials[2] as MeshStandardMaterial).map).toBeNull(); release();
    const next = cat(), releaseMask = await surfaces.bind(next, 'phone', { coatMask: true });
    expect((next.materials[0] as MeshStandardMaterial).userData.catCoatMask).toBe(textures.get(paths.coat));
    expect(textures.get(paths.coat)!.colorSpace).toBe(NoColorSpace); releaseMask();
  });
  it('shares in-flight maps and disposes each only after its final owner releases', async () => {
    const textures: Texture[] = [], disposed = vi.fn(), load = vi.fn(async () => { const texture = new Texture(); texture.addEventListener('dispose', disposed); textures.push(texture); return texture; });
    const surfaces = new CatSurfaces(load, () => true);
    const [first, second] = await Promise.all([surfaces.bind(cat(), 'desktop'), surfaces.bind(cat(), 'desktop')]);
    expect(load).toHaveBeenCalledTimes(4); first(); first(); expect(disposed).not.toHaveBeenCalled(); second(); expect(disposed).toHaveBeenCalledTimes(4);
    const third = await surfaces.bind(cat(), 'desktop'); expect(load).toHaveBeenCalledTimes(8); third(); expect(disposed).toHaveBeenCalledTimes(textures.length);
  });
  it('releases successful and pending acquisitions after a failure, then allows retry', async () => {
    let fail = true;
    const disposed = vi.fn(), load = vi.fn(async (path: string) => {
      if (path.endsWith('eye.png') && fail) throw new Error('interrupted');
      const texture = new Texture(); texture.addEventListener('dispose', disposed); return texture;
    });
    const surfaces = new CatSurfaces(load, () => true);
    await expect(surfaces.bind(cat(), 'low')).rejects.toThrow('interrupted'); expect(disposed).toHaveBeenCalledTimes(3);
    fail = false; const release = await surfaces.bind(cat(), 'low'); expect(load).toHaveBeenCalledTimes(8); release(); expect(disposed).toHaveBeenCalledTimes(7);
  });
  it('leaves material tints usable when optional maps have not shipped', async () => {
    const resident = cat(), load = vi.fn(); const release = await new CatSurfaces(load, () => false).bind(resident, 'low');
    expect(load).not.toHaveBeenCalled(); expect((resident.materials[0] as MeshStandardMaterial).map).toBeNull(); release();
  });
});
