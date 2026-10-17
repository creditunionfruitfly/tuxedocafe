import { Quaternion, Vector3, type Object3D } from 'three';
import { applySpringStep, springStep, type SpringStep } from './spring.ts';

/**
 * Secondary motion for the tail and ears, the last stage of the stack. Each
 * link's tip is a damped spring around its animated position, simulated in the
 * frame that moves with that position: steady motion leaves the tail as
 * animated, while starts, stops and turns (accelerations) swing it. Deviation
 * is limited to an angle from the animated direction and the tip stays above
 * the floor. Base links are stiffer than the tip; nothing feeds back into the
 * animation, and the exact spring step keeps it stable at any rate.
 */
export interface SpringChainOptions {
  /** Natural frequency at the first and last link (Hz). */
  readonly baseHz: number; readonly tipHz: number;
  readonly dampingRatio: number;
  /** Largest deviation from the animated direction at the first and last link (degrees); limits accumulate. */
  readonly baseMaxDeg: number; readonly tipMaxDeg: number;
  /** Tip clearance above the floor (world units); 0 disables floor collision. */
  readonly collisionRadius: number;
  /** Scales the inertial kick from accelerations (1 = a free point mass). */
  readonly inertia: number;
}

export const TAIL_SPRING: SpringChainOptions = { baseHz: 3.5, tipHz: 2.2, dampingRatio: .6, baseMaxDeg: 5, tipMaxDeg: 14, collisionRadius: .012, inertia: .6 };
export const EAR_SPRING: SpringChainOptions = { baseHz: 7, tipHz: 6, dampingRatio: .5, baseMaxDeg: 8, tipMaxDeg: 12, collisionRadius: 0, inertia: .5 };

const _o = new Vector3(), _t = new Vector3(), _anim = new Vector3(), _dir = new Vector3(), _axis = new Vector3();
const _q = new Quaternion(), _qWorld = new Quaternion(), _qParent = new Quaternion(), _s = new Vector3(), _tmp = new Vector3();
const _step: SpringStep = { a: 1, b: 0, c: 0, d: 1 };
/** A target this far from its last position means the cat was placed, not moved: start over. */
const TELEPORT_M = .6;
const STRIDE = 12;

export class SpringChain {
  readonly links: readonly Object3D[];
  readonly options: SpringChainOptions;
  /** Per link: the tip offset in the link's local frame (toward its child, or continuing the incoming bone). */
  readonly #tipLocal: Vector3[];
  /** Per link: offset (x, v) pairs for 3 axes, previous target (3), previous target velocity (3). */
  readonly #state: Float64Array;
  /** Per link: animated tip position this step (scratch). */
  readonly #animated: Float64Array;
  #ready = false;

  constructor(links: readonly Object3D[], options: SpringChainOptions) {
    this.links = links; this.options = options;
    this.#tipLocal = links.map((link, i) => {
      const next = links[i + 1];
      if (next && next.parent === link) return next.position.clone();
      // A chain end continues its incoming bone, expressed in its own frame.
      return link.position.clone().applyQuaternion(link.quaternion.clone().invert());
    });
    this.#state = new Float64Array(links.length * STRIDE);
    this.#animated = new Float64Array(links.length * 3);
  }

  reset(): void { this.#ready = false; }

  /** `floorY` is the support height for the collision limit. */
  solve(dt: number, floorY = -Infinity): void {
    const n = this.links.length, o = this.options, state = this.#state, animated = this.#animated;
    if (dt <= 0) return;
    // Animated tips first: the inertial kicks come from the animation's motion only,
    // so a swinging parent never pumps energy into its children.
    for (let i = 0; i < n; i++) {
      const link = this.links[i]!;
      link.updateWorldMatrix(false, false);
      _t.copy(this.#tipLocal[i]!).applyMatrix4(link.matrixWorld);
      animated[i * 3] = _t.x; animated[i * 3 + 1] = _t.y; animated[i * 3 + 2] = _t.z;
    }
    for (let i = 0; i < n; i++) {
      const link = this.links[i]!, k = n > 1 ? i / (n - 1) : 0, s = i * STRIDE;
      link.updateWorldMatrix(false, false);
      link.matrixWorld.decompose(_o, _qWorld, _s);
      _t.copy(this.#tipLocal[i]!).applyMatrix4(link.matrixWorld);
      _anim.subVectors(_t, _o);
      const length = _anim.length();
      if (length < 1e-9) continue;
      _anim.divideScalar(length);
      const ax = animated[i * 3]!, ay = animated[i * 3 + 1]!, az = animated[i * 3 + 2]!;
      const moved = Math.hypot(ax - state[s + 6]!, ay - state[s + 7]!, az - state[s + 8]!);
      if (!this.#ready || moved > TELEPORT_M) {
        state.fill(0, s, s + STRIDE); state[s + 6] = ax; state[s + 7] = ay; state[s + 8] = az;
      }
      // The animated tip's change of velocity kicks the tip the other way (fictitious force).
      for (let axis = 0; axis < 3; axis++) {
        const target = axis === 0 ? ax : axis === 1 ? ay : az;
        const velocity = (target - state[s + 6 + axis]!) / dt;
        state[s + axis * 2 + 1] = state[s + axis * 2 + 1]! - (velocity - state[s + 9 + axis]!) * o.inertia;
        state[s + 6 + axis] = target; state[s + 9 + axis] = velocity;
      }
      applySpringStep(springStep(o.baseHz + (o.tipHz - o.baseHz) * k, o.dampingRatio, dt, _step), state, s, 3);
      _dir.set(_t.x + state[s]! - _o.x, _t.y + state[s + 2]! - _o.y, _t.z + state[s + 4]! - _o.z);
      if (_dir.lengthSq() < 1e-14) _dir.copy(_anim); else _dir.normalize();
      let limited = false;
      const maxAngle = (o.baseMaxDeg + (o.tipMaxDeg - o.baseMaxDeg) * k) * Math.PI / 180;
      if (_anim.angleTo(_dir) > maxAngle) {
        _axis.crossVectors(_anim, _dir);
        if (_axis.lengthSq() > 1e-14) { _dir.copy(_anim).applyAxisAngle(_axis.normalize(), maxAngle); limited = true; }
      }
      if (o.collisionRadius > 0 && _o.y + _dir.y * length < floorY + o.collisionRadius) {
        const lift = Math.min(1, Math.max(-1, (floorY + o.collisionRadius - _o.y) / length));
        const horizontal = Math.hypot(_dir.x, _dir.z), scale = horizontal > 1e-9 ? Math.sqrt(1 - lift * lift) / horizontal : 0;
        _dir.set(_dir.x * scale, lift, _dir.z * scale); limited = true;
      }
      // Store the constrained tip as the new offset; a limit soaks up half the velocity.
      state[s] = _o.x + _dir.x * length - _t.x; state[s + 2] = _o.y + _dir.y * length - _t.y; state[s + 4] = _o.z + _dir.z * length - _t.z;
      if (limited) { state[s + 1] = state[s + 1]! * .5; state[s + 3] = state[s + 3]! * .5; state[s + 5] = state[s + 5]! * .5; }
      // Rotate the link from its animated direction onto the simulated one.
      _q.setFromUnitVectors(_anim, _dir);
      _qWorld.premultiply(_q);
      link.parent!.matrixWorld.decompose(_tmp, _qParent, _s);
      link.quaternion.copy(_qParent.invert().multiply(_qWorld));
      link.updateWorldMatrix(false, false);
    }
    this.#ready = true;
    this.links[n - 1]?.updateMatrixWorld(true);
  }
}
