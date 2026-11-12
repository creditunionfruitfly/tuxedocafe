/** Decode original generated texture sources without image libraries or network access in CI. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type Provenance = { tool: string; date: string; notes: string };
type Source = { chunks: string[]; bytes: number; sha256: string; width: number; height: number; mimeType: string; colorSpace: string; provenance?: Provenance };
const KTX2_IDENTIFIER = Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex');

function dimensions(data: Buffer, { mimeType: mime, colorSpace }: Source): [number, number] {
  if (mime === 'image/ktx2' && data.length >= 80 && data.subarray(0, 12).equals(KTX2_IDENTIFIER)) {
    const width = data.readUInt32LE(20), height = data.readUInt32LE(24), levels = data.readUInt32LE(40);
    const descriptor = data.readUInt32LE(48), isColor = colorSpace === 'srgb';
    const expectedLevels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    if (width === 0 || height === 0 || levels !== expectedLevels || descriptor + 16 > data.length ||
        data[descriptor + 12] !== (isColor ? 163 : 166) || data[descriptor + 14] !== (isColor ? 2 : 1)) {
      throw new Error('KTX2 texture requires the expected Basis encoding, transfer function and full mip chain');
    }
    return [width, height];
  }
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
    if (!/^(shared|mochi|waffles|pepper|biscuit|clementine|juniper|pixel|duchess)\/[a-z0-9-]+\.(png|jpg|ktx2)$/.test(name)) throw new Error(`Unsafe texture name ${name}`);
    const data = Buffer.from(map.chunks.map(path => {
      if (!/^sources\/[a-z0-9_.-]+\/\d{3}\.json$/.test(path)) throw new Error('Unsafe texture source path');
      return (JSON.parse(readFileSync(`${root}/${path}`, 'utf8')) as { data: string }).data;
    }).join(''), 'base64');
    if (data.length !== map.bytes || createHash('sha256').update(data).digest('hex') !== map.sha256) throw new Error(`Corrupt texture source ${name}`);
    const [width, height] = dimensions(data, map);
    if (width !== map.width || height !== map.height) throw new Error(`Texture dimensions mismatch ${name}`);
    const out = `public/assets/art/cats/textures/${name}`;
    mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, data);
    const provenance = map.provenance ?? {
      tool: 'OpenAI built-in imagegen and deterministic texture preparation', date: '2026-10-17',
      notes: `${map.colorSpace}, ${width}x${height}. Normal and roughness are estimates.`,
    };
    writeFileSync(`${out}.prov.yaml`, `source: art/cats/textures/sources.json#${name}\ntool: ${JSON.stringify(provenance.tool)}\ndate: ${JSON.stringify(provenance.date)}\nlicense: original\nauthor_role: artist\nnotes: ${JSON.stringify(provenance.notes)}\n`);
    total += data.length;
  }
  console.log(`Cat textures: ${Object.keys(manifest.maps).length} verified maps, ${total} bytes`);
}

if (process.argv[1]?.endsWith('/textures/generate.ts')) await makeCatTextures();
