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
  await MeshoptEncoder.ready;
  if (optimize) await doc.transform(weld(), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const bytes = await io.writeBinary(doc);
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
