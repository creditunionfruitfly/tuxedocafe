import { MathUtils, Quaternion, Vector3, type Mesh } from 'three';
import type { EventBus } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import { Animator, type AnimEventSink } from './animator.ts';
import { BlinkScheduler } from './blink.ts';
import { CATALOG, type Catalog, type PawId } from './catalog.ts';
import type { BoundClip } from './clip-library.ts';
import { ExpressionPlayer, type ExpressionLibrary } from './expressions.ts';
import type { GroundQuery } from './ground.ts';
import { LegIK, type IkChainSpec } from './leg-ik.ts';
import { LookAt } from './look-at.ts';
import { PoseBuffer } from './pose-buffer.ts';
import type { CatRig } from './rig.ts';
import { EAR_SPRING, SpringChain, TAIL_SPRING } from './spring-chain.ts';

/**
 * One cat's animation runtime. Each fixed 30 Hz step advances the clip clocks,
 * events, expressions and blinks; every `interval` steps it evaluates the pose
 * in stack order (data/animation-catalog.json `stackOrder`): mixer
 * (locomotion, actions, additive), look-at, leg IK, springs. Rendering
 * interpolates the last two evaluated poses, so distant cats can evaluate less
 * often without changing a single event or decision.
 */
export interface CatAnimationOptions {
  readonly id: string;
  readonly rig: CatRig;
  readonly clips: ReadonlyMap<string, BoundClip>;
  readonly expressions: ExpressionLibrary;
  readonly rng: Rng;
  readonly ikChains: readonly IkChainSpec[];
  readonly speedFactor: number;
  readonly bus?: EventBus | null;
  readonly catalog?: Catalog;
}
interface MorphMesh { readonly influences: number[]; readonly map: Int16Array }

const UP = new Vector3(0, 1, 0), BLINK_MORPHS = ['blink_L', 'blink_R'];
const TAIL_BONES = Array.from({ length: 12 }, (_, i) => `tail_${String(i + 1).padStart(2, '0')}`);

export class CatAnimation {
  readonly id: string;
  readonly rig: CatRig;
  readonly animator: Animator;
  readonly legs: LegIK;
  readonly look: LookAt;
  readonly tail: SpringChain | null;
  readonly ears: SpringChain[];
  readonly expressions: ExpressionPlayer;
  readonly blink: BlinkScheduler;
  readonly catalog: Catalog;
  /** Evaluate the pose every Nth step (1 near, 2–3 for distant cats); `phase` staggers cats. */
  interval = 1; phase = 0;
  /** Simulation transform of the cat root (ground height under the body, yaw about +Y). */
  readonly position = new Vector3(); yaw = 0;
  /** 0–1: eyes held shut (sleep); suppresses blinks. */
  eyesClosed = 0;
  /** Static shape morphs (bodyFat, bodyLean, headKitten) in catalog order. */
  readonly staticMorphs: Float64Array;
  readonly #bus: EventBus | null;
  readonly #raw: PoseBuffer; readonly #prev: PoseBuffer; readonly #curr: PoseBuffer;
  readonly #prevPosition = new Vector3(); readonly #currPosition = new Vector3(); #prevYaw = 0; #currYaw = 0;
  readonly #morphPrev: Float64Array; readonly #morphCurr: Float64Array; readonly #morphOut: Float64Array;
  readonly #blinkIndex: number[];
  readonly #scratch = new Float64Array(4);
  readonly #meshes: MorphMesh[] = [];
  readonly #sink: AnimEventSink;
  #ticks = 0; #sinceEval = 0; #pendingDt = 0; #evaluated = false;

  constructor(options: CatAnimationOptions) {
    this.id = options.id; this.rig = options.rig; this.catalog = options.catalog ?? CATALOG; this.#bus = options.bus ?? null;
    const rig = this.rig, count = rig.bones.length, morphs = this.catalog.morphTargets.length;
    rig.restoreRest(); rig.root.updateMatrixWorld(true);
    this.animator = new Animator(rig.root, options.clips, options.speedFactor, this.catalog);
    this.look = new LookAt(rig);
    this.legs = new LegIK(rig, options.ikChains);
    const tail = TAIL_BONES.map(name => rig.bone(name)).filter((bone, i, all) => bone && (i === 0 || bone.parent === all[i - 1]));
    this.tail = tail.length > 1 ? new SpringChain(tail as NonNullable<(typeof tail)[number]>[], TAIL_SPRING) : null;
    this.ears = (['L', 'R'] as const).map(side => [rig.bone(`ear_${side}_01`), rig.bone(`ear_${side}_02`)]).filter(([a, b]) => a && b && b.parent === a)
      .map(pair => new SpringChain(pair as NonNullable<(typeof pair)[number]>[], EAR_SPRING));
    this.expressions = new ExpressionPlayer(options.expressions);
    this.blink = new BlinkScheduler(options.rng.fork('blink'));
    this.#raw = new PoseBuffer(count).capture(rig.bones); this.#prev = new PoseBuffer(count); this.#curr = new PoseBuffer(count);
    this.#morphPrev = new Float64Array(morphs); this.#morphCurr = new Float64Array(morphs); this.#morphOut = new Float64Array(morphs);
    this.staticMorphs = new Float64Array(morphs);
    this.#blinkIndex = BLINK_MORPHS.map(name => this.catalog.morphTargets.indexOf(name)).filter(i => i >= 0);
    this.#sink = (clip, name) => this.#bus?.emit('cat:anim-event', { cat: this.id, clip, name });
  }

  set ground(query: GroundQuery) { this.legs.ground = query; }

  /** Morph targets on a mesh (every LOD's cat_body) follow the catalog names. */
  addMorphMesh(mesh: Mesh): void {
    const dictionary = mesh.morphTargetDictionary, influences = mesh.morphTargetInfluences;
    if (!dictionary || !influences) return;
    this.#meshes.push({ influences, map: Int16Array.from(this.catalog.morphTargets, name => dictionary[name] ?? -1) });
  }

  /** Teleport (spawn, cut): no interpolation from the old place and fresh IK and springs. */
  place(x: number, y: number, z: number, yaw: number): void {
    this.position.set(x, y, z); this.yaw = yaw;
    this.legs.reset(); this.tail?.reset(); for (const ear of this.ears) ear.reset();
    this.#evaluated = false;
  }

  /**
   * Sets locomotion and moves the cat along its heading for one step (yaw
   * rate + is a left turn). M2-5's navigation will call this from its paths.
   */
  drive(speed: number, turnRate: number, dt: number): void {
    this.animator.setLocomotion(speed, turnRate);
    this.yaw += turnRate * dt;
    this.position.x += Math.sin(this.yaw) * speed * dt; this.position.z += Math.cos(this.yaw) * speed * dt;
  }

  lookAt(point: Vector3 | null, weight = 1): void { this.look.setTarget(point, weight); }
  reach(paw: PawId, point: Vector3 | null, weight = 1): void { this.legs.setReach(paw, point, weight); }

  /** One fixed simulation step. */
  tick(dt: number): void {
    this.#ticks++;
    this.animator.advance(dt, this.#sink);
    this.expressions.advance(dt);
    if (this.blink.advance(dt, this.eyesClosed > .5 || this.animator.morphs[this.#blinkIndex[0] ?? 0]! > .1)) this.expressions.play('blink');
    this.#pendingDt += dt; this.#sinceEval++;
    if (!this.#evaluated || (this.#ticks + this.phase) % Math.max(1, this.interval) === 0) this.#evaluate(this.#pendingDt);
  }

  #evaluate(dt: number): void {
    const rig = this.rig, root = rig.root, first = !this.#evaluated;
    this.#raw.apply(rig.bones);
    root.position.copy(this.position); root.quaternion.setFromAxisAngle(UP, this.yaw);
    this.animator.apply();
    this.#raw.capture(rig.bones);
    root.updateMatrixWorld(true);
    this.look.solve(dt);
    this.legs.lockEnabled = this.animator.previewClip === null;
    this.legs.solve(dt, this.animator.contacts, this.animator.locoWeight, 1 - Math.min(1, this.animator.rootMotion));
    this.tail?.solve(dt, this.position.y);
    for (const ear of this.ears) ear.solve(dt);
    const morphs = this.#morphCurr;
    if (!first) { this.#prev.copy(this.#curr); this.#morphPrev.set(morphs); }
    this.#curr.capture(rig.bones);
    morphs.fill(0); this.expressions.accumulate(morphs);
    for (let i = 0; i < morphs.length; i++) morphs[i] = Math.max(morphs[i]!, this.animator.morphs[i]!);
    for (const i of this.#blinkIndex) morphs[i] = Math.max(morphs[i]!, this.eyesClosed);
    this.#prevPosition.copy(first ? this.position : this.#currPosition); this.#prevYaw = first ? this.yaw : this.#currYaw;
    this.#currPosition.copy(this.position); this.#currYaw = this.yaw;
    if (first) { this.#prev.copy(this.#curr); this.#morphPrev.set(morphs); }
    this.#evaluated = true; this.#sinceEval = 0; this.#pendingDt = 0;
  }

  /** Writes the interpolated pose, placement and morphs for this frame. */
  render(alpha: number): void {
    if (!this.#evaluated) return;
    const t = Math.min(1, Math.max(0, (this.#sinceEval + alpha) / Math.max(1, this.interval)));
    const rig = this.rig, root = rig.root;
    PoseBuffer.interpolate(this.#prev, this.#curr, t, rig.bones, this.#scratch);
    root.position.lerpVectors(this.#prevPosition, this.#currPosition, t);
    const turn = Math.atan2(Math.sin(this.#currYaw - this.#prevYaw), Math.cos(this.#currYaw - this.#prevYaw));
    root.quaternion.setFromAxisAngle(UP, this.#prevYaw + turn * t);
    const out = this.#morphOut;
    for (let i = 0; i < out.length; i++) out[i] = MathUtils.clamp(this.staticMorphs[i]! + this.#morphPrev[i]! + (this.#morphCurr[i]! - this.#morphPrev[i]!) * t, 0, 1);
    for (const mesh of this.#meshes) for (let i = 0; i < mesh.map.length; i++) { const k = mesh.map[i]!; if (k >= 0) mesh.influences[k] = out[i]!; }
  }

  /** The last evaluated simulation pose (tests and replays). */
  get pose(): PoseBuffer { return this.#curr; }
  get morphWeights(): Float64Array { return this.#morphCurr; }

  dispose(): void { this.animator.dispose(); this.look.dispose(); }
}

/** A world-space quaternion for a yaw, for callers placing cats. */
export function yawQuaternion(yaw: number, out = new Quaternion()): Quaternion { return out.setFromAxisAngle(UP, yaw); }
