import { MathUtils, Object3D, Quaternion, Vector3, type SkinnedMesh } from 'three';
import { CCDIKSolver, type IK } from 'three/addons/animation/CCDIKSolver.js';
import type { CatRig } from './rig.ts';

/**
 * Look-at: three's CCDIKSolver (README D6) bends spine_04 → head toward a
 * target with per-link limits, then the eye bones aim the gaze. Limits are
 * yaw/pitch/roll ranges in the cat's body frame, mapped at bind onto each
 * bone's local Euler axes and centred on the animated pose every step, so a
 * curled sleeping neck is never snapped back to the rest pose. The weight is
 * the behaviour layer's (attention scoring decides when a cat looks at a hand);
 * targets far behind the head fade out instead of breaking the neck.
 */
export interface LookLink { readonly bone: string; readonly yawDeg: number; readonly pitchDeg: number; readonly rollDeg: number }
export const LOOK_LINKS: readonly LookLink[] = [
  { bone: 'head', yawDeg: 38, pitchDeg: 28, rollDeg: 10 },
  { bone: 'neck_02', yawDeg: 22, pitchDeg: 16, rollDeg: 6 },
  { bone: 'neck_01', yawDeg: 16, pitchDeg: 12, rollDeg: 5 },
  { bone: 'spine_05', yawDeg: 7, pitchDeg: 5, rollDeg: 3 },
  { bone: 'spine_04', yawDeg: 4, pitchDeg: 3, rollDeg: 2 },
];
export const EYE_LIMIT_DEG = 24;
/** Seconds for the look weight to follow its target; field of view fade (degrees from the muzzle). */
const WEIGHT_TAU = .15, FIELD_FULL_DEG = 75, FIELD_ZERO_DEG = 110;

const BODY_AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)] as const;
const _q = new Quaternion(), _q2 = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _v = new Vector3(), _f = new Vector3(), _axis = new Vector3();

interface EyeRig { bone: Object3D; forwardLocal: Vector3 }

export class LookAt {
  readonly links: Object3D[];
  readonly effector = new Object3D();
  readonly #target = new Object3D();
  readonly #solver: CCDIKSolver;
  readonly #ik: IK;
  /** Per link: local Euler half-ranges (radians) on x, y, z. */
  readonly #ranges: Vector3[];
  readonly #eyeMid = new Vector3();
  readonly #gaze = new Vector3();
  readonly #eyes: EyeRig[];
  readonly #point = new Vector3();
  #desired = 0; weight = 0;

  constructor(rig: CatRig, links: readonly LookLink[] = LOOK_LINKS) {
    const chain: Object3D[] = [], specs: LookLink[] = [];
    for (const spec of links) {
      const bone = rig.bone(spec.bone);
      if (!bone || (chain.length && chain[chain.length - 1]!.parent !== bone)) break;
      chain.push(bone); specs.push(spec);
    }
    if (!chain.length) throw new Error('The cat rig has no head for look-at');
    this.links = chain;
    const head = chain[0]!;
    this.effector.name = 'look_effector'; head.add(this.effector);
    this.#ranges = chain.map((bone, i) => {
      const spec = specs[i]!, range = new Vector3();
      rig.restQuaternionCat(rig.index(bone.name), _q).invert();
      const degrees = [spec.pitchDeg, spec.yawDeg, spec.rollDeg];
      BODY_AXES.forEach((axis, k) => {
        _v.copy(axis).applyQuaternion(_q);
        const local = Math.abs(_v.x) >= Math.abs(_v.y) && Math.abs(_v.x) >= Math.abs(_v.z) ? 'x' : Math.abs(_v.y) >= Math.abs(_v.z) ? 'y' : 'z';
        range[local] = Math.max(range[local], MathUtils.degToRad(degrees[k]!));
      });
      return range;
    });
    // Gaze origin between the eyes and the muzzle direction, both in head space at bind.
    const headIndex = rig.index(head.name);
    rig.restQuaternionCat(headIndex, _q2);
    this.#gaze.set(0, 0, 1).applyQuaternion(_q2.clone().invert());
    this.#eyes = ['eye_L', 'eye_R'].map(name => rig.bone(name)).filter((eye): eye is Object3D => !!eye && eye.parent === head).map(eye => ({
      bone: eye, forwardLocal: new Vector3(0, 0, 1).applyQuaternion(rig.restQuaternionCat(rig.index(eye.name), new Quaternion()).invert()),
    }));
    if (this.#eyes.length) { for (const eye of this.#eyes) this.#eyeMid.add(eye.bone.position); this.#eyeMid.divideScalar(this.#eyes.length); }
    const bones = [...chain, this.effector, this.#target];
    this.#ik = {
      target: bones.length - 1, effector: bones.length - 2, iteration: 6, blendFactor: 0,
      links: chain.map((_, index) => ({ index, rotationMin: new Vector3(), rotationMax: new Vector3() })),
    };
    // The solver only reads `skeleton.bones`; a proxy keeps the effector and target out of the real skeleton.
    this.#solver = new CCDIKSolver({ skeleton: { bones } } as unknown as SkinnedMesh, [this.#ik]);
  }

  /** Look toward a world point with a weight in 0–1 (null or 0 looks away). */
  setTarget(point: Vector3 | null, weight = 1): void {
    if (point) this.#point.copy(point);
    this.#desired = point ? Math.min(1, Math.max(0, weight)) : 0;
  }

  /** Runs after the mixer and additive layers; world matrices must be current. */
  solve(dt: number): void {
    const head = this.links[0]!;
    // Fade targets outside the field of view (measured from the animated muzzle).
    head.matrixWorld.decompose(_p, _q, _s);
    _f.copy(this.#gaze).applyQuaternion(_q);
    _v.setFromMatrixPosition(head.matrixWorld);
    const offAxis = MathUtils.radToDeg(_f.angleTo(_v.subVectors(this.#point, _v)));
    const field = this.#desired > 0 ? 1 - MathUtils.smoothstep(offAxis, FIELD_FULL_DEG, FIELD_ZERO_DEG) : 0;
    this.weight += (this.#desired * field - this.weight) * (1 - Math.exp(-dt / WEIGHT_TAU));
    if (this.weight < 1e-3) { this.weight = this.#desired * field > 0 ? this.weight : 0; return; }
    // The effector rides the gaze ray at the target's distance, so CCD aims rather than reaches.
    _p.copy(this.#eyeMid).applyMatrix4(head.matrixWorld);
    this.effector.position.copy(this.#eyeMid).addScaledVector(this.#gaze, _p.distanceTo(this.#point) / Math.max(1e-6, _s.x));
    this.effector.updateMatrixWorld(true);
    this.#target.matrixWorld.makeTranslation(this.#point.x, this.#point.y, this.#point.z);
    for (let i = 0; i < this.links.length; i++) {
      const rotation = this.links[i]!.rotation, range = this.#ranges[i]!, link = this.#ik.links[i]!;
      link.rotationMin!.set(rotation.x - range.x, rotation.y - range.y, rotation.z - range.z);
      link.rotationMax!.set(rotation.x + range.x, rotation.y + range.y, rotation.z + range.z);
    }
    this.#ik.blendFactor = this.weight;
    this.#solver.update();
    this.links[this.links.length - 1]!.updateMatrixWorld(true);
    this.#aimEyes();
  }

  #aimEyes(): void {
    const limit = MathUtils.degToRad(EYE_LIMIT_DEG);
    for (const eye of this.#eyes) {
      const bone = eye.bone;
      bone.matrixWorld.decompose(_p, _q, _s);
      _f.copy(eye.forwardLocal).applyQuaternion(_q);
      _v.subVectors(this.#point, _p).normalize();
      const angle = Math.min(limit, _f.angleTo(_v)) * this.weight;
      _axis.crossVectors(_f, _v);
      if (angle < 1e-5 || _axis.lengthSq() < 1e-12) continue;
      _q2.setFromAxisAngle(_axis.normalize(), angle);
      _q.premultiply(_q2);
      bone.parent!.matrixWorld.decompose(_v, _q2, _s);
      bone.quaternion.copy(_q2.invert().multiply(_q));
      bone.updateMatrixWorld(true);
    }
  }

  dispose(): void { this.effector.removeFromParent(); }
}
