import { defineConfig } from 'vite';
import { assetManifest } from './tools/engine/vite-asset-manifest.ts';
import { buildInfo } from './tools/engine/vite-build-info.ts';

// Dev, preview and Pages all serve under the same base path, so path bugs show
// up locally. CI sets VITE_BASE for the whole job: `vite preview` reads it too.
const base = process.env.VITE_BASE ?? '/tuxedocafe/';
const channel = process.env.VITE_CHANNEL ?? 'dev';

export default defineConfig({
  base,
  // Pages has no rewrites, so dev and preview 404 on unknown paths too.
  appType: 'mpa',
  plugins: [buildInfo({ base, channel }), assetManifest({ dir: 'public/assets' })],
  build: {
    // Bundled code goes to bundle/; assets/ belongs to public/assets/ (assetUrl).
    assetsDir: 'bundle',
    // No sourcemaps: the playtest site is public even if the repository isn't.
    sourcemap: false,
    // three.js alone is about 530 kB minified (130 kB gzipped).
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // three.js gets its own chunk, so playtesters re-download it only when it changes.
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
