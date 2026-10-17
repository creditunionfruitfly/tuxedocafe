/**
 * Signed distance fields for the master cat sculpt.
 *
 * Every shape is a node with a bounding box. `compile(box, threshold)` returns an evaluator that
 * keeps only the children that can change the field inside `box` for values below `threshold`,
 * so the narrow-band mesher evaluates a handful of primitives per block. Culling is sound for the
 * sign everywhere and for the value wherever |d| < threshold (see mesher.ts).
 */

export type Vec3 = [number, number, number];
export type Field = (x: number, y: number, z: number) => number;
export type Box = { min: Vec3; max: Vec3 };
export type Op = 'union' | 'subtract' | 'intersect';

export interface Shape {
  readonly name: string;
  /** Region where the shape's own value can be negative, i.e. its solid. */
  readonly box: Box;
  compile(box: Box, threshold: number): Field | null;
  readonly eval: Field;
}

const FAR = 1e3;

export function smin(a: number, b: number, k: number) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * .25;
}
export function smax(a: number, b: number, k: number) { return -smin(-a, -b, k); }
export const clamp = (v: number, lo: number, hi: number) => v < lo ? lo : v > hi ? hi : v;
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function expand(box: Box, by: number): Box {
  return { min: [box.min[0] - by, box.min[1] - by, box.min[2] - by], max: [box.max[0] + by, box.max[1] + by, box.max[2] + by] };
}
export function overlaps(a: Box, b: Box) {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] && a.min[1] <= b.max[1] && a.max[1] >= b.min[1] && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}
export function unionBox(boxes: Box[]): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, b.min[i]!); max[i] = Math.max(max[i]!, b.max[i]!); }
  return { min, max };
}

/** Distance from a point to an axis-aligned box (0 inside). */
export function boxDistance(box: Box, x: number, y: number, z: number) {
  const dx = Math.max(box.min[0] - x, 0, x - box.max[0]), dy = Math.max(box.min[1] - y, 0, y - box.max[1]), dz = Math.max(box.min[2] - z, 0, z - box.max[2]);
  return Math.hypot(dx, dy, dz);
}

/**
 * A leaf with a fixed evaluator. `box` must contain every point where the field is negative.
 * Approximate fields are clamped to at least the box distance so that culling by box is exact:
 * a block farther than the threshold from the box sees a value above the threshold either way.
 */
export function leaf(name: string, box: Box, field: Field, exact = false): Shape {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
  const safe: Field = exact ? field : (x, y, z) => {
    const v = field(x, y, z);
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0, dz = z < z0 ? z0 - z : z > z1 ? z - z1 : 0;
    if (dx === 0 && dy === 0 && dz === 0) return v;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return v > d ? v : d;
  };
  return { name, box, eval: safe, compile: (b, t) => overlaps(expand(box, t), b) ? safe : null };
}

export interface Child { shape: Shape; op: Op; k: number }

/**
 * Ordered CSG list: d = op(d, child, k) for each child in turn. The first child must be a union.
 */
export function group(name: string, children: Child[]): Shape {
  const unions = children.filter(c => c.op === 'union');
  const box = unionBox(unions.map(c => expand(c.shape.box, c.k * .5)));
  const evaluate = build(children.map(c => ({ field: c.shape.eval, op: c.op, k: c.k })));
  return {
    name, box, eval: evaluate,
    compile(target, threshold) {
      if (!overlaps(expand(box, threshold), target)) return null;
      const kept: { field: Field; op: Op; k: number }[] = [];
      for (const c of children) {
        const field = c.shape.compile(target, threshold + c.k);
        if (field) kept.push({ field, op: c.op, k: c.k });
        else if (c.op === 'intersect') return null;
      }
      if (!kept.some(c => c.op === 'union')) return null;
      return build(kept);
    },
  };
}

function build(list: { field: Field; op: Op; k: number }[]): Field {
  if (list.length === 1 && list[0]!.op === 'union') return list[0]!.field;
  const fields = list.map(c => c.field), ops = list.map(c => c.op === 'union' ? 0 : c.op === 'subtract' ? 1 : 2), ks = list.map(c => c.k);
  const n = list.length;
  return (x, y, z) => {
    let d = FAR;
    for (let i = 0; i < n; i++) {
      const v = fields[i]!(x, y, z), k = ks[i]!, op = ops[i];
      if (op === 0) d = smin(d, v, k);
      else if (op === 1) d = smax(d, -v, k);
      else d = smax(d, v, k);
    }
    return d;
  };
}

/** Rows of a rotation taking world offsets into the primitive's local axes. */
export type Basis = [Vec3, Vec3, Vec3];
export const IDENTITY: Basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export function normalize(v: Vec3): Vec3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
export function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function dot(a: Vec3, b: Vec3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function scale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }
export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
export function length3(a: Vec3) { return Math.hypot(a[0], a[1], a[2]); }

/** Orthonormal basis whose local +Y follows `up` and +Z follows `forward` (re-orthogonalised). */
export function basisFrom(forward: Vec3, up: Vec3): Basis {
  const z = normalize(forward), x = normalize(cross(up, z)), y = cross(z, x);
  return [x, y, z];
}
/** Basis rotated by Euler angles (radians) about local X (pitch), then Y (yaw), then Z (roll). */
export function eulerBasis(pitch: number, yaw: number, roll: number): Basis {
  const cx = Math.cos(pitch), sx = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw), cz = Math.cos(roll), sz = Math.sin(roll);
  // World-from-local matrix M = Ry * Rx * Rz; rows of M^T map world to local.
  const m = [
    [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
    [cx * sz, cx * cz, -sx],
    [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
  ];
  return [[m[0]![0]!, m[1]![0]!, m[2]![0]!], [m[0]![1]!, m[1]![1]!, m[2]![1]!], [m[0]![2]!, m[1]![2]!, m[2]![2]!]];
}

function boxAround(center: Vec3, radius: number): Box {
  return { min: [center[0] - radius, center[1] - radius, center[2] - radius], max: [center[0] + radius, center[1] + radius, center[2] + radius] };
}

export function sphere(name: string, c: Vec3, r: number): Shape {
  const [cx, cy, cz] = c;
  return leaf(name, boxAround(c, r), (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r, true);
}

/** Ellipsoid with semi-axes `r` along the basis rows (first-order distance estimate). */
export function ellipsoid(name: string, c: Vec3, r: Vec3, basis: Basis = IDENTITY): Shape {
  const [cx, cy, cz] = c, [rx, ry, rz] = r, [bx, by, bz] = basis;
  const rmin = Math.min(rx, ry, rz);
  return leaf(name, boxAround(c, Math.max(rx, ry, rz)), (x, y, z) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const lx = (dx * bx[0] + dy * bx[1] + dz * bx[2]) / rx, ly = (dx * by[0] + dy * by[1] + dz * by[2]) / ry, lz = (dx * bz[0] + dy * bz[1] + dz * bz[2]) / rz;
    const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (k0 < 1e-9) return -rmin;
    const k1 = Math.sqrt(lx * lx / (rx * rx) + ly * ly / (ry * ry) + lz * lz / (rz * rz));
    return k0 * (k0 - 1) / k1;
  });
}

/** Exact round cone (capsule with different end radii). */
export function roundCone(name: string, a: Vec3, b: Vec3, ra: number, rb: number): Shape {
  const ba = sub(b, a), l2 = dot(ba, ba), rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2;
  const box = unionBox([boxAround(a, ra), boxAround(b, rb)]);
  const [ax, ay, az] = a, [bax, bay, baz] = ba;
  return leaf(name, box, (x, y, z) => {
    const pax = x - ax, pay = y - ay, paz = z - az;
    const yv = pax * bax + pay * bay + paz * baz, zv = yv - l2;
    const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv;
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yv * yv * l2, z2 = zv * zv * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
  }, true);
}
export function capsule(name: string, a: Vec3, b: Vec3, r: number) { return roundCone(name, a, b, r, r); }

/** Chain of round cones through points with radii. Segments share end spheres, so a hard union
 * is already tangent-continuous (a smooth union would bead at every joint). */
export function tube(name: string, points: Vec3[], radii: number[]): Shape {
  const parts: Child[] = [];
  for (let i = 0; i + 1 < points.length; i++) parts.push({ shape: roundCone(`${name}.${i}`, points[i]!, points[i + 1]!, radii[i]!, radii[i + 1]!), op: 'union', k: 0 });
  return group(name, parts);
}

/** Rounded box with half extents `h` in the basis frame. */
export function roundBox(name: string, c: Vec3, h: Vec3, r: number, basis: Basis = IDENTITY): Shape {
  const [cx, cy, cz] = c, [bx, by, bz] = basis;
  return leaf(name, boxAround(c, Math.hypot(h[0], h[1], h[2]) + r), (x, y, z) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const qx = Math.abs(dx * bx[0] + dy * bx[1] + dz * bx[2]) - h[0] + r, qy = Math.abs(dx * by[0] + dy * by[1] + dz * by[2]) - h[1] + r, qz = Math.abs(dx * bz[0] + dy * bz[1] + dz * bz[2]) - h[2] + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
  });
}

/** Half-space: negative on the side opposite to the normal. */
export function plane(name: string, point: Vec3, normal: Vec3, box: Box): Shape {
  const n = normalize(normal), [px, py, pz] = point;
  return leaf(name, box, (x, y, z) => (x - px) * n[0] + (y - py) * n[1] + (z - pz) * n[2]);
}

/** Generic primitive from a custom field and box (for shells, sweeps and plates). */
export function custom(name: string, box: Box, field: Field): Shape { return leaf(name, box, field); }

/** Central-difference gradient. */
export function gradient(f: Field, x: number, y: number, z: number, h = 2e-5): Vec3 {
  return [
    (f(x + h, y, z) - f(x - h, y, z)) / (2 * h),
    (f(x, y + h, z) - f(x, y - h, z)) / (2 * h),
    (f(x, y, z + h) - f(x, y, z - h)) / (2 * h),
  ];
}

/**
 * Egg: an ellipsoid whose semi-axes differ on the positive and negative side of each local axis
 * (`rp` and `rn`), giving muscle-like asymmetric volumes. Tangent-continuous across the axis planes.
 */
export function egg(name: string, c: Vec3, rp: Vec3, rn: Vec3, basis: Basis = IDENTITY): Shape {
  const [cx, cy, cz] = c, [bx, by, bz] = basis;
  const rmin = Math.min(...rp, ...rn), rmax = Math.max(...rp, ...rn);
  return leaf(name, boxAround(c, rmax), (x, y, z) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const px = dx * bx[0] + dy * bx[1] + dz * bx[2], py = dx * by[0] + dy * by[1] + dz * by[2], pz = dx * bz[0] + dy * bz[1] + dz * bz[2];
    const rx = px > 0 ? rp[0] : rn[0], ry = py > 0 ? rp[1] : rn[1], rz = pz > 0 ? rp[2] : rn[2];
    const lx = px / rx, ly = py / ry, lz = pz / rz;
    const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (k0 < 1e-9) return -rmin;
    const k1 = Math.sqrt(lx * lx / (rx * rx) + ly * ly / (ry * ry) + lz * lz / (rz * rz));
    return k0 * (k0 - 1) / k1;
  });
}

/** Basis whose local +Y follows `along` and +Z leans toward `toward` (re-orthogonalised). */
export function basisAlong(along: Vec3, toward: Vec3): Basis {
  const y = normalize(along), x = normalize(cross(y, toward)), z = cross(x, y);
  return [x, y, z];
}
