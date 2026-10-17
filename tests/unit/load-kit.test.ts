import { expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import type { CatKit } from '../../src/cats/cat-kit.ts';
import { disposeCatKit } from '../../src/cats/load-kit.ts';

it('disposes shared template geometry, materials and embedded textures once', () => {
  const geometry = new BoxGeometry(), texture = new Texture(), material = new MeshStandardMaterial({ map: texture, alphaMap: texture }), root = new Group();
  root.add(new Mesh(geometry, material), new Mesh(geometry, material));
  const disposedGeometry = vi.fn(), disposedMaterial = vi.fn(), disposedTexture = vi.fn();
  geometry.addEventListener('dispose', disposedGeometry); material.addEventListener('dispose', disposedMaterial); texture.addEventListener('dispose', disposedTexture);
  disposeCatKit({ template: { lods: [root, root, root] } } as unknown as CatKit);
  expect(disposedGeometry).toHaveBeenCalledTimes(1); expect(disposedMaterial).toHaveBeenCalledTimes(1); expect(disposedTexture).toHaveBeenCalledTimes(1);
});
