import { MathUtils, Matrix4, Quaternion, Vector3, type Object3D } from 'three';

/**
 * Analytic two-bone IK (README D6) for the upper/fore/wrist front and
 * thigh/shin/hock hind chains. Everything is measured from the bind pose when
 * the chain is created: the hinge axis, the side the middle joint bends toward
 * and the segment lengths (live, from the current pose). The solver never
 * stretches a limb, clamps the middle joint's interior angle (no inverted
 * knees or elbows) and keeps the swivel within `maxSwivelDeg` of the bind
 * bend direction, so a pole on the wrong side cannot flip the joint.
 */
export interface TwoBoneLimits { minInteriorDeg: number; maxInteriorDeg: number; maxSwivelDeg: number }
export const DEFAULT_LIMITS: TwoBoneLimits = { minInteriorDeg: 22, maxInteriorDeg: 179, maxSwivelDeg: 70 };

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _u = new Vector3(), _pole = new Vector3();
const _bend = new Vector3(), _side = new Vector3(), _b1 = new Vector3(), _c1 = new Vector3();
const _e0 = new Vector3(), _e1 = new Vector3(), _n0 = new Vector3(), _n1 = new Vector3(), _v0 = new Vector3(), _v1 = new Vector3();
const _fx = new Vector3(), _fy = new Vector3(), _fz = new Vector3(), _m0 = new Matrix4(), _m1 = new Matrix4();
const _qA = new Quaternion(), _qB = new Quaternion(), _qParent = new Quaternion(), _qWorldA = new Quaternion(), _qWorldB = new Quaternion();
const _tmpQ = new Quaternion(), _tmpP = new Vector3(), _tmpS = new Vector3();

function worldQuaternion(object: Object3D, out: Quaternion): Quaternion { object.matrixWorld.decompose(_tmpP, out, _tmpS); return out; }

function basis(x: Vector3, n: Vector3, out: Matrix4): boolean {
  _fx.copy(x); if (_fx.lengthSq() < 1e-20) return false; _fx.normalize();
  _fy.copy(n).addScaledVector(_fx, -_fx.dot(n)); if (_fy.lengthSq() < 1e-20) return false; _fy.normalize();
  _fz.crossVectors(_fx, _fy); out.makeBasis(_fx, _fy, _fz); return true;
}

/** The rotation taking direction x0 to x1 while turning plane normal n0 to n1. */
export function rotationBetweenFrames(x0: Vector3, n0: Vector3, x1: Vector3, n1: Vector3, out: Quaternion): Quaternion {
  if (!basis(x0, n0, _m0) || !basis(x1, n1, _m1)) {
    _fx.copy(x0).normalize(); _fy.copy(x1).normalize();
    return out.setFromUnitVectors(_fx, _fy);
  }
  return out.setFromRotationMatrix(_m1.multiply(_m0.transpose()));
}

export class TwoBoneChain {
  readonly a: Object3D; readonly b: Object3D; readonly c: Object3D;
  /** Bend-plane normal, cross(b − a, c − b), in A's local frame at bind. */
  readonly hingeLocal = new Vector3();
  /** Unit direction the middle joint bends toward, in A.parent's local frame at bind. */
  readonly bendParent = new Vector3();
  readonly limits: TwoBoneLimits;
  readonly minInteriorCos: number; readonly maxInteriorCos: number; readonly maxSwivelCos: number;

  /**
   * Measures the chain in its current (bind) pose. `fallbackBend` is a world
   * direction used only when the bind limb is perfectly straight.
   */
  constructor(a: Object3D, b: Object3D, c: Object3D, limits: TwoBoneLimits = DEFAULT_LIMITS, fallbackBend?: Vector3) {
    if (b.parent !== a || c.parent !== b || !a.parent) throw new Error(`IK chain ${a.name}/${b.name}/${c.name} must be a direct parent chain`);
    this.a = a; this.b = b; this.c = c; this.limits = limits;
    this.minInteriorCos = Math.cos(MathUtils.degToRad(limits.maxInteriorDeg));
    this.maxInteriorCos = Math.cos(MathUtils.degToRad(limits.minInteriorDeg));
    this.maxSwivelCos = Math.cos(MathUtils.degToRad(limits.maxSwivelDeg));
    a.parent.updateMatrixWorld(true);
    _a.setFromMatrixPosition(a.matrixWorld); _b.setFromMatrixPosition(b.matrixWorld); _c.setFromMatrixPosition(c.matrixWorld);
    _u.subVectors(_c, _a).normalize();
    _bend.subVectors(_b, _a); _bend.addScaledVector(_u, -_bend.dot(_u));
    if (_bend.lengthSq() < 1e-10) {
      _bend.copy(fallbackBend ?? _side.set(0, 0, 1)); _bend.addScaledVector(_u, -_bend.dot(_u));
      if (_bend.lengthSq() < 1e-10) _bend.set(1, 0, 0).addScaledVector(_u, -_u.x);
    }
    _bend.normalize();
    this.bendParent.copy(_bend).applyQuaternion(worldQuaternion(a.parent, _qParent).invert());
    _n0.crossVectors(_bend, _u).normalize();
    this.hingeLocal.copy(_n0).applyQuaternion(worldQuaternion(a, _qWorldA).invert());
  }

  /** Current upper + lower segment length (world units). */
  reach(): number {
    _a.setFromMatrixPosition(this.a.matrixWorld); _b.setFromMatrixPosition(this.b.matrixWorld); _c.setFromMatrixPosition(this.c.matrixWorld);
    return _a.distanceTo(_b) + _b.distanceTo(_c);
  }

  /** The anatomical bend direction in world space for the current parent pose. */
  bendWorld(out: Vector3): Vector3 { return out.copy(this.bendParent).applyQuaternion(worldQuaternion(this.a.parent!, _tmpQ)); }
}

/**
 * Rotates A and B so C reaches `target` (clamped to the reachable shell).
 * `pole` is a world point the middle joint should bend toward; null keeps the
 * animated swivel. World matrices of A's subtree are refreshed. Returns true
 * when the target was reachable without clamping.
 */
export function solveTwoBone(chain: TwoBoneChain, target: Vector3, pole: Vector3 | null = null): boolean {
  const { a, b, c } = chain;
  _a.setFromMatrixPosition(a.matrixWorld); _b.setFromMatrixPosition(b.matrixWorld); _c.setFromMatrixPosition(c.matrixWorld);
  const lab = _a.distanceTo(_b), lbc = _b.distanceTo(_c);
  if (!(lab > 1e-7 && lbc > 1e-7) || !Number.isFinite(target.x + target.y + target.z)) return false;
  _u.subVectors(target, _a);
  let d = _u.length();
  if (d < 1e-7) { _u.subVectors(_c, _a); if (_u.lengthSq() < 1e-14) return false; }
  _u.normalize();
  const dMin = Math.sqrt(Math.max(0, lab * lab + lbc * lbc - 2 * lab * lbc * chain.maxInteriorCos));
  const dMax = Math.min(lab + lbc, Math.sqrt(lab * lab + lbc * lbc - 2 * lab * lbc * chain.minInteriorCos)) * (1 - 1e-7);
  const reached = d >= dMin - 1e-6 && d <= dMax + 1e-6;
  d = Math.min(dMax, Math.max(dMin, d));

  // Swivel: the requested pole, else the animated middle joint, kept on the anatomical side.
  if (pole) _pole.subVectors(pole, _a); else _pole.subVectors(_b, _a);
  _pole.addScaledVector(_u, -_pole.dot(_u));
  chain.bendWorld(_bend); _bend.addScaledVector(_u, -_bend.dot(_u));
  const bendLength = _bend.length();
  if (bendLength > 1e-7) {
    _bend.divideScalar(bendLength);
    const poleLength = _pole.length();
    if (poleLength < 1e-7) _pole.copy(_bend);
    else {
      _pole.divideScalar(poleLength);
      const cos = _pole.dot(_bend);
      if (cos < chain.maxSwivelCos) {
        _side.copy(_pole).addScaledVector(_bend, -cos);
        if (_side.lengthSq() < 1e-12) _side.crossVectors(_u, _bend);
        _side.normalize();
        const sin = Math.sqrt(1 - chain.maxSwivelCos * chain.maxSwivelCos);
        _pole.copy(_bend).multiplyScalar(chain.maxSwivelCos).addScaledVector(_side, sin);
      }
    }
  } else if (_pole.lengthSq() < 1e-14) {
    _pole.copy(chain.hingeLocal).applyQuaternion(worldQuaternion(a, _tmpQ)).cross(_u);
  }
  _pole.normalize();

  const cosA = Math.min(1, Math.max(-1, (lab * lab + d * d - lbc * lbc) / (2 * lab * d)));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _b1.copy(_a).addScaledVector(_u, lab * cosA).addScaledVector(_pole, lab * sinA);
  _c1.copy(_a).addScaledVector(_u, d);

  // A: map (upper direction, bend normal) from the current pose onto the solution.
  _e0.subVectors(_b, _a); _v0.subVectors(_c, _b);
  _n0.crossVectors(_e0, _v0);
  if (_n0.lengthSq() < 1e-14 * lab * lab * lbc * lbc) _n0.copy(chain.hingeLocal).applyQuaternion(worldQuaternion(a, _tmpQ));
  _e1.subVectors(_b1, _a);
  _n1.crossVectors(_pole, _u);
  rotationBetweenFrames(_e0, _n0, _e1, _n1, _qA);
  worldQuaternion(a.parent!, _qParent); worldQuaternion(a, _qWorldA); worldQuaternion(b, _qWorldB);
  _qWorldA.premultiply(_qA);
  a.quaternion.copy(_qParent).invert().multiply(_qWorldA);

  // B: rotate about the new hinge so C lands on the solution.
  _qWorldB.premultiply(_qA);
  _v0.applyQuaternion(_qA);
  _v1.subVectors(_c1, _b1);
  rotationBetweenFrames(_v0, _n1, _v1, _n1, _qB);
  _qWorldB.premultiply(_qB);
  b.quaternion.copy(_qWorldA).invert().multiply(_qWorldB);
  a.updateMatrixWorld(true);
  return reached;
}
