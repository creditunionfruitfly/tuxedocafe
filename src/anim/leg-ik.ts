import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { PAWS, type PawId } from './catalog.ts';
import { createSupportHit, flatGround, type GroundQuery } from './ground.ts';
import type { CatRig } from './rig.ts';
import { DEFAULT_LIMITS, solveTwoBone, TwoBoneChain } from './two-bone-ik.ts';

/** One entry of art/rig/skeleton.json `ikChains`. */
export interface IkChainSpec { readonly name: string; readonly root: string; readonly middle: string; readonly effector: string; readonly pole?: readonly number[] }

const CHAIN_PAW: Readonly<Record<string, PawId>> = { front_L: 'LF', front_R: 'RF', hind_L: 'LH', hind_R: 'RH' };
const UP = new Vector3(0, 1, 0), LATERAL = new Vector3(1, 0, 0);
const _p = new Vector3(), _v = new Vector3(), _s = new Vector3(), _axis = new Vector3();
const _q = new Quaternion(), _q2 = new Quaternion(), _qParent = new Quaternion(), _qRoot = new Quaternion(), _qPitch = new Quaternion();
const _identity = new Quaternion();
const _hit = createSupportHit();

/** Seconds for a released paw to return to its animated path. */
const RELEASE_S = .12, LOCK_BLEND_S = .1;
/** Pelvis and pitch smoothing time constant (s); body pitch and paw tilt limits (rad). */
const PELVIS_TAU = .07, MAX_PITCH = .26, MAX_TILT = .6;
/** Planted limbs are kept just short of full extension when the pelvis drops (unless animated straighter). */
const REACH_MARGIN = .985;
/** Extra crouch a stretched planted leg may ask for, the lock drift that re-plants a paw, and a re-plant's lift (× leg length). */
const REACH_DROP = .06, DRIFT = .3, STEP_LIFT = .06;

export class Leg {
  readonly id: PawId; readonly front: boolean; readonly chain: TwoBoneChain; readonly effector: Object3D;
  /** The paw-pad contact point in the effector's local frame, measured at bind. */
  readonly padLocal = new Vector3();
  /** Upper + lower + distal length at bind (world units). */
  readonly length: number;
  locked = false; planted = false; release = 0;
  readonly lock = new Vector3(); readonly released = new Vector3();
  readonly reach = new Vector3(); reachWeight = 0; pole: Vector3 | null = null;
  // Per-solve scratch.
  readonly padAnim = new Vector3(); readonly distal = new Vector3(); readonly distalWorld = new Quaternion();
  readonly target = new Vector3(); readonly align = new Quaternion(); contact = 0; lockWeight = 0; animReach = 0;
  readonly swing = new Vector3(); swingGround = 0;
  readonly animA = new Quaternion(); readonly animB = new Quaternion(); readonly animC = new Quaternion();
  constructor(id: PawId, chain: TwoBoneChain, effector: Object3D, length: number) {
    this.id = id; this.front = id[1] === 'F'; this.chain = chain; this.effector = effector; this.length = length;
  }
}

/**
 * Leg IK, run after the mixer, additive layers and look-at: stance paws lock to
 * the support plane (released on swing, re-planted if the body drifts too far),
 * swing paws follow the animation over the terrain, the pelvis lowers and
 * pitches smoothly so every planted paw can reach, and planted paws tilt onto
 * the plane. Front paws accept reach targets (predicted toy positions).
 * The body is never moved to a foot and no limb stretches past its length.
 */
export class LegIK {
  readonly legs: Leg[];
  readonly rig: CatRig;
  readonly pelvis: Object3D;
  ground: GroundQuery = flatGround(0);
  /** Lock stance paws in the world (off for in-place previews). */
  lockEnabled = true;
  weight = 1;
  pitchWeight = .6;
  pelvisOffset = 0; pitch = 0;
  readonly #span: number; readonly #minLength: number;
  readonly #animPos = new Vector3(); readonly #animQuat = new Quaternion();

  constructor(rig: CatRig, chains: readonly IkChainSpec[]) {
    this.rig = rig; this.pelvis = rig.require('pelvis');
    rig.root.updateMatrixWorld(true);
    const toCat = new Matrix4().copy(rig.root.matrixWorld).invert();
    this.legs = [];
    for (const spec of chains) {
      const id = CHAIN_PAW[spec.name]; if (!id) continue;
      const a = rig.require(spec.root), b = rig.require(spec.middle), effector = rig.require(spec.effector);
      let c: Object3D | null = effector;
      while (c && c.parent !== b) c = c.parent;
      if (!c) throw new Error(`${spec.effector} is not below ${spec.middle}`);
      const fallback = spec.pole ? new Vector3(spec.pole[0], spec.pole[1], spec.pole[2]).transformDirection(rig.root.matrixWorld) : undefined;
      const chain = new TwoBoneChain(a, b, c, DEFAULT_LIMITS, fallback);
      // The pad sits on the bind floor (cat-space y = 0) under the effector.
      const pad = new Vector3().setFromMatrixPosition(effector.matrixWorld).applyMatrix4(toCat);
      pad.y = 0; pad.applyMatrix4(rig.root.matrixWorld);
      const leg = new Leg(id, chain, effector, chain.reach() + new Vector3().setFromMatrixPosition(c.matrixWorld).distanceTo(pad));
      leg.padLocal.copy(pad).applyMatrix4(new Matrix4().copy(effector.matrixWorld).invert());
      this.legs.push(leg);
    }
    this.legs.sort((x, y) => PAWS.indexOf(x.id) - PAWS.indexOf(y.id));
    const shoulder = this.legs.find(l => l.front), hip = this.legs.find(l => !l.front);
    this.#span = shoulder && hip ? Math.max(.05, new Vector3().setFromMatrixPosition(shoulder.chain.a.matrixWorld).distanceTo(new Vector3().setFromMatrixPosition(hip.chain.a.matrixWorld))) : .3;
    this.#minLength = this.legs.reduce((min, leg) => Math.min(min, leg.length), Infinity);
  }

  leg(id: PawId): Leg | undefined { for (const leg of this.legs) if (leg.id === id) return leg; return undefined; }

  /** Aim a paw's pad at a world point (null releases). Front paws reach for toys this way. */
  setReach(id: PawId, target: Vector3 | null, weight = 1): void {
    const leg = this.leg(id); if (!leg) return;
    if (target) leg.reach.copy(target);
    leg.reachWeight = target ? Math.min(1, Math.max(0, weight)) : 0;
  }

  /** Bend a knee or elbow toward a world point (null keeps the animated swivel). */
  setPole(id: PawId, pole: Vector3 | null): void {
    const leg = this.leg(id); if (!leg) return;
    leg.pole = pole ? (leg.pole ?? new Vector3()).copy(pole) : null;
  }

  /** Forget locks and smoothing (after a teleport or a cut). */
  reset(): void { for (const leg of this.legs) { leg.locked = false; leg.release = 0; } this.pelvisOffset = 0; this.pitch = 0; }

  /** World pad position of a leg in the current pose. */
  padPosition(id: PawId, out: Vector3): Vector3 {
    const leg = this.leg(id); if (!leg) return out.set(NaN, NaN, NaN);
    return out.copy(leg.padLocal).applyMatrix4(leg.effector.matrixWorld);
  }

  /**
   * `phaseContacts[i]` (PAWS order) is the locomotion stance weight already
   * multiplied by `locoWeight`; the rest of each contact comes from pad height.
   * `enable` fades the whole solve (0 during root-motion jumps).
   */
  solve(dt: number, phaseContacts: ArrayLike<number>, locoWeight: number, enable = 1): void {
    const w = Math.min(1, Math.max(0, this.weight * enable));
    if (w <= 0) { this.reset(); return; }
    const root = this.rig.root;
    root.matrixWorld.decompose(_p, _qRoot, _s);
    const rootY = _p.y, smoothing = 1 - Math.exp(-dt / PELVIS_TAU);
    this.#animPos.copy(this.pelvis.position); this.#animQuat.copy(this.pelvis.quaternion);
    let frontSum = 0, frontCount = 0, hindSum = 0, hindCount = 0;
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!;
      leg.padAnim.copy(leg.padLocal).applyMatrix4(leg.effector.matrixWorld);
      leg.chain.c.matrixWorld.decompose(_v, leg.distalWorld, _s);
      leg.distal.subVectors(_v, leg.padAnim);
      leg.animReach = _v.distanceTo(_p.setFromMatrixPosition(leg.chain.a.matrixWorld));
      leg.animA.copy(leg.chain.a.quaternion); leg.animB.copy(leg.chain.b.quaternion); leg.animC.copy(leg.chain.c.quaternion);
      const height = leg.padAnim.y - rootY;
      if (height < leg.length * .04) leg.planted = true; else if (height > leg.length * .1) leg.planted = false;
      leg.contact = Math.min(1, (phaseContacts[PAWS.indexOf(leg.id)] ?? 0) + (1 - locoWeight) * (leg.planted ? 1 : 0));
      _hit.normal.set(0, 1, 0);
      const groundY = this.ground(leg.padAnim.x, leg.padAnim.z, _hit) ? _hit.height : rootY;
      // Swing path: the animated pad height kept above the local support.
      leg.swing.copy(leg.padAnim); leg.swing.y += groundY - rootY; leg.swingGround = groundY;
      if (this.lockEnabled && leg.contact >= .5) {
        // A stance pad rests on the support under where it touched down.
        if (!leg.locked) { leg.locked = true; leg.lockWeight = 0; leg.lock.set(leg.swing.x, groundY, leg.swing.z); }
        else if (Math.hypot(leg.lock.x - leg.swing.x, leg.lock.z - leg.swing.z) > leg.length * DRIFT) this.#replant(leg);
      } else if (leg.locked) { leg.locked = false; leg.released.copy(leg.lock); leg.release = 1; }
      // Reach weight ramps in around touchdown rather than snapping the pad down.
      leg.lockWeight = leg.locked ? Math.min(Math.min(1, (leg.contact - .5) / .3), leg.lockWeight + dt / LOCK_BLEND_S) : 0;
      this.#target(leg);
      if (leg.release > 0) leg.release = Math.max(0, leg.release - dt / RELEASE_S);
      // Planted paws tilt onto the support plane, up to MAX_TILT.
      leg.align.setFromUnitVectors(UP, _hit.normal);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(leg.align.w)));
      const tilt = leg.lockWeight * (1 - leg.reachWeight) * (angle > MAX_TILT ? MAX_TILT / angle : 1);
      leg.align.slerpQuaternions(_identity, leg.align, tilt);
      if (leg.contact > .25) {
        const delta = leg.target.y - leg.padAnim.y;
        if (leg.front) { frontSum += delta; frontCount++; } else { hindSum += delta; hindCount++; }
      }
    }
    const supported = frontCount + hindCount > 0;
    // Body pitch from the front/hind support difference, then the pelvis height.
    const pitchTarget = frontCount && hindCount
      ? Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(frontSum / frontCount - hindSum / hindCount, this.#span) * this.pitchWeight)) : 0;
    this.pitch += (pitchTarget * w - this.pitch) * smoothing;
    this.#applyPelvis(this.pitch, 0);
    // Lower the body by the lowest planted paw's height error (smoothed), and at
    // once as far as a planted paw needs to reach its support where the animation
    // puts it. Horizontal drift from a lock is not a reason to crouch: that paw steps.
    let comfort = Infinity, limit = Infinity;
    for (const leg of this.legs) {
      if (leg.contact <= .25) continue;
      comfort = Math.min(comfort, leg.target.y - _p.copy(leg.padLocal).applyMatrix4(leg.effector.matrixWorld).y);
      const terrain = this.#reachLimit(leg, leg.swing.x, leg.swing.z), locked = this.#reachLimit(leg, leg.target.x, leg.target.z);
      limit = Math.min(limit, terrain, Math.max(locked, terrain - leg.length * REACH_DROP));
    }
    const maxDrop = this.#minLength * .3, maxRaise = this.#minLength * .15;
    const comfortTarget = supported ? Math.max(-maxDrop, Math.min(maxRaise, comfort)) : 0;
    this.pelvisOffset += (comfortTarget * w - this.pelvisOffset) * smoothing;
    if (supported) this.pelvisOffset = Math.max(-maxDrop, Math.min(this.pelvisOffset, limit * w));
    this.#applyPelvis(this.pitch, this.pelvisOffset);
    for (const leg of this.legs) {
      _v.copy(leg.distal).applyQuaternion(leg.align).add(leg.target);
      if (leg.locked && leg.release === 0 && Math.hypot(leg.lock.x - leg.swing.x, leg.lock.z - leg.swing.z) > leg.length * .02
        && _v.distanceTo(_p.setFromMatrixPosition(leg.chain.a.matrixWorld)) > Math.max(leg.chain.reach() * REACH_MARGIN, leg.animReach) * 1.002) {
        this.#replant(leg); this.#target(leg);
        _v.copy(leg.distal).applyQuaternion(leg.align).add(leg.target);
      }
      solveTwoBone(leg.chain, _v, leg.pole);
      // Distal paw: the animated world orientation, tilted onto the support.
      _q.copy(leg.align).multiply(leg.distalWorld);
      leg.chain.b.matrixWorld.decompose(_p, _q2, _s);
      leg.chain.c.quaternion.copy(_q2.invert().multiply(_q));
      if (w < 1) {
        leg.chain.a.quaternion.slerpQuaternions(leg.animA, leg.chain.a.quaternion, w);
        leg.chain.b.quaternion.slerpQuaternions(leg.animB, leg.chain.b.quaternion, w);
        leg.chain.c.quaternion.slerpQuaternions(leg.animC, leg.chain.c.quaternion, w);
      }
      leg.chain.a.updateMatrixWorld(true);
    }
  }

  /**
   * The highest pelvis offset at which this leg's wrist/hock target (pad at
   * x, z and the current goal height) is within reach; +∞ if it never is.
   */
  #reachLimit(leg: Leg, x: number, z: number): number {
    _v.set(x, leg.target.y, z).add(_s.copy(leg.distal).applyQuaternion(leg.align));
    _p.setFromMatrixPosition(leg.chain.a.matrixWorld);
    const full = leg.chain.reach(), reach = Math.max(full * REACH_MARGIN, Math.min(full * .9999, leg.animReach)), horizontal = Math.hypot(_v.x - _p.x, _v.z - _p.z);
    return horizontal < reach ? _v.y - _p.y + Math.sqrt(reach * reach - horizontal * horizontal) : Infinity;
  }

  /** The pad goal from swing path, lock, release and reach, in that order. */
  #target(leg: Leg): void {
    leg.target.copy(leg.swing);
    if (leg.lockWeight > 0) leg.target.lerp(leg.lock, leg.lockWeight);
    if (leg.release > 0) { leg.target.lerp(leg.released, leg.release); leg.target.y += Math.sin(Math.PI * leg.release) * leg.length * STEP_LIFT; }
    if (leg.reachWeight > 0) leg.target.lerp(leg.reach, leg.reachWeight);
  }

  /** A planted paw that drifted too far or out of reach steps to its animated spot. */
  #replant(leg: Leg): void {
    leg.released.copy(leg.lock); leg.release = 1;
    leg.lock.set(leg.swing.x, leg.swingGround, leg.swing.z);
  }

  /** Pitch the body about the cat's lateral axis at the pelvis joint and lift it by `offset` (world units). */
  #applyPelvis(pitch: number, offset: number): void {
    const pelvis = this.pelvis, parent = pelvis.parent!;
    parent.matrixWorld.decompose(_p, _qParent, _s);
    _qPitch.setFromAxisAngle(_axis.copy(LATERAL).applyQuaternion(_qRoot), -pitch);
    pelvis.quaternion.copy(_qParent).invert().multiply(_qPitch).multiply(_qParent).multiply(this.#animQuat);
    _v.set(0, offset / Math.max(1e-6, _s.y), 0).applyQuaternion(_q.copy(_qParent).invert());
    pelvis.position.copy(this.#animPos).add(_v);
    pelvis.updateMatrixWorld(true);
  }
}
