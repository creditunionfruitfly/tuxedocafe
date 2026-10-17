import { Vector3 } from 'three';

/**
 * Support planes for paw planting: the floor, steps, slopes and perch tops.
 * A query fills `out` with the height and unit normal of the walkable surface
 * under (x, z) and returns false where there is none (the paw then follows the
 * animation). The navmesh and perch slots (M2-5) will supply the café's query.
 */
export interface SupportHit { height: number; readonly normal: Vector3 }
export type GroundQuery = (x: number, z: number, out: SupportHit) => boolean;

export function createSupportHit(): SupportHit { return { height: 0, normal: new Vector3(0, 1, 0) }; }

/** A horizontal floor at `height`. */
export function flatGround(height = 0): GroundQuery {
  return (_x, _z, out) => { out.height = height; out.normal.set(0, 1, 0); return true; };
}

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }

/** A raised box top (a step or perch) over a base query. */
export function withStep(base: GroundQuery, box: Box, height: number): GroundQuery {
  return (x, z, out) => {
    if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) { out.height = height; out.normal.set(0, 1, 0); return true; }
    return base(x, z, out);
  };
}

/**
 * A plane through (x0, height0, z0) rising `slopeDeg` along the horizontal
 * direction `headingRad` (0 = +Z), limited to `box`.
 */
export function withSlope(base: GroundQuery, box: Box, x0: number, z0: number, height0: number, slopeDeg: number, headingRad: number): GroundQuery {
  const grade = Math.tan(slopeDeg * Math.PI / 180), dx = Math.sin(headingRad), dz = Math.cos(headingRad);
  const normal = new Vector3(-dx * grade, 1, -dz * grade).normalize();
  return (x, z, out) => {
    if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) return base(x, z, out);
    out.height = height0 + ((x - x0) * dx + (z - z0) * dz) * grade; out.normal.copy(normal); return true;
  };
}
