import manifest from 'virtual:asset-manifest';
import { makeAssetUrl } from './asset-url.ts';

/** The only way game code should name a runtime file (AGENTS rule 11). */
export function assetUrl(path: string): string {
  return makeAssetUrl(import.meta.env.BASE_URL, manifest, path);
}

/** A file next to index.html, such as version.json, under the current base path. */
export function siteUrl(file: string): string {
  return `${import.meta.env.BASE_URL}${file.replace(/^(\.\/|\/)+/, '')}`;
}
