import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Document, NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { validateBytes } from 'gltf-validator';
import { BufferGeometry, Matrix4 } from 'three';

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

export function primitive(doc: Document, geometry: BufferGeometry) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc.createPrimitive();
  for (const [key, semantic, type] of [
    ['position', 'POSITION', Accessor.Type.VEC3], ['normal', 'NORMAL', Accessor.Type.VEC3],
    ['uv', 'TEXCOORD_0', Accessor.Type.VEC2], ['uv1', 'TEXCOORD_1', Accessor.Type.VEC2],
    ['skinIndex', 'JOINTS_0', Accessor.Type.VEC4], ['skinWeight', 'WEIGHTS_0', Accessor.Type.VEC4],
  ] as const) {
    const attribute = geometry.getAttribute(key);
    if (attribute) prim.setAttribute(semantic, doc.createAccessor().setBuffer(buffer).setType(type!)
      .setArray(semantic === 'JOINTS_0' ? new Uint16Array(attribute.array) : new Float32Array(attribute.array)));
  }
  if (geometry.index) prim.setIndices(doc.createAccessor().setBuffer(buffer).setType(Accessor.Type.SCALAR!)
    .setArray(new Uint32Array(geometry.index.array)));
  return prim;
}

export async function saveAsset(doc: Document, path: string, budget: number, optimize = true) {
  const expectedBaked = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives()).filter(prim => prim.getExtras().bakedDaylight === true).length;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const uv = prim.getAttribute('TEXCOORD_0'), count = prim.getAttribute('POSITION')!.getCount();
    if (!uv || uv.getCount() !== count || !Array.from(uv.getArray()!).every(Number.isFinite)) {
      throw new Error(`${path}: ${mesh.getName()} needs finite per-vertex UV0`);
    }
    const material = prim.getMaterial();
    if (!material?.getBaseColorTexture() || !material.getNormalTexture() || !material.getMetallicRoughnessTexture()) {
      throw new Error(`${path}: ${mesh.getName()} needs albedo, normal and roughness/metallic textures`);
    }
  }
  await MeshoptEncoder.ready;
  if (optimize) {
    // UV1 is consumed by the runtime lightMap shader rather than a glTF texture
    // slot, so the default prune considers it unused. Preserve authored data.
    // meshopt's nested reorder/quantize cleanup already uses keepAttributes.
    await doc.transform(weld(), dedup(), prune({ keepAttributes: true }));
    if (process.env.ART_UNCOMPRESSED !== '1') await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  }
  const bytes = await io.writeBinary(doc);
  await MeshoptDecoder.ready;
  const decoded = await io.readBinary(bytes);
  let bakedCount = 0;
  for (const mesh of decoded.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (prim.getExtras().bakedDaylight !== true) continue;
    bakedCount++;
    const uv0 = prim.getAttribute('TEXCOORD_0'), uv1 = prim.getAttribute('TEXCOORD_1');
    if (!uv0 || !uv1 || uv1.getCount() !== prim.getAttribute('POSITION')!.getCount()) throw new Error(`${path}: ${mesh.getName()} lost baked UV1 during export`);
    const first: number[] = [], second: number[] = [];
    let distinct = false;
    for (let i = 0; i < uv1.getCount(); i++) {
      uv0.getElement(i, first); uv1.getElement(i, second);
      if (second.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error(`${path}: ${mesh.getName()} exported invalid baked UV1`);
      if (second.some((value, axis) => Math.abs(value - first[axis]!) > 1e-5)) distinct = true;
    }
    if (!distinct) throw new Error(`${path}: ${mesh.getName()} exported UV1 identical to UV0`);
  }
  if (bakedCount !== expectedBaked) throw new Error(`${path}: baked primitive count changed during export (${expectedBaked} to ${bakedCount})`);
  const report = await validateBytes(bytes, { maxIssues: 100 });
  if (report.issues.numErrors) throw new Error(`${path}: ${JSON.stringify(report.issues.messages)}`);
  const triangles = doc.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives()
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3, 0), 0);
  if (triangles > budget) throw new Error(`${path}: ${triangles} triangles exceeds ${budget}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  writeFileSync(`${path}.prov.yaml`, `source: tools/art/build-assets.ts\ntool: original procedural geometry; glTF Transform; meshoptimizer\ndate: '2026-10-16'\nlicense: original\nauthor_role: artist\n`);
  console.log(`${path}: ${triangles} triangles, ${bytes.length} bytes, validator 0 errors`);
  return { triangles, bytes: bytes.length, warnings: report.issues.numWarnings };
}

export function inverseBindMatrices(worldPositions: number[][]) {
  return new Float32Array(worldPositions.flatMap(([x, y, z]) => new Matrix4().makeTranslation(-x!, -y!, -z!).toArray()));
}
