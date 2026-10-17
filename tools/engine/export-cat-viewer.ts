/** Reproducible, offline, single-file viewer: node tools/engine/export-cat-viewer.ts [output.html]. */
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'vite';

const output = resolve(process.argv[2] ?? 'cat-viewer.html'), temporary = mkdtempSync(join(tmpdir(), 'tuxedo-cat-viewer-'));
const assets: Record<string, string> = {}, hashes: Record<string, string> = {};
const mimes: Record<string, string> = { glb: 'model/gltf-binary', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
function embed(path: string, key: string): void {
  const mime = mimes[path.split('.').pop()!]; if (!mime) return;
  const bytes = readFileSync(path); assets[key] = `data:${mime};base64,${bytes.toString('base64')}`; hashes[key] = createHash('sha256').update(bytes).digest('hex');
}
function collect(folder: string, prefix: string): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name), key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) collect(path, key);
    else if (!entry.name.endsWith('.prov.yaml')) embed(path, key);
  }
}
for (const required of ['cat_master_lod0.glb', 'cat_master_lod1.glb', 'cat_master_lod2.glb', 'cat_anims.glb', 'cat_expressions.json']) {
  const path = `public/assets/art/cats/${required}`;
  if (!existsSync(path)) throw new Error(`Run npm run assets first: missing ${required}`);
  embed(path, `art/cats/${required}`);
}
if (existsSync('public/assets/art/cats/textures')) collect('public/assets/art/cats/textures', 'art/cats/textures');
try {
  await build({ configFile: false, base: './', publicDir: false,
    plugins: [{ name: 'tuxedo:offline-assets', enforce: 'pre',
      resolveId(id) { if (id.endsWith('/core/assets.ts') || id === '../core/assets.ts') return '\0offline-assets'; },
      load(id) { if (id === '\0offline-assets') return `const assets=${JSON.stringify(assets)};export const assetUrl=p=>assets[p];export const hasAsset=p=>p in assets;export const siteUrl=p=>p;`; },
    }],
    build: { outDir: temporary, emptyOutDir: true, cssCodeSplit: false,
      lib: { entry: resolve('tools/engine/viewer-entry.ts'), formats: ['es'], fileName: 'viewer' },
      rolldownOptions: { output: { codeSplitting: false } }, minify: true,
    },
  });
  const files = readdirSync(temporary), js = files.filter(file => file.endsWith('.js')).map(file => readFileSync(join(temporary, file), 'utf8')).join('\n');
  const css = files.filter(file => file.endsWith('.css')).map(file => readFileSync(join(temporary, file), 'utf8')).join('\n');
  const manifest = JSON.stringify({ source: 'Tuxedo Cafe cat runtime', assets: hashes }, null, 2);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tuxedo Cafe · Offline Cat Studio</title><style>body{margin:0}[hidden]{display:none!important}${css}</style><body><canvas id="view"></canvas><script type="application/json" id="asset-provenance">${manifest}</script><script type="module">${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, html); writeFileSync(`${output}.manifest.json`, `${manifest}\n`);
  console.log(`${output}: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB, ${Object.keys(assets).length} embedded assets; no server, CDN or CI required.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
