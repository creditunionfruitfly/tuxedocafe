import type { GaitThresholds } from './catalog.ts';

/**
 * Locomotion blending by speed (README Animation spec: walk below about
 * 1.1 m/s, trot to about 2.2 m/s, gallop above). Speeds here are normalized:
 * the world speed divided by the cat's speed factor (scale × leg length), so a
 * kitten's short stride reaches a trot at a lower world speed than Juniper's.
 */
export type Gait = 'idle' | 'walk' | 'trot' | 'gallop';
export const GAITS: readonly Gait[] = ['idle', 'walk', 'trot', 'gallop'];
/** Below this normalized speed the cat stands. */
export const IDLE_SPEED = .03;
const START_BLEND = .3, WALK_TROT_HALF = .12, TROT_GALLOP_HALF = .2;
/** Playback rates outside this range would look wrong; IK foot locking absorbs the rest. */
export const MIN_TIME_SCALE = .4, MAX_TIME_SCALE = 2.5;

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** The dominant gait: walk below `walkMax`, trot below `trotMax`, gallop above. */
export function selectGait(speed: number, thresholds: GaitThresholds): Gait {
  if (speed < IDLE_SPEED) return 'idle';
  if (speed < thresholds.walkMax) return 'walk';
  if (speed < thresholds.trotMax) return 'trot';
  return 'gallop';
}

/**
 * Weights for idle, walk, trot and gallop (summing to 1), cross-faded around
 * each threshold so the dominant weight always agrees with selectGait.
 */
export function gaitWeights(speed: number, thresholds: GaitThresholds, out: Float64Array): Float64Array {
  const moving = smooth(IDLE_SPEED, START_BLEND, speed);
  const trot = smooth(thresholds.walkMax - WALK_TROT_HALF, thresholds.walkMax + WALK_TROT_HALF, speed);
  const gallop = smooth(thresholds.trotMax - TROT_GALLOP_HALF, thresholds.trotMax + TROT_GALLOP_HALF, speed);
  out[0] = 1 - moving;
  out[1] = moving * (1 - trot);
  out[2] = moving * trot * (1 - gallop);
  out[3] = moving * trot * gallop;
  return out;
}

/** World speed → adult-equivalent speed. */
export function normalizeSpeed(speed: number, speedFactor: number): number {
  return speedFactor > 0 ? Math.abs(speed) / speedFactor : 0;
}

/** Playback rate that keeps an in-place clip's stride on the ground at a normalized speed. */
export function gaitTimeScale(normalizedSpeed: number, authoredSpeed: number): number {
  if (authoredSpeed <= 0) return 1;
  return Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, normalizedSpeed / authoredSpeed));
}

/** Stride scale: `scale` (uniform build) × leg length relative to the adult master. */
export function speedFactor(scale: number, legScale: number): number {
  return Math.max(.05, scale * legScale);
}
