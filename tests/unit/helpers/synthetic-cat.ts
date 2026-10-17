import { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import skeleton from '../../../art/rig/skeleton.json' with { type: 'json' };
import { createRng } from '../../../src/core/rng.ts';

export interface RigBoneSpec { name: string; parent: string | null; restPosition: number[] }
export const SKELETON = skeleton as { bones: RigBoneSpec[]; ikChains: { name: string; root: string; middle: string; effector: string; pole: number[] }[] };

/**
 * The 65-bone rig from art/rig/skeleton.json under a Group (the cat root).
 * With `twist`, every bone gets a seeded arbitrary rest orientation while the
 * joint positions stay put, which proves the runtime never assumes identity
 * bone frames (a Blender export will not have them).
 */
export function syntheticCat(options: { twist?: boolean; mesh?: boolean } = {}): { root: Group; bones: Bone[]; mesh: SkinnedMesh | null } {
  const root = new Group(); root.name = 'cat';
  const world = new Map<string, Vector3>(), orientation = new Map<string, Quaternion>(), bones: Bone[] = [];
  const rng = createRng('synthetic-cat');
  for (const spec of SKELETON.bones) {
    const bone = new Bone(); bone.name = spec.name;
    const parentWorld = spec.parent ? world.get(spec.parent)! : new Vector3();
    const position = new Vector3(...(spec.restPosition as [number, number, number])).add(parentWorld);
    world.set(spec.name, position);
    const q = options.twist ? new Quaternion().setFromAxisAngle(new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize(), rng.range(-1.2, 1.2)) : new Quaternion();
    orientation.set(spec.name, q);
    const parentQ = spec.parent ? orientation.get(spec.parent)! : new Quaternion();
    bone.position.copy(position).sub(parentWorld).applyQuaternion(parentQ.clone().invert());
    bone.quaternion.copy(parentQ.clone().invert().multiply(q));
    const parent = spec.parent ? bones.find(b => b.name === spec.parent)! : root;
    parent.add(bone); bones.push(bone);
  }
  root.updateMatrixWorld(true);
  let mesh: SkinnedMesh | null = null;
  if (options.mesh) {
    // Four vertices per bone: on the joint and offset ±X / +Y by 2 cm, rigidly bound.
    const positions: number[] = [], indices: number[] = [], weights: number[] = [];
    bones.forEach((bone, i) => {
      const p = world.get(bone.name)!;
      for (const offset of [[0, 0, 0], [.02, 0, 0], [-.02, 0, 0], [0, .02, 0]]) {
        positions.push(p.x + offset[0]!, p.y + offset[1]!, p.z + offset[2]!); indices.push(i, 0, 0, 0); weights.push(1, 0, 0, 0);
      }
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
    mesh = new SkinnedMesh(geometry, new MeshBasicMaterial()); mesh.name = 'cat_body';
    root.add(mesh); root.updateMatrixWorld(true);
    mesh.bind(new Skeleton(bones));
  }
  return { root, bones, mesh };
}

export function worldPosition(bone: { matrixWorld: { elements: ArrayLike<number> } }): Vector3 {
  const e = bone.matrixWorld.elements; return new Vector3(e[12], e[13], e[14]);
}
