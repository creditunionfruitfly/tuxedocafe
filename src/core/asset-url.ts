/** Content hashes of every file under public/assets/, keyed by path below it. */
export type AssetManifest = Readonly<Record<string, string>>;

/**
 * The URL for a file in public/assets/, with its content hash as a cache-buster.
 * Pages sets its own cache headers, so `?v=<hash>` keeps a fresh load from
 * mixing new code with stale cached files (README, Playtest builds and CI/CD).
 *
 *   makeAssetUrl('/tuxedocafe/', manifest, 'art/cats/cat_mochi_lod0.glb')
 *   // → '/tuxedocafe/assets/art/cats/cat_mochi_lod0.glb?v=3f9c1a2b7d0e'
 */
export function makeAssetUrl(base: string, manifest: AssetManifest, path: string): string {
  const clean = path.replace(/^(\.\/|\/)+/, '');
  const hash = manifest[clean];
  if (hash === undefined) {
    throw new Error(`Unknown asset "${clean}". Add it under public/assets/ and rebuild.`);
  }
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}assets/${clean}?v=${hash}`;
}
