/** Decode original generated texture sources without image libraries or network access in CI. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type Source = { chunks: string[]; bytes: number; sha256: string; width: number; height: number; mimeType: string; colorSpace: string };

function dimensions(data: Buffer, mime: string): [number, number] {
  if (mime === 'image/png' && data.toString('hex', 0, 8) === '89504e470d0a1a0a') return [data.readUInt32BE(16), data.readUInt32BE(20)];
  if (mime === 'image/jpeg' && data.readUInt16BE(0) === 0xffd8) {
    for (let offset = 2; offset + 9 < data.length;) {
      if (data[offset++] !== 0xff) throw new Error('Malformed JPEG marker');
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3)];
      const length = data.readUInt16BE(offset);
      if (length < 2) break;
      offset += length;
    }
  }
  throw new Error(`Unsupported or malformed texture ${mime}`);
}

export async function makeCatTextures() {
  const root = 'art/cats/textures';
  const manifest = JSON.parse(readFileSync(`${root}/sources.json`, 'utf8')) as { version: number; maps: Record<string, Source> };
  if (manifest.version !== 1) throw new Error('Unsupported cat texture source version');
  let total = 0;
  for (const [name, map] of Object.entries(manifest.maps)) {
    if (!/^(shared|mochi|waffles|pepper|biscuit|clementine|juniper|pixel|duchess)\/[a-z0-9-]+\.(png|jpg)$/.test(name)) throw new Error(`Unsafe texture name ${name}`);
    const data = Buffer.from(map.chunks.map(path => {
      if (!/^sources\/[a-z0-9_.-]+\/\d{3}\.json$/.test(path)) throw new Error('Unsafe texture source path');
      return (JSON.parse(readFileSync(`${root}/${path}`, 'utf8')) as { data: string }).data;
    }).join(''), 'base64');
    if (data.length !== map.bytes || createHash('sha256').update(data).digest('hex') !== map.sha256) throw new Error(`Corrupt texture source ${name}`);
    const [width, height] = dimensions(data, map.mimeType);
    if (width !== map.width || height !== map.height) throw new Error(`Texture dimensions mismatch ${name}`);
    const out = `public/assets/art/cats/textures/${name}`;
    mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, data);
    writeFileSync(`${out}.prov.yaml`, `source: art/cats/textures/sources.json#${name}\ntool: OpenAI built-in imagegen; deterministic texture preparation\ndate: '2026-10-17'\nlicense: original\nauthor_role: artist\nnotes: ${map.colorSpace}; ${map.width}x${map.height}; normal and roughness are estimates rather than measured scans\n`);
    total += data.length;
  }
  console.log(`Cat textures: ${Object.keys(manifest.maps).length} verified maps, ${total} bytes`);
}

if (process.argv[1]?.endsWith('/textures/generate.ts')) await makeCatTextures();
