import { MeshStandardMaterial, type WebGLRenderer } from 'three';
import { expect, it } from 'vitest';
import { addMaterialPatch, type MaterialShaderPatch } from '../../src/render/shaders/material-patches.ts';

it('keeps existing shader hooks and keys ordered, stable, and deduplicated', () => {
  const make = () => {
    const material = new MeshStandardMaterial();
    material.customProgramCacheKey = () => 'original';
    material.onBeforeCompile = shader => { shader.fragmentShader += ':original'; };
    return material;
  };
  const makePatch = (key: string): MaterialShaderPatch => ({
    key, apply(shader) { shader.fragmentShader += `:${key}`; },
  });
  const a = make(), b = make(), c = make();
  for (const m of [a, b]) {
    addMaterialPatch(m, makePatch('bake'));
    addMaterialPatch(m, makePatch('probe'));
    addMaterialPatch(m, makePatch('probe'));
  }
  addMaterialPatch(c, makePatch('probe'));
  addMaterialPatch(c, makePatch('bake'));
  const shader = { fragmentShader: 'standard' } as Parameters<MeshStandardMaterial['onBeforeCompile']>[0];
  a.onBeforeCompile(shader, {} as WebGLRenderer);
  expect(shader.fragmentShader).toBe('standard:original:bake:probe');
  expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
  expect(a.customProgramCacheKey()).not.toBe(c.customProgramCacheKey());
});
