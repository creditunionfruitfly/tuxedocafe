import { Document, Accessor } from '@gltf-transform/core';
import { CapsuleGeometry, Quaternion, Vector3, Uint16BufferAttribute, Float32BufferAttribute } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inverseBindMatrices, primitive, saveAsset } from '../../tools/art/gltf.ts';

export async function makeHand() {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene('Patron hand');
  const wrist = doc.createNode('wrist'); scene.addChild(wrist);
  const joints = [wrist], worlds = [[0, 0, 0]], parts = [];
  const palm = new RoundedBoxGeometry(.078, .026, .09, 2, .012); palm.translate(0, 0, .05);
  palm.deleteAttribute('uv');
  const weight = (geo: typeof palm | CapsuleGeometry, index: number) => {
    const count = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(Array.from({ length: count }, () => [index, 0, 0, 0]).flat(), 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4));
    return geo.index ? geo.toNonIndexed() : geo;
  };
  parts.push(weight(palm, 0));
  for (let finger = 0; finger < 5; finger++) {
    const thumb = finger === 0, x = thumb ? -.049 : -.031 + (finger - 1) * .021;
    let parent = wrist, start = new Vector3(x, 0, thumb ? .043 : .092);
    const lengths = thumb ? [.026, .023, .016] : [.03 - (finger === 4 ? .007 : 0), .023, .017];
    for (let i = 0; i < 3; i++) {
      const node = doc.createNode(`${['thumb', 'index', 'middle', 'ring', 'little'][finger]}_${i + 1}`);
      const parentWorld = worlds[joints.indexOf(parent)]!;
      node.setTranslation(start.clone().sub(new Vector3(...parentWorld)).toArray()); parent.addChild(node);
      joints.push(node); worlds.push(start.toArray());
      const end = start.clone().add(new Vector3(thumb ? -.012 : 0, 0, lengths[i]!));
      const geo = new CapsuleGeometry(thumb ? .009 : .0085, start.distanceTo(end) - .008, 3, 8);
      geo.deleteAttribute('uv');
      geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), end.clone().sub(start).normalize()));
      geo.translate(...start.clone().lerp(end, .5).toArray());
      parts.push(weight(geo, joints.length - 1));
      geo.dispose(); start = end; parent = node;
    }
  }
  const skin = doc.createSkin('Hand wrist and fingers').setSkeleton(wrist)
    .setInverseBindMatrices(doc.createAccessor().setBuffer(buffer).setType(Accessor.Type.MAT4!)
      .setArray(inverseBindMatrices(worlds)));
  joints.forEach((n) => skin.addJoint(n));
  const merged = mergeGeometries(parts)!;
  const material = doc.createMaterial('skin').setBaseColorFactor([.68, .42, .26, 1]).setMetallicFactor(0).setRoughnessFactor(.75);
  scene.addChild(doc.createNode('hand').setSkin(skin).setMesh(doc.createMesh('Hand').addPrimitive(primitive(doc, merged).setMaterial(material))));
  const cuff = new RoundedBoxGeometry(.086, .037, .048, 2, .009); cuff.translate(0, 0, -.019); cuff.deleteAttribute('uv');
  const cloth = doc.createMaterial('sleeve').setBaseColorFactor([.08, .3, .26, 1]).setMetallicFactor(0).setRoughnessFactor(.95);
  scene.addChild(doc.createNode('sleeve').setMesh(doc.createMesh('Sleeve').addPrimitive(primitive(doc, cuff).setMaterial(cloth))));
  for (const [pose, curl] of [['open', 0], ['stroke', .25], ['grab', 1.15], ['point', 1]] as const) {
    const animation = doc.createAnimation(`hand.${pose}`);
    const times = doc.createAccessor().setBuffer(buffer).setType(Accessor.Type.SCALAR!).setArray(new Float32Array([0, .3]));
    for (let i = 1; i < joints.length; i++) {
      const angle = pose === 'point' && joints[i]!.getName().startsWith('index') ? 0 : curl;
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle).toArray();
      const output = doc.createAccessor().setBuffer(buffer).setType(Accessor.Type.VEC4!).setArray(new Float32Array([...q, ...q]));
      const sampler = doc.createAnimationSampler().setInput(times).setOutput(output).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joints[i]!).setTargetPath('rotation').setSampler(sampler));
    }
  }
  parts.forEach((p) => p.dispose()); palm.dispose(); merged.dispose(); cuff.dispose();
  return saveAsset(doc, 'public/assets/art/hand.glb', 8000);
}
