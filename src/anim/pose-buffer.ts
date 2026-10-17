import { Quaternion, type Object3D } from 'three';

const STRIDE = 7;
/** three's typings say number[]; the implementation takes any indexable array. */
const slerpFlat = Quaternion.slerpFlat as unknown as (dst: Float64Array, dstOffset: number, src0: Float64Array, srcOffset0: number, src1: Float64Array, srcOffset1: number, t: number) => void;

/**
 * Local bone transforms (position and quaternion) in one flat buffer. The cat
 * runtime keeps the previous and current simulation poses and interpolates
 * between them at render time; Float64 keeps a restored pose bit-identical to
 * the one computed, so replays match at any render rate.
 */
export class PoseBuffer {
  readonly count: number;
  readonly data: Float64Array;
  constructor(count: number) { this.count = count; this.data = new Float64Array(count * STRIDE); }

  capture(bones: readonly Object3D[]): this {
    const d = this.data;
    for (let i = 0; i < this.count; i++) {
      const bone = bones[i]!, o = i * STRIDE, p = bone.position, q = bone.quaternion;
      d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z; d[o + 3] = q.x; d[o + 4] = q.y; d[o + 5] = q.z; d[o + 6] = q.w;
    }
    return this;
  }

  apply(bones: readonly Object3D[]): void {
    const d = this.data;
    for (let i = 0; i < this.count; i++) {
      const bone = bones[i]!, o = i * STRIDE;
      bone.position.set(d[o]!, d[o + 1]!, d[o + 2]!);
      bone.quaternion.set(d[o + 3]!, d[o + 4]!, d[o + 5]!, d[o + 6]!);
    }
  }

  copy(other: PoseBuffer): this { this.data.set(other.data); return this; }

  /** Writes lerp/slerp(a, b, alpha) into the bones without temporary objects. */
  static interpolate(a: PoseBuffer, b: PoseBuffer, alpha: number, bones: readonly Object3D[], scratch: Float64Array): void {
    const da = a.data, db = b.data, t = Math.min(1, Math.max(0, alpha));
    for (let i = 0; i < a.count; i++) {
      const bone = bones[i]!, o = i * STRIDE;
      bone.position.set(da[o]! + (db[o]! - da[o]!) * t, da[o + 1]! + (db[o + 1]! - da[o + 1]!) * t, da[o + 2]! + (db[o + 2]! - da[o + 2]!) * t);
      slerpFlat(scratch, 0, da, o + 3, db, o + 3, t);
      bone.quaternion.set(scratch[0]!, scratch[1]!, scratch[2]!, scratch[3]!);
    }
  }

  /** Largest absolute component difference, for tests and change detection. */
  maxDifference(other: PoseBuffer): number {
    let max = 0;
    for (let i = 0; i < this.data.length; i++) max = Math.max(max, Math.abs(this.data[i]! - other.data[i]!));
    return max;
  }
}
