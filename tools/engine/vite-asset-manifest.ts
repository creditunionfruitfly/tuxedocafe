import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import type { AssetManifest } from '../../src/core/asset-url.ts';

const VIRTUAL_ID = 'virtual:asset-manifest';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** A 12-hex-digit content hash for every file under `dir`, skipping dotfiles and sidecars. */
export function hashAssets(dir: string): AssetManifest {
  const found: [string, string][] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      if (name.startsWith('.')) continue;
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (!name.endsWith('.prov.yaml')) {
        const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
        found.push([relative(dir, path).split(sep).join('/'), hash]);
      }
    }
  };
  try {
    walk(dir);
  } catch {
    // No assets yet.
  }
  found.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(found);
}

/**
 * Bakes the hashes into the bundle as `virtual:asset-manifest`, so code and
 * cache-busters always ship together (README, Playtest builds and CI/CD).
 */
export function assetManifest(options: { dir: string }): Plugin {
  return {
    name: 'tuxedo:asset-manifest',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      return id === RESOLVED_ID ? `export default ${JSON.stringify(hashAssets(options.dir))};` : undefined;
    },
    configureServer(server) {
      server.watcher.add(options.dir);
      const invalidate = (file: string): void => {
        if (!file.split(sep).join('/').includes(options.dir)) return;
        const graph = server.environments.client.moduleGraph;
        const mod = graph.getModuleById(RESOLVED_ID);
        if (mod) {
          graph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('change', invalidate);
      server.watcher.on('unlink', invalidate);
    },
  };
}
