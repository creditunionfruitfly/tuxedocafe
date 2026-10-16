import { readFileSync } from 'node:fs';
import { Document, Accessor } from '@gltf-transform/core';
import { CapsuleGeometry, Quaternion, Vector3, Uint16BufferAttribute, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inverseBindMatrices, primitive, saveAsset } from './gltf.ts';

export async function makePlaceholderCat() {
  const rig = JSON.parse(readFileSync('art/rig/skeleton.json', 'utf8')) as {
    bones: { name: string; parent: string | null; restPosition: [number, number, number] }[];
  };
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Rig diagnostic');
  const worlds = new Map<string, Vector3>();
  const nodes = rig.bones.map((b) => doc.createNode(b.name).setTranslation(b.restPosition));
  const material = doc.createMaterial('Diagnostic tuxedo').setBaseColorFactor([.13, .15, .16, 1]).setMetallicFactor(0).setRoughnessFactor(.8);
  const parts = rig.bones.map((bone, index) => {
    const parentIndex = rig.bones.findIndex((b) => b.name === bone.parent);
    if (parentIndex >= 0) nodes[parentIndex]!.addChild(nodes[index]!);
    else scene.addChild(nodes[index]!);
    const end = new Vector3(...bone.restPosition).add(worlds.get(bone.parent ?? '') ?? new Vector3());
    worlds.set(bone.name, end);
    const start = worlds.get(bone.parent ?? '') ?? end;
    const length = start.distanceTo(end);
    const radius = bone.name.includes('spine') ? .075 : bone.name === 'head' ? .085 : bone.name.includes('tail') ? .016 : .022;
    const geo = new CapsuleGeometry(radius, Math.max(0.001, length - radius), 2, 6);
    geo.deleteAttribute('uv');
    geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), end.clone().sub(start).normalize()));
    geo.translate(...start.clone().lerp(end, .5).toArray());
    const count = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(Array.from({ length: count }, () => [index, 0, 0, 0]).flat(), 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4));
    return geo;
  });
  const merged = mergeGeometries(parts)!;
  const mesh = doc.createMesh('Capsule cat').addPrimitive(primitive(doc, merged).setMaterial(material));
  const skin = doc.createSkin('Shared feline skeleton').setSkeleton(nodes[0]!)
    .setInverseBindMatrices(doc.createAccessor().setBuffer(buffer).setType(Accessor.Type.MAT4!)
      .setArray(inverseBindMatrices(rig.bones.map((b) => worlds.get(b.name)!.toArray()))));
  nodes.forEach((node) => skin.addJoint(node));
  scene.addChild(doc.createNode('cat_placeholder').setMesh(mesh).setSkin(skin));
  parts.forEach((p) => p.dispose()); merged.dispose();
  return saveAsset(doc, 'public/assets/art/cats/cat_placeholder_lod0.glb', 12000);
}

if (process.argv[1]?.endsWith('make-placeholder-cat.ts')) await makePlaceholderCat();
