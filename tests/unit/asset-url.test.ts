import { describe, expect, it } from 'vitest';
import { makeAssetUrl } from '../../src/core/asset-url.ts';

const manifest = { 'art/cats/cat_mochi_lod0.glb': '3f9c1a2b7d0e' };

describe('makeAssetUrl', () => {
  it('prefixes the base path and appends the content hash', () => {
    expect(makeAssetUrl('/tuxedocafe/', manifest, 'art/cats/cat_mochi_lod0.glb')).toBe(
      '/tuxedocafe/assets/art/cats/cat_mochi_lod0.glb?v=3f9c1a2b7d0e',
    );
  });

  it('works under a snapshot or decoy base', () => {
    expect(makeAssetUrl('/tuxedocafe/m3/', manifest, 'art/cats/cat_mochi_lod0.glb')).toMatch(/^\/tuxedocafe\/m3\/assets\//);
    expect(makeAssetUrl('/tuxedocafe/base-check', manifest, 'art/cats/cat_mochi_lod0.glb')).toMatch(
      /^\/tuxedocafe\/base-check\/assets\//,
    );
  });

  it('ignores a leading slash or ./ in the asset path', () => {
    expect(makeAssetUrl('/', manifest, '/art/cats/cat_mochi_lod0.glb')).toBe(makeAssetUrl('/', manifest, './art/cats/cat_mochi_lod0.glb'));
  });

  it('throws on a file that is not in public/assets/', () => {
    expect(() => makeAssetUrl('/tuxedocafe/', manifest, 'art/missing.glb')).toThrow(/Unknown asset/);
  });
});
