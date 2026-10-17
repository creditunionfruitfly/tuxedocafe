/** Restore hashed cat source/export archives without CI, network or image libraries. */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const file = process.argv[2] ?? 'art/cats/textures/originals/manifest.json';
const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
  version: number; status: string;
  assets: { source: string; target: string; bytes: number; sha256: string }[];
};
if (manifest.version !== 1) throw new Error('Unsupported cat archive version');
for (const asset of manifest.assets) {
  if (isAbsolute(asset.source) || asset.source.split('/').includes('..') ||
    isAbsolute(asset.target) || asset.target.split('/').includes('..') ||
    !/^(art\/cats\/|public\/assets\/art\/cats\/)/.test(asset.target)) throw new Error('Unsafe cat archive path');
  const source = resolve(dirname(file), asset.source);
  const encoded = JSON.parse(readFileSync(source, 'utf8')) as { data: string };
  const data = Buffer.from(encoded.data, 'base64');
  if (data.length !== asset.bytes || createHash('sha256').update(data).digest('hex') !== asset.sha256) throw new Error(`Corrupt cat archive: ${asset.target}`);
  mkdirSync(dirname(asset.target), { recursive: true });
  writeFileSync(asset.target, data);
  copyFileSync(`${source}.prov.yaml`, `${asset.target}.prov.yaml`);
}
console.log(`Restored ${manifest.assets.length} cat assets: ${manifest.status}`);
