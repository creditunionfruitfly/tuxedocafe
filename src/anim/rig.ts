import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { PoseBuffer } from './pose-buffer.ts';

const _inverseRoot = new Matrix4(), _scale = new Vector3(), _position = new Vector3();

/**
 * One cat's bones in skeleton order, with the rest (bind) pose measured at
 * runtime. Every length, axis and offset the IK uses comes from here rather
 * than from hard-coded numbers, so a corrected skeleton (M2-1) just works.
 * "Cat space" is the cat root's local space: unscaled metres, +Y up, +Z forward.
 */
export class CatRig {
  readonly root: Object3D;
  readonly bones: readonly Object3D[];
  readonly names: readonly string[];
  readonly rest: PoseBuffer;
  /** Rest world matrices in cat space, refreshed by captureRest(). */
  readonly restCat: Matrix4[];
  readonly #index = new Map<string, number>();

  constructor(root: Object3D, bones: readonly Object3D[]) {
    this.root = root; this.bones = bones; this.names = bones.map(bone => bone.name);
    bones.forEach((bone, i) => { if (!this.#index.has(bone.name)) this.#index.set(bone.name, i); });
    this.rest = new PoseBuffer(bones.length);
    this.restCat = bones.map(() => new Matrix4());
    this.captureRest();
  }

  index(name: string): number { return this.#index.get(name) ?? -1; }
  bone(name: string): Object3D | null { const i = this.index(name); return i < 0 ? null : this.bones[i]!; }
  require(name: string): Object3D {
    const bone = this.bone(name);
    if (!bone) throw new Error(`The cat rig has no bone "${name}"`);
    return bone;
  }
  parentIndex(i: number): number { const parent = this.bones[i]?.parent; return parent ? this.bones.indexOf(parent) : -1; }
  childIndices(i: number): number[] {
    const bone = this.bones[i]!;
    return bone.children.map(child => this.bones.indexOf(child)).filter(index => index >= 0);
  }

  /** Records the current local pose as the rest pose and measures it in cat space. */
  captureRest(): void {
    this.rest.capture(this.bones);
    this.root.updateMatrixWorld(true);
    _inverseRoot.copy(this.root.matrixWorld).invert();
    for (let i = 0; i < this.bones.length; i++) this.restCat[i]!.multiplyMatrices(_inverseRoot, this.bones[i]!.matrixWorld);
  }

  restoreRest(): void { this.rest.apply(this.bones); }

  restPositionCat(i: number, out: Vector3): Vector3 { return out.setFromMatrixPosition(this.restCat[i]!); }
  restQuaternionCat(i: number, out: Quaternion): Quaternion { this.restCat[i]!.decompose(_position, out, _scale); return out; }
}
