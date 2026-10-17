import type { Tier } from '../core/tiers.ts';

/**
 * Cat mesh LODs (README D5, tiers table): 30k/12k/4k triangles. Desktop tiers
 * use LOD0 near; Phone and Low phone never go above the 12k LOD1. Distant cats
 * also evaluate their animation less often (README Animation spec).
 */
export const LOD_DISTANCES: readonly [number, number] = [3.5, 8];
const HYSTERESIS = .4;
export const ANIMATION_INTERVAL_DISTANCES: readonly [number, number] = [5, 9];

export function isPhoneTier(tier: Tier): boolean { return tier === 'phone' || tier === 'low'; }

/** The wanted level for a camera distance, sticky within the hysteresis band around each switch. */
export function chooseLod(distance: number, tier: Tier, current = -1): number {
  let level = distance < LOD_DISTANCES[0] ? 0 : distance < LOD_DISTANCES[1] ? 1 : 2;
  if (current >= 0 && current !== level) {
    const edge = LOD_DISTANCES[Math.min(current, level)]!;
    if (Math.abs(distance - edge) < HYSTERESIS) level = current;
  }
  return isPhoneTier(tier) ? Math.max(1, level) : level;
}

/** The closest loaded level to the wanted one, preferring more detail on ties. */
export function nearestAvailable(level: number, available: readonly boolean[]): number {
  for (let offset = 0; offset < available.length; offset++) {
    if (available[level - offset]) return level - offset;
    if (available[level + offset]) return level + offset;
  }
  return -1;
}

/** Evaluate the pose every step near the camera, every 2nd or 3rd step further away. */
export function animationInterval(distance: number): number {
  return distance < ANIMATION_INTERVAL_DISTANCES[0] ? 1 : distance < ANIMATION_INTERVAL_DISTANCES[1] ? 2 : 3;
}
