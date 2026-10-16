import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Accessor, type Document, type Primitive } from '@gltf-transform/core';

const SOURCE = 'art/lighting/cafe-daylight.json';
const MOVABLE = new Set(['water-bowl', 'food-bowl', 'scoop']);
interface Record { key: string; matrix: number[]; positions: number[]; normals: number[]; indices: number[]; color: number[]; emission: number[] }
interface Bake {
  signature: string; resolution: number; exposure: number; excluded: string[];
  primitives: { key: string; corners: number; offset: number }[];
  uvFloat32Gzip: string; pngChunks: string[]; pngSha256: string;
  probes: { position: number[]; sh: number[][] }[];
  metadata: { encoding: string; directIncluded: boolean };
}

/** Run after cafe nodes are complete, before weld/meshopt can reorder vertices. */
export async function applyCafeLightBake(doc: Document): Promise<void> {
  const records: Record[] = [], prims: Primitive[] = [];
  const hash = createHash('sha256');
  for (const node of doc.getRoot().listNodes()) {
    if (MOVABLE.has(node.getName()) || !node.getMesh()) continue;
    for (const [i, prim] of node.getMesh()!.listPrimitives().entries()) {
      const material = prim.getMaterial();
      const key = `${node.getName()}/${i}:${material?.getName() ?? ''}`;
      const positions = Array.from(prim.getAttribute('POSITION')!.getArray()!);
      const indices = prim.getIndices() ? Array.from(prim.getIndices()!.getArray()!) : positions.map((_, i) => i).filter(i => i % 3 === 0).map(i => i / 3);
      const matrix = Array.from(node.getWorldMatrix());
      const albedo = material?.getExtras().bakeAlbedo as number[] | undefined;
      const color = albedo ? [...albedo, 1] : material?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const emission = material?.getEmissiveFactor() ?? [0, 0, 0];
      // Geometry, average albedo and emission all affect secondary bounces.
      hash.update(key).update(JSON.stringify(matrix));
      hash.update(JSON.stringify({ color, emission }));
      for (const values of [positions, indices, Array.from(prim.getAttribute('NORMAL')!.getArray()!)]) {
        hash.update(Buffer.from(new Float32Array(values).buffer));
      }
      records.push({ key, matrix, positions, normals: Array.from(prim.getAttribute('NORMAL')!.getArray()!), indices, color, emission });
      prims.push(prim);
    }
  }
  const signature = hash.digest('hex');
  if (process.env.ART_BAKE_EXPORT) {
    writeFileSync(process.env.ART_BAKE_EXPORT, JSON.stringify({ signature, primitives: records }));
    console.log(`Bake source: ${records.length} static primitives, ${signature}`);
    return;
  }
  if (!existsSync(SOURCE)) throw new Error('Cafe light bake missing; use ART_BAKE_EXPORT and tools/art/bake-cafe.py.');
  const bake = JSON.parse(readFileSync(SOURCE, 'utf8')) as Bake;
  if (bake.signature !== signature) throw new Error(`Cafe light bake stale (${signature}); rebake after geometry changes.`);
  if (bake.metadata.encoding !== 'rgbm' || !bake.metadata.directIncluded || !Number.isFinite(bake.exposure) || bake.exposure <= 0) throw new Error('Cafe bake needs full diffuse RGBM irradiance.');
  if (bake.probes.length < 1 || bake.probes.some(probe => probe.position.length !== 3 || probe.sh.length !== 9 || probe.sh.some(c => c.length !== 3 || c.some(v => !Number.isFinite(v))))) throw new Error('Cafe room probes are invalid.');
  const png = Buffer.from(bake.pngChunks.map(path => (JSON.parse(readFileSync(join(dirname(SOURCE), path), 'utf8')) as { data: string }).data).join(''), 'base64');
  if (createHash('sha256').update(png).digest('hex') !== bake.pngSha256) throw new Error('Cafe RGBM source chunks are corrupt.');
  if (png.toString('ascii', 1, 4) !== 'PNG' || png.readUInt32BE(16) !== bake.resolution || png.readUInt32BE(20) !== bake.resolution || png[25] !== 6) throw new Error('Cafe RGBM image must be RGBA at its stated resolution.');
  const bytes = gunzipSync(Buffer.from(bake.uvFloat32Gzip, 'base64'));
  const uv = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  if (uv.length !== records.reduce((n, record) => n + record.indices.length * 2, 0)) throw new Error('Cafe UV1 archive length is invalid.');
  const buffer = doc.getRoot().listBuffers()[0]!;
  for (const [i, prim] of prims.entries()) {
    const record = records[i]!, baked = bake.primitives[i]!;
    if (record.key !== baked.key || record.indices.length !== baked.corners) throw new Error(`Bake primitive mismatch: ${record.key}`);
    // A UV seam may split an existing vertex. Expand all attributes together,
    // preserving UV0, normals and the exact triangle winding before compression.
    if (prim.getIndices()) {
      for (const semantic of prim.listSemantics()) {
        const attribute = prim.getAttribute(semantic)!, size = attribute.getElementSize();
        const values = attribute.getArray()!, expanded = new Float32Array(record.indices.length * size);
        for (let j = 0; j < record.indices.length; j++) for (let k = 0; k < size; k++) expanded[j * size + k] = values[record.indices[j]! * size + k]!;
        prim.setAttribute(semantic, doc.createAccessor().setBuffer(buffer).setType(attribute.getType()).setArray(expanded));
      }
      prim.setIndices(null);
    }
    const values = uv.slice(baked.offset, baked.offset + baked.corners * 2);
    if (values.length !== baked.corners * 2 || values.some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new Error(`Invalid UV1: ${record.key}`);
    prim.setAttribute('TEXCOORD_1', doc.createAccessor().setBuffer(buffer).setType(Accessor.Type.VEC2!).setArray(values));
    prim.setExtras({ ...prim.getExtras(), bakedDaylight: true });
  }
  const output = 'public/assets/art/lighting'; mkdirSync(output, { recursive: true });
  writeFileSync(`${output}/cafe-daylight.png`, png);
  writeFileSync(`${output}/cafe-daylight.json`, JSON.stringify({ signature, resolution: bake.resolution, exposure: bake.exposure, probes: bake.probes, metadata: bake.metadata }));
  for (const name of ['cafe-daylight.png', 'cafe-daylight.json']) writeFileSync(`${output}/${name}.prov.yaml`, `source: ${SOURCE}\ntool: Blender Cycles offline irradiance bake\ndate: '2026-10-16'\nlicense: original\nauthor_role: artist\n`);
  console.log(`Cafe light bake: ${bake.resolution}px, ${records.length} static primitives; movable props excluded`);
}
