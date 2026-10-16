import { inflateSync } from 'node:zlib';

type PackedMap = { mimeType: string; width: number; height: number; data: string };
type PackedFamily = { maps: Record<'albedo' | 'normal' | 'orm', PackedMap> };

/** Decode our RGB8, non-interlaced data PNGs without a build-time imaging dependency. */
function png(data: string) {
  const bytes = Buffer.from(data, 'base64'), chunks: Buffer[] = [];
  if (bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Invalid data PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (bytes[24] !== 8 || bytes[25] !== 2 || bytes[28] !== 0) throw new Error('Data maps must be non-interlaced RGB8 PNG');
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * 3, pixels = new Uint8Array(stride * height);
  if (raw.length !== (stride + 1) * height) throw new Error('Data PNG dimensions disagree with pixels');
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const row = y * stride, filter = raw[y * (stride + 1)]!;
    if (filter > 4) throw new Error('Unsupported PNG filter');
    for (let x = 0; x < stride; x++) {
      const left = x >= 3 ? pixels[row + x - 3]! : 0;
      const above = y ? pixels[row + x - stride]! : 0;
      const corner = y && x >= 3 ? pixels[row + x - stride - 3]! : 0;
      const predictor = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, corner) : 0;
      pixels[row + x] = raw[y * (stride + 1) + x + 1]! + predictor;
    }
  }
  return { width, height, pixels };
}

/** Validate actual encoded pixels, not only metadata or texture-slot presence. */
export function validateSurfaceMaps(families: Record<string, PackedFamily>) {
  let bytes = 0;
  for (const [name, family] of Object.entries(families)) {
    for (const map of Object.values(family.maps)) bytes += Buffer.from(map.data, 'base64').length;
    const color = family.maps.albedo;
    if (color.mimeType !== 'image/jpeg' || Buffer.from(color.data, 'base64').readUInt16BE(0) !== 0xffd8 || color.width > 1024 || color.height > 1024) {
      throw new Error(`${name}: albedo must be a Phone-budget JPEG at most 1024 square`);
    }
    const normal = png(family.maps.normal.data), orm = png(family.maps.orm.data);
    if (normal.width !== 512 || normal.height !== 512 || orm.width !== 256 || orm.height !== 256) throw new Error(`${name}: data-map dimensions exceed budget`);
    let xMean = 0, yMean = 0;
    for (let i = 0; i < normal.pixels.length; i += 3) {
      const x = normal.pixels[i]! / 127.5 - 1, y = normal.pixels[i + 1]! / 127.5 - 1, z = normal.pixels[i + 2]! / 127.5 - 1;
      if (z <= 0 || Math.abs(Math.hypot(x, y, z) - 1) > .015) throw new Error(`${name}: normal map has a non-unit or reversed vector`);
      xMean += x; yMean += y;
    }
    const count = normal.width * normal.height;
    if (Math.abs(xMean / count) > .025 || Math.abs(yMean / count) > .025) throw new Error(`${name}: normal field has a directional lighting bias`);
    for (let i = 0; i < orm.pixels.length; i += 3) {
      if (orm.pixels[i] !== 255 || orm.pixels[i + 1]! < 20 || orm.pixels[i + 2] !== (name === 'brass' ? 255 : 0)) throw new Error(`${name}: ORM channel semantics are invalid`);
    }
  }
  if (bytes > 8_000_000) throw new Error(`Surface maps exceed 8 MB source budget: ${bytes}`);
  return { families: Object.keys(families).length, bytes };
}
