/**
 * Narrow-band surface nets on a sparse block grid.
 *
 * Blocks of 8×8×8 cells are found by hierarchical pruning (a block whose centre is farther from the
 * surface than its half diagonal cannot contain it). Every grid corner is evaluated exactly once,
 * with the field compiled for the block that owns it, so neighbouring blocks always agree on signs
 * and the extracted surface is closed and consistently oriented. Blocks that pruning missed are
 * recovered lazily when a quad needs one of their cells (the surface is flood-filled from the
 * blocks found). Vertices are then projected onto the exact iso-surface with Newton steps.
 */
import type { Box, Field, Shape, Vec3 } from './sdf.ts';

export interface RawMesh { positions: Float64Array; indices: Uint32Array; fields: Field[]; vertexBlock: Int32Array }

const B = 8, C = B + 1, CORNERS = C * C * C;
const LIPSCHITZ = 1.7;
const FAR: Field = () => 1;

export function meshShape(shape: Shape, h: number, domain: Box = shape.box): RawMesh {
  const origin: Vec3 = [Math.floor(domain.min[0] / h) * h - 2 * h, Math.floor(domain.min[1] / h) * h - 2 * h, Math.floor(domain.min[2] / h) * h - 2 * h];
  const cells = [0, 1, 2].map(i => Math.ceil((domain.max[i]! + 2 * h - origin[i]!) / h)) as Vec3;
  const blocks = cells.map(n => Math.ceil(n / B) + 1) as Vec3;
  const keyOf = (bi: number, bj: number, bk: number) => bi + blocks[0] * (bj + blocks[1] * bk);
  const threshold = B * h * Math.sqrt(3) * LIPSCHITZ + 3 * h;

  const blockBox = (bi: number, bj: number, bk: number, size: number): Box => {
    const ext = size * B * h, min: Vec3 = [origin[0] + bi * B * h, origin[1] + bj * B * h, origin[2] + bk * B * h];
    return { min, max: [min[0] + ext, min[1] + ext, min[2] + ext] };
  };
  const compiled = new Map<number, Field>();
  const fieldOf = (bi: number, bj: number, bk: number) => {
    const key = keyOf(bi, bj, bk);
    let f = compiled.get(key);
    if (!f) { f = shape.compile(blockBox(bi, bj, bk, 1), threshold) ?? FAR; compiled.set(key, f); }
    return f;
  };

  type Block = { bi: number; bj: number; bk: number; values: Float32Array; verts: Int32Array; field: Field };
  const found = new Map<number, Block>();
  const order: Block[] = [];
  /** Evaluate one finest block; keeps it when its corners straddle the surface (or when forced). */
  const evaluate = (bi: number, bj: number, bk: number, force = false): Block | null => {
    const key = keyOf(bi, bj, bk), existing = found.get(key);
    if (existing) return existing;
    if (bi < 0 || bj < 0 || bk < 0 || bi >= blocks[0] || bj >= blocks[1] || bk >= blocks[2]) return null;
    const field = fieldOf(bi, bj, bk);
    if (field === FAR && !force) return null;
    const values = new Float32Array(CORNERS);
    let neg = false, pos = false;
    // Each corner is evaluated by the field of the block that owns it (its lower-corner block).
    const owners: Field[] = [];
    for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) owners.push(fieldOf(bi + di, bj + dj, bk + dk));
    for (let k = 0; k < C; k++) for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) {
      const f = owners[(i === B ? 1 : 0) + (j === B ? 2 : 0) + (k === B ? 4 : 0)]!;
      const v = f(origin[0] + (bi * B + i) * h, origin[1] + (bj * B + j) * h, origin[2] + (bk * B + k) * h);
      values[i + C * (j + C * k)] = v === 0 ? 1e-9 : v;
      if (v < 0) neg = true; else pos = true;
    }
    if (!force && (!neg || !pos)) return null;
    const block: Block = { bi, bj, bk, values, verts: new Int32Array(B * B * B).fill(-1), field: field === FAR ? shape.eval : field };
    found.set(key, block); order.push(block);
    return block;
  };
  const visit = (bi: number, bj: number, bk: number, size: number) => {
    if (bi >= blocks[0] || bj >= blocks[1] || bk >= blocks[2]) return;
    const box = blockBox(bi, bj, bk, size), ext = size * B * h, half = ext * .5 * Math.sqrt(3);
    const field = shape.compile(box, half * LIPSCHITZ + 3 * h);
    if (!field) return;
    const d = field(box.min[0] + ext / 2, box.min[1] + ext / 2, box.min[2] + ext / 2);
    if (Math.abs(d) > half * LIPSCHITZ + h) return;
    if (size > 1) {
      const s = size / 2;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) visit(bi + dx * s, bj + dy * s, bk + dz * s, s);
      return;
    }
    evaluate(bi, bj, bk);
  };
  const top = 16;
  for (let bk = 0; bk < blocks[2]; bk += top) for (let bj = 0; bj < blocks[1]; bj += top) for (let bi = 0; bi < blocks[0]; bi += top) visit(bi, bj, bk, top);

  // Vertices: mass point of the sign-changing cell edges.
  const positions: number[] = [], vertexBlock: number[] = [], fields: Field[] = [];
  const EDGES: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  let lazy = 0;
  const withVertices = new Set<Block>();
  const addVertices = (block: Block) => {
    withVertices.add(block);
    const blockIndex = fields.length;
    fields.push(block.field);
    const I0 = block.bi * B, J0 = block.bj * B, K0 = block.bk * B;
    for (let k = 0; k < B; k++) for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const v = block.values[(i + (c & 1)) + C * ((j + ((c >> 1) & 1)) + C * (k + ((c >> 2) & 1)))]!;
        cv[c] = v; if (v < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of EDGES) {
        const va = cv[a]!, vb = cv[b]!;
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += (a & 1) + t * ((b & 1) - (a & 1)); sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1)); sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1)); n++;
      }
      block.verts[i + B * (j + B * k)] = positions.length / 3;
      positions.push(origin[0] + (I0 + i + sx / n) * h, origin[1] + (J0 + j + sy / n) * h, origin[2] + (K0 + k + sz / n) * h);
      vertexBlock.push(blockIndex);
    }
  };
  const vertexAt = (I: number, J: number, K: number) => {
    const bi = Math.floor(I / B), bj = Math.floor(J / B), bk = Math.floor(K / B);
    let block = found.get(keyOf(bi, bj, bk));
    if (!block) { block = evaluate(bi, bj, bk, true) ?? undefined; if (!block) return -1; lazy++; }
    if (!withVertices.has(block)) addVertices(block);
    return block.verts[(I - block.bi * B) + B * ((J - block.bj * B) + B * (K - block.bk * B))]!;
  };
  const indices: number[] = [];
  let missing = 0;
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) { missing++; return; }
    const pa = a * 3, pb = b * 3, pc = c * 3, pd = d * 3;
    const ac = (positions[pa]! - positions[pc]!) ** 2 + (positions[pa + 1]! - positions[pc + 1]!) ** 2 + (positions[pa + 2]! - positions[pc + 2]!) ** 2;
    const bd = (positions[pb]! - positions[pd]!) ** 2 + (positions[pb + 1]! - positions[pd + 1]!) ** 2 + (positions[pb + 2]! - positions[pd + 2]!) ** 2;
    if (ac <= bd) indices.push(a, b, c, a, c, d); else indices.push(a, b, d, b, c, d);
  };
  for (let b = 0; b < order.length; b++) {
    const block = order[b]!;
    if (!withVertices.has(block)) addVertices(block);
    const I0 = block.bi * B, J0 = block.bj * B, K0 = block.bk * B;
    for (let k = 0; k < B; k++) for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const v0 = block.values[i + C * (j + C * k)]!;
      const I = I0 + i, J = J0 + j, K = K0 + k;
      const vx = block.values[(i + 1) + C * (j + C * k)]!;
      if ((v0 < 0) !== (vx < 0)) {
        const c00 = vertexAt(I, J - 1, K - 1), c10 = vertexAt(I, J, K - 1), c11 = vertexAt(I, J, K), c01 = vertexAt(I, J - 1, K);
        if (v0 < 0) quad(c00, c10, c11, c01); else quad(c01, c11, c10, c00);
      }
      const vy = block.values[i + C * ((j + 1) + C * k)]!;
      if ((v0 < 0) !== (vy < 0)) {
        const c00 = vertexAt(I - 1, J, K - 1), c10 = vertexAt(I - 1, J, K), c11 = vertexAt(I, J, K), c01 = vertexAt(I, J, K - 1);
        if (v0 < 0) quad(c00, c10, c11, c01); else quad(c01, c11, c10, c00);
      }
      const vz = block.values[i + C * (j + C * (k + 1))]!;
      if ((v0 < 0) !== (vz < 0)) {
        const c00 = vertexAt(I - 1, J - 1, K), c10 = vertexAt(I, J - 1, K), c11 = vertexAt(I, J, K), c01 = vertexAt(I - 1, J, K);
        if (v0 < 0) quad(c00, c10, c11, c01); else quad(c01, c11, c10, c00);
      }
    }
  }
  if (missing) throw new Error(`Surface nets: ${missing} quads could not find their cells (domain too small?)`);
  if (lazy && process.env.CAT_VERBOSE) console.log(`surface nets: ${lazy} blocks recovered after pruning`);
  return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices), fields, vertexBlock: Int32Array.from(vertexBlock) };
}

/** Newton projection of vertices onto the zero set of their block field. */
export function project(positions: Float64Array, fieldOf: (v: number) => Field, iterations = 3, maxStep = Infinity) {
  const e = 1e-5;
  for (let v = 0; v < positions.length / 3; v++) {
    const f = fieldOf(v);
    let x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    const x0 = x, y0 = y, z0 = z;
    for (let it = 0; it < iterations; it++) {
      const d = f(x, y, z);
      if (Math.abs(d) < 1e-8) break;
      const gx = (f(x + e, y, z) - f(x - e, y, z)) / (2 * e), gy = (f(x, y + e, z) - f(x, y - e, z)) / (2 * e), gz = (f(x, y, z + e) - f(x, y, z - e)) / (2 * e);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 < 1e-12) break;
      x -= d * gx / g2; y -= d * gy / g2; z -= d * gz / g2;
    }
    const moved = Math.hypot(x - x0, y - y0, z - z0);
    if (moved > maxStep) { const s = maxStep / moved; x = x0 + (x - x0) * s; y = y0 + (y - y0) * s; z = z0 + (z - z0) * s; }
    positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
  }
}
