import { readFileSync } from 'node:fs';
import type { Vec3 } from './sdf.ts';

export interface Bone { name: string; parent: string | null; restPosition: Vec3 }
export interface Rig {
  bones: Bone[];
  ikChains: { name: string; root: string; middle: string; effector: string; pole: Vec3 }[];
  /** World-space rest position of each joint (rest rotations are identity). */
  world: Map<string, Vec3>;
  index: Map<string, number>;
}

export function loadRig(path = 'art/rig/skeleton.json'): Rig {
  const json = JSON.parse(readFileSync(path, 'utf8')) as Pick<Rig, 'bones' | 'ikChains'>;
  const world = new Map<string, Vec3>(), index = new Map<string, number>();
  json.bones.forEach((bone, i) => {
    const parent = bone.parent === null ? [0, 0, 0] : world.get(bone.parent);
    if (!parent) throw new Error(`skeleton.json: ${bone.name} precedes its parent ${bone.parent}`);
    world.set(bone.name, [parent[0]! + bone.restPosition[0], parent[1]! + bone.restPosition[1], parent[2]! + bone.restPosition[2]]);
    index.set(bone.name, i);
  });
  return { ...json, world, index };
}

export function joint(rig: Rig, name: string): Vec3 {
  const p = rig.world.get(name);
  if (!p) throw new Error(`Unknown joint ${name}`);
  return p;
}

/** Mirror a left-side name to the right side and vice versa. */
export function mirrorName(name: string) {
  return name.replace(/_L(_|$)/, '_#$1').replace(/_R(_|$)/, '_L$1').replace(/_#(_|$)/, '_R$1');
}
