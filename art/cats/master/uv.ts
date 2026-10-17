/**
 * UV0 body atlas: seams along chart and surface borders plus hidden cuts that open cylindrical
 * charts (ventral midline of the torso, medial side of each leg, underside of the tail), least
 * squares conformal maps per island, uniform texel density and shelf packing with gutters.
 */
import { CHARTS, type Chart, type Labels } from './labels.ts';
import { type Mesh, edgeTable, edgeFaceCount, splitSeams, vertexNeighbours, vertexNormals, faceAreas } from './mesh-ops.ts';
import { MeshoptSimplifier } from 'meshoptimizer';
import { log } from './log.ts';

export interface UVResult {
  /** Split mesh: positions, indices and the source vertex of each output vertex. */
  positions: Float64Array; indices: Uint32Array; source: Uint32Array;
  uv: Float32Array; faceChart: Uint8Array; faceSurface: Uint8Array;
  islands: { chart: Chart; faces: number; area3d: number; rect: [number, number, number, number]; flipped: number }[];
  swatch: [number, number, number, number];
  texelsPerMeter: number;
}

/** Atlas size the gutters and texel density are planned for (desktop body map). */
export const ATLAS = 2048;
const GUTTER = 6 / ATLAS;

type Cost = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

/** Hidden cuts: chart → [from-border chart, to-border chart or 'tip', cost of a path along the hidden side]. */
const CUTS: Partial<Record<Chart, { from: Chart; to: Chart | 'tip'; cost: Cost }>> = {
  torso: { from: 'head', to: 'tail', cost: (x, _y, _z, _nx, ny) => 1 + 40 * (1 + ny) + (x / .004) ** 2 },
  foreleg_L: { from: 'torso', to: 'frontpaw_L', cost: (_x, _y, _z, nx, _ny, nz) => 1 + 25 * (1 + nx) + 8 * (1 + nz) },
  foreleg_R: { from: 'torso', to: 'frontpaw_R', cost: (_x, _y, _z, nx, _ny, nz) => 1 + 25 * (1 - nx) + 8 * (1 + nz) },
  hindleg_L: { from: 'torso', to: 'hindpaw_L', cost: (_x, _y, _z, nx, _ny, nz) => 1 + 25 * (1 + nx) + 8 * (1 - nz) },
  hindleg_R: { from: 'torso', to: 'hindpaw_R', cost: (_x, _y, _z, nx, _ny, nz) => 1 + 25 * (1 - nx) + 8 * (1 - nz) },
  head: { from: 'torso', to: 'muzzle', cost: (x, _y, _z, _nx, ny) => 1 + 40 * (1 + ny) + (x / .003) ** 2 },
  tail: { from: 'torso', to: 'tip', cost: (x, _y, _z, _nx, ny, nz) => 1 + 30 * (1 - (-.55 * ny + .83 * nz)) + (x / .003) ** 2 },
};

export function buildAtlas(mesh: Mesh, labels: Labels, swatchTexels = 40): UVResult {
  const n = mesh.positions.length / 3, faces = mesh.indices.length / 3;
  const t = edgeTable(mesh.indices, n);
  const normals = vertexNormals(mesh.positions, mesh.indices);
  const otherFace = (e: number, f: number) => t.faces[t.faceStart[e]!] === f ? t.faces[t.faceStart[e]! + 1]! : t.faces[t.faceStart[e]!]!;
  // --- hidden cuts (Dijkstra inside each chart between two border loops)
  const cutEdge = new Uint8Array(t.a.length);
  const C = (c: string) => CHARTS.indexOf(c as Chart);
  for (const [chartName, cut] of Object.entries(CUTS) as [Chart, NonNullable<typeof CUTS[Chart]>][]) {
    const ci = C(chartName);
    // Vertices of the chart, and of its borders with the two named charts.
    const inChart = new Uint8Array(n), fromV = new Uint8Array(n), toV = new Uint8Array(n);
    for (let f = 0; f < faces; f++) if (labels.chart[f] === ci) for (let i = 0; i < 3; i++) inChart[mesh.indices[f * 3 + i]!] = 1;
    for (let e = 0; e < t.a.length; e++) {
      if (edgeFaceCount(t, e) !== 2) continue;
      const f0 = t.faces[t.faceStart[e]!]!, f1 = t.faces[t.faceStart[e]! + 1]!, c0 = labels.chart[f0]!, c1 = labels.chart[f1]!;
      if (c0 === c1) continue;
      const pair = [c0, c1];
      if (pair.includes(ci) && pair.includes(C(cut.from))) { fromV[t.a[e]!] = 1; fromV[t.b[e]!] = 1; }
      if (cut.to !== 'tip' && pair.includes(ci) && pair.includes(C(cut.to))) { toV[t.a[e]!] = 1; toV[t.b[e]!] = 1; }
    }
    if (cut.to === 'tip') {
      // The tail tip: the chart vertex farthest (geodesically) from the base border.
      const d = dijkstra(n, t, mesh, inChart, fromV, () => 1);
      let best = -1, bd = -1;
      for (let v = 0; v < n; v++) if (inChart[v] && d.dist[v]! < Infinity && d.dist[v]! > bd) { bd = d.dist[v]!; best = v; }
      toV[best] = 1;
    }
    const cost = (a: number, b: number) => {
      const x = (mesh.positions[a * 3]! + mesh.positions[b * 3]!) / 2, y = (mesh.positions[a * 3 + 1]! + mesh.positions[b * 3 + 1]!) / 2, z = (mesh.positions[a * 3 + 2]! + mesh.positions[b * 3 + 2]!) / 2;
      const nx = normals[a * 3]! + normals[b * 3]!, ny = normals[a * 3 + 1]! + normals[b * 3 + 1]!, nz = normals[a * 3 + 2]! + normals[b * 3 + 2]!, l = Math.hypot(nx, ny, nz) || 1;
      return cut.cost(x, y, z, nx / l, ny / l, nz / l);
    };
    // Interior chart vertices only (borders may start/end the path but not run along it).
    const walk = new Uint8Array(n);
    for (let v = 0; v < n; v++) walk[v] = inChart[v]!;
    const d = dijkstra(n, t, mesh, walk, fromV, cost, toV);
    if (d.reached < 0) throw new Error(`UV cut for ${chartName}: no path from ${cut.from} to ${cut.to}`);
    for (let v = d.reached; d.prevEdge[v]! >= 0; v = d.prev[v]!) cutEdge[d.prevEdge[v]!] = 1;
  }
  // --- split along seams
  const split = splitSeams(mesh.indices, n, (_a, _b, e) => {
    if (cutEdge[e]) return true;
    const f0 = t.faces[t.faceStart[e]!]!, f1 = otherFace(e, f0);
    return labels.chart[f0] !== labels.chart[f1] || labels.surface[f0] !== labels.surface[f1];
  });
  const m = split.source.length, indices = split.indices;
  const positions = new Float64Array(m * 3);
  for (let v = 0; v < m; v++) for (let k = 0; k < 3; k++) positions[v * 3 + k] = mesh.positions[split.source[v]! * 3 + k]!;
  // --- islands (connected components of the split mesh)
  const parent = new Int32Array(m); for (let i = 0; i < m; i++) parent[i] = i;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  for (let f = 0; f < faces; f++) { const a = find(indices[f * 3]!), b = find(indices[f * 3 + 1]!), c = find(indices[f * 3 + 2]!); parent[b] = a; parent[find(c)] = find(a); }
  const islandOf = new Map<number, number[]>();
  for (let f = 0; f < faces; f++) { const r = find(indices[f * 3]!); let l = islandOf.get(r); if (!l) islandOf.set(r, l = []); l.push(f); }
  const areas = faceAreas(positions, indices);
  const uv = new Float32Array(m * 2);
  const islands: UVResult['islands'] = [];
  const rects: { w: number; h: number; id: number; verts: number[] }[] = [];
  for (const [, islandFaces] of [...islandOf.entries()].sort((a, b) => a[1][0]! - b[1][0]!)) {
    const verts = [...new Set(islandFaces.flatMap(f => [indices[f * 3]!, indices[f * 3 + 1]!, indices[f * 3 + 2]!]))].sort((a, b) => a - b);
    const local = new Map(verts.map((v, i) => [v, i]));
    const tri = new Uint32Array(islandFaces.length * 3);
    islandFaces.forEach((f, i) => { for (let k = 0; k < 3; k++) tri[i * 3 + k] = local.get(indices[f * 3 + k]!)!; });
    const pos = new Float64Array(verts.length * 3);
    verts.forEach((v, i) => { for (let k = 0; k < 3; k++) pos[i * 3 + k] = positions[v * 3 + k]!; });
    const map = parameterize(pos, tri);
    let area3d = 0, area2d = 0, flipped = 0;
    islandFaces.forEach((f, i) => {
      area3d += areas[f]!;
      const a = tri[i * 3]!, b = tri[i * 3 + 1]!, c = tri[i * 3 + 2]!;
      const s = ((map[b * 2]! - map[a * 2]!) * (map[c * 2 + 1]! - map[a * 2 + 1]!) - (map[b * 2 + 1]! - map[a * 2 + 1]!) * (map[c * 2]! - map[a * 2]!)) / 2;
      area2d += s; if (s <= 0) flipped++;
    });
    // Uniform texel density: scale each island so its UV area equals its surface area.
    const scale = Math.sqrt(area3d / Math.abs(area2d));
    const sign = area2d < 0 ? -1 : 1;
    if (sign < 0) { flipped = islandFaces.length - flipped; }
    // Rotate to the minimum-area bounding box.
    const pts = verts.map((_, i) => [map[i * 2]! * scale, map[i * 2 + 1]! * scale * sign] as [number, number]);
    const hull = convexHull(pts);
    let bestAngle = 0, bestArea = Infinity;
    for (let k = 0; k < 90; k++) {
      const ang = k * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of hull) { const u = x * c - y * s, v = x * s + y * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
      // Prefer landscape islands for shelf packing.
      const area = (x1 - x0) * (y1 - y0) * (x1 - x0 >= y1 - y0 ? 1 : 1.0001);
      if (area < bestArea) { bestArea = area; bestAngle = ang; }
    }
    const c = Math.cos(bestAngle), s = Math.sin(bestAngle);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const rotated = pts.map(([x, y]) => { const u = x * c - y * s, v = x * s + y * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); return [u, v]; });
    let w = x1 - x0, h = y1 - y0;
    const transpose = h > w;
    verts.forEach((v, i) => {
      const u = rotated[i]![0]! - x0, vv = rotated[i]![1]! - y0;
      uv[v * 2] = transpose ? vv : u; uv[v * 2 + 1] = transpose ? u : vv;
    });
    if (transpose) [w, h] = [h, w];
    const chart = CHARTS[labels.chart[islandFaces[0]!]!]!;
    islands.push({ chart, faces: islandFaces.length, area3d, rect: [0, 0, w, h], flipped });
    rects.push({ w, h, id: islands.length - 1, verts });
  }
  // --- pack (shelves, tallest first) into a square, then normalise to [0, 1]
  const totalArea = rects.reduce((sum, r) => sum + r.w * r.h, 0);
  const swatchId = rects.length;
  let side = Math.sqrt(totalArea) * 1.05, placed: { x: number; y: number }[] = [];
  const swatchSize = () => swatchTexels / ATLAS * side;
  for (let attempt = 0; attempt < 200; attempt++) {
    const g = GUTTER * side;
    const items = [...rects.map(r => ({ w: r.w, h: r.h, id: r.id })), { w: swatchSize(), h: swatchSize(), id: swatchId }]
      .sort((a, b) => b.h - a.h || b.w - a.w || a.id - b.id);
    placed = []; let x = g, y = g, shelf = 0, ok = true;
    for (const it of items) {
      if (x + it.w + g > side) { x = g; y += shelf + g; shelf = 0; }
      if (y + it.h + g > side || it.w + 2 * g > side) { ok = false; break; }
      placed[it.id] = { x, y }; x += it.w + g; shelf = Math.max(shelf, it.h);
    }
    if (ok) break;
    side *= 1.02;
  }
  for (const r of rects) {
    const at = placed[r.id]!;
    for (const v of r.verts) { uv[v * 2] = (uv[v * 2]! + at.x) / side; uv[v * 2 + 1] = (uv[v * 2 + 1]! + at.y) / side; }
    islands[r.id]!.rect = [at.x / side, at.y / side, (at.x + r.w) / side, (at.y + r.h) / side];
  }
  const sw = placed[swatchId]!, ss = swatchSize();
  const swatch: [number, number, number, number] = [sw.x / side, sw.y / side, (sw.x + ss) / side, (sw.y + ss) / side];
  const texelsPerMeter = ATLAS / side;
  log(`UV atlas: ${islands.length} islands, ${(totalArea / (side * side) * 100).toFixed(1)}% used, ${texelsPerMeter.toFixed(0)} texels/m at ${ATLAS}², flipped ${islands.reduce((s2, i) => s2 + i.flipped, 0)}`);
  const faceChart = labels.chart, faceSurface = labels.surface;
  return { positions, indices, source: split.source, uv, faceChart, faceSurface, islands, swatch, texelsPerMeter };
}

function dijkstra(n: number, t: ReturnType<typeof edgeTable>, mesh: Mesh, walk: Uint8Array, sources: Uint8Array, cost: (a: number, b: number) => number, targets?: Uint8Array) {
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), prevEdge = new Int32Array(n).fill(-1);
  // Vertex → incident edges.
  const start = new Uint32Array(n + 1);
  for (let e = 0; e < t.a.length; e++) { start[t.a[e]! + 1]!++; start[t.b[e]! + 1]!++; }
  for (let i = 0; i < n; i++) start[i + 1]! += start[i]!;
  const fill = start.slice(0, n), list = new Uint32Array(t.a.length * 2);
  for (let e = 0; e < t.a.length; e++) { list[fill[t.a[e]!]!++] = e; list[fill[t.b[e]!]!++] = e; }
  const heap = new Heap();
  for (let v = 0; v < n; v++) if (sources[v] && walk[v]) { dist[v] = 0; heap.push(v, 0); }
  let reached = -1;
  while (heap.size) {
    const [v, d] = heap.pop();
    if (d > dist[v]!) continue;
    if (targets && targets[v] && !sources[v]) { reached = v; break; }
    for (let k = start[v]!; k < start[v + 1]!; k++) {
      const e = list[k]!, u = t.a[e] === v ? t.b[e]! : t.a[e]!;
      if (!walk[u]) continue;
      // Do not run along the source border itself.
      if (sources[u] && sources[v]) continue;
      const len = Math.hypot(mesh.positions[u * 3]! - mesh.positions[v * 3]!, mesh.positions[u * 3 + 1]! - mesh.positions[v * 3 + 1]!, mesh.positions[u * 3 + 2]! - mesh.positions[v * 3 + 2]!);
      const nd = d + len * cost(v, u);
      if (nd < dist[u]!) { dist[u] = nd; prev[u] = v; prevEdge[u] = e; heap.push(u, nd); }
    }
  }
  return { dist, prev, prevEdge, reached };
}

class Heap {
  private keys: number[] = []; private vals: number[] = [];
  get size() { return this.keys.length; }
  push(v: number, k: number) {
    const ks = this.keys, vs = this.vals; let i = ks.length; ks.push(k); vs.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (ks[p]! <= k) break; ks[i] = ks[p]!; vs[i] = vs[p]!; i = p; }
    ks[i] = k; vs[i] = v;
  }
  pop(): [number, number] {
    const ks = this.keys, vs = this.vals, topV = vs[0]!, topK = ks[0]!;
    const lastK = ks.pop()!, lastV = vs.pop()!;
    if (ks.length) {
      let i = 0; const len = ks.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= len) break;
        if (c + 1 < len && ks[c + 1]! < ks[c]!) c++;
        if (ks[c]! >= lastK) break;
        ks[i] = ks[c]!; vs[i] = vs[c]!; i = c;
      }
      ks[i] = lastK; vs[i] = lastV;
    }
    return [topV, topK];
  }
}

function convexHull(points: [number, number][]) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Least squares conformal map of a disk-like island (Lévy et al. 2002) with two pinned boundary
 * vertices, solved by Jacobi-preconditioned conjugate gradients from a planar projection.
 */
export function lscm(pos: Float64Array, tri: Uint32Array, init?: Float64Array, tolerance = 1e-12): Float64Array {
  const n = pos.length / 3, nt = tri.length / 3;
  const nb = vertexNeighbours(tri, n);
  // CSR over 2n unknowns (u_j at 2j, v_j at 2j+1); each vertex row block touches itself and its neighbours.
  const rowStart = new Uint32Array(2 * n + 1), colsOf: Uint32Array[] = [];
  for (let j = 0; j < n; j++) {
    const ns = [j, ...nb.list.subarray(nb.start[j]!, nb.start[j + 1]!)].sort((a, b) => a - b);
    colsOf.push(Uint32Array.from(ns));
    rowStart[2 * j + 1] = rowStart[2 * j]! + ns.length * 2;
    rowStart[2 * j + 2] = rowStart[2 * j + 1]! + ns.length * 2;
  }
  const nnz = rowStart[2 * n]!, cols = new Uint32Array(nnz), vals = new Float64Array(nnz);
  for (let j = 0; j < n; j++) {
    const ns = colsOf[j]!;
    for (let r = 0; r < 2; r++) { const base = rowStart[2 * j + r]!; ns.forEach((k, i) => { cols[base + i * 2] = 2 * k; cols[base + i * 2 + 1] = 2 * k + 1; }); }
  }
  const slot = (row: number, col: number) => {
    const j = row >> 1, ns = colsOf[j]!, k = col >> 1;
    let lo = 0, hi = ns.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ns[mid]! < k) lo = mid + 1; else hi = mid; }
    return rowStart[row]! + lo * 2 + (col & 1);
  };
  for (let f = 0; f < nt; f++) {
    const ids = [tri[f * 3]!, tri[f * 3 + 1]!, tri[f * 3 + 2]!];
    const P = ids.map(v => [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!]);
    const e1 = P[1]!.map((x, k) => x - P[0]![k]!), e2 = P[2]!.map((x, k) => x - P[0]![k]!);
    const l1 = Math.hypot(e1[0]!, e1[1]!, e1[2]!);
    if (l1 < 1e-12) continue;
    const ex = e1.map(x => x / l1);
    const nrm = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const area2 = Math.hypot(nrm[0]!, nrm[1]!, nrm[2]!);
    if (area2 < 1e-16) continue;
    const ey = [nrm[1]! * ex[2]! - nrm[2]! * ex[1]!, nrm[2]! * ex[0]! - nrm[0]! * ex[2]!, nrm[0]! * ex[1]! - nrm[1]! * ex[0]!].map(x => x / area2);
    const xs = [0, l1, e2[0]! * ex[0]! + e2[1]! * ex[1]! + e2[2]! * ex[2]!], ys = [0, 0, e2[0]! * ey[0]! + e2[1]! * ey[1]! + e2[2]! * ey[2]!];
    const s = 1 / Math.sqrt(area2); // 1/sqrt(2A)
    const a = [(xs[2]! - xs[1]!) * s, (xs[0]! - xs[2]!) * s, (xs[1]! - xs[0]!) * s];
    const b = [(ys[2]! - ys[1]!) * s, (ys[0]! - ys[2]!) * s, (ys[1]! - ys[0]!) * s];
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) {
      const j = ids[p]!, k = ids[q]!;
      const uu = a[p]! * a[q]! + b[p]! * b[q]!, uv = -a[p]! * b[q]! + b[p]! * a[q]!;
      vals[slot(2 * j, 2 * k)]! += uu; vals[slot(2 * j + 1, 2 * k + 1)]! += uu;
      vals[slot(2 * j, 2 * k + 1)]! += uv; vals[slot(2 * j + 1, 2 * k)]! -= uv;
    }
  }
  // Pins: two far-apart boundary vertices.
  const boundary = boundaryVertices(tri, n);
  const far = (from: number) => { let best = from, bd = -1; for (const v of boundary) { const d = Math.hypot(pos[v * 3]! - pos[from * 3]!, pos[v * 3 + 1]! - pos[from * 3 + 1]!, pos[v * 3 + 2]! - pos[from * 3 + 2]!); if (d > bd) { bd = d; best = v; } } return best; };
  const p0 = far(boundary[0] ?? 0), p1 = far(p0);
  const L = Math.hypot(pos[p1 * 3]! - pos[p0 * 3]!, pos[p1 * 3 + 1]! - pos[p0 * 3 + 1]!, pos[p1 * 3 + 2]! - pos[p0 * 3 + 2]!);
  // Initial guess: projection on the best-fit plane, similarity-aligned with the pins.
  const x = init ? alignTo(init.slice(), n, p0, p1, L) : planarGuess(pos, n, p0, p1, L);
  const pinned = new Uint8Array(2 * n); pinned[2 * p0] = pinned[2 * p0 + 1] = pinned[2 * p1] = pinned[2 * p1 + 1] = 1;
  x[2 * p0] = 0; x[2 * p0 + 1] = 0; x[2 * p1] = L; x[2 * p1 + 1] = 0;
  const N = 2 * n, r = new Float64Array(N), z = new Float64Array(N), p = new Float64Array(N), Ap = new Float64Array(N), diag = new Float64Array(N);
  for (let i = 0; i < N; i++) { const s = slot(i, i); diag[i] = vals[s]! || 1; }
  const matvec = (v: Float64Array, out: Float64Array) => {
    for (let i = 0; i < N; i++) { let sum = 0; for (let k = rowStart[i]!; k < rowStart[i + 1]!; k++) sum += vals[k]! * v[cols[k]!]!; out[i] = sum; }
  };
  matvec(x, Ap);
  for (let i = 0; i < N; i++) r[i] = pinned[i] ? 0 : -Ap[i]!;
  let rz = 0, r0 = 0;
  for (let i = 0; i < N; i++) { z[i] = r[i]! / diag[i]!; p[i] = z[i]!; rz += r[i]! * z[i]!; r0 += r[i]! * r[i]!; }
  const tol = r0 * tolerance;
  for (let it = 0; it < 20000 && rz > 0; it++) {
    matvec(p, Ap);
    let pAp = 0; for (let i = 0; i < N; i++) { if (pinned[i]) Ap[i] = 0; pAp += p[i]! * Ap[i]!; }
    if (pAp <= 0) break;
    const alpha = rz / pAp;
    let rr = 0;
    for (let i = 0; i < N; i++) { x[i]! += alpha * p[i]!; r[i]! -= alpha * Ap[i]!; rr += r[i]! * r[i]!; }
    if (rr < tol) break;
    let rzNew = 0; for (let i = 0; i < N; i++) { z[i] = r[i]! / diag[i]!; rzNew += r[i]! * z[i]!; }
    const beta = rzNew / rz; rz = rzNew;
    for (let i = 0; i < N; i++) p[i] = z[i]! + beta * p[i]!;
  }
  return x;
}

function boundaryVertices(tri: Uint32Array, n: number) {
  const t = edgeTable(tri, n), out = new Set<number>();
  for (let e = 0; e < t.a.length; e++) if (edgeFaceCount(t, e) === 1) { out.add(t.a[e]!); out.add(t.b[e]!); }
  return [...out].sort((a, b) => a - b);
}

function planarGuess(pos: Float64Array, n: number, p0: number, p1: number, L: number) {
  let cx = 0, cy = 0, cz = 0;
  for (let v = 0; v < n; v++) { cx += pos[v * 3]!; cy += pos[v * 3 + 1]!; cz += pos[v * 3 + 2]!; }
  cx /= n; cy /= n; cz /= n;
  const cov = [0, 0, 0, 0, 0, 0];
  for (let v = 0; v < n; v++) { const x = pos[v * 3]! - cx, y = pos[v * 3 + 1]! - cy, z = pos[v * 3 + 2]! - cz; cov[0]! += x * x; cov[1]! += x * y; cov[2]! += x * z; cov[3]! += y * y; cov[4]! += y * z; cov[5]! += z * z; }
  // Smallest-variance axis by power iteration on (trace·I − C).
  const tr = cov[0]! + cov[3]! + cov[5]!;
  let nx = 1, ny = 1, nz = 1;
  for (let i = 0; i < 60; i++) {
    const x = (tr - cov[0]!) * nx - cov[1]! * ny - cov[2]! * nz, y = -cov[1]! * nx + (tr - cov[3]!) * ny - cov[4]! * nz, z = -cov[2]! * nx - cov[4]! * ny + (tr - cov[5]!) * nz;
    const l = Math.hypot(x, y, z) || 1; nx = x / l; ny = y / l; nz = z / l;
  }
  const ax = Math.abs(nx) < .9 ? [0, -nz, ny] : [nz, 0, -nx], al = Math.hypot(ax[0]!, ax[1]!, ax[2]!);
  const ux = ax[0]! / al, uy = ax[1]! / al, uz = ax[2]! / al, vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const out = new Float64Array(2 * n);
  for (let v = 0; v < n; v++) { const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!; out[2 * v] = x * ux + y * uy + z * uz; out[2 * v + 1] = x * vx + y * vy + z * vz; }
  return alignTo(out, n, p0, p1, L);
}

/** Similarity transform of a 2D map taking p0 → (0, 0) and p1 → (L, 0). */
function alignTo(out: Float64Array, n: number, p0: number, p1: number, L: number) {
  const ax0 = out[2 * p0]!, ay0 = out[2 * p0 + 1]!, dx = out[2 * p1]! - ax0, dy = out[2 * p1 + 1]! - ay0, d2 = dx * dx + dy * dy || 1;
  const c = (dx * L) / d2, s = (-dy * L) / d2;
  for (let v = 0; v < n; v++) { const x = out[2 * v]! - ax0, y = out[2 * v + 1]! - ay0; out[2 * v] = c * x - s * y; out[2 * v + 1] = s * x + c * y; }
  return out;
}

/**
 * Island parameterisation: LSCM (cascadic on a simplified copy for large islands) followed by
 * as-rigid-as-possible relaxation (Liu et al. 2008), which evens out the area distortion of
 * conformal maps on caps, then local untangling of any folded triangles.
 */
export function parameterize(pos: Float64Array, tri: Uint32Array): Float64Array {
  const n = pos.length / 3, t0 = performance.now();
  let uv: Float64Array;
  if (n > 2500) {
    const coarse = simplifyIsland(pos, tri, 2400);
    if (!coarse) throw new Error('UV: island simplification failed');
    let cmap = lscm(coarse.pos, coarse.tri, undefined, 1e-12);
    cmap = arap(coarse.pos, coarse.tri, cmap, 16);
    untangle(coarse.tri, coarse.pos.length / 3, cmap);
    uv = new Float64Array(2 * n);
    const fixed = new Uint8Array(n);
    coarse.inverse.forEach((v, i) => { uv[2 * v] = cmap[2 * i]!; uv[2 * v + 1] = cmap[2 * i + 1]!; fixed[v] = 1; });
    harmonicFill(tri, n, uv, fixed, 300);
    uv = arap(pos, tri, uv, 3);
  } else {
    uv = lscm(pos, tri, undefined, 1e-12);
    uv = arap(pos, tri, uv, 16);
  }
  let left = untangle(tri, n, uv);
  for (let retry = 0; retry < 4 && left; retry++) { uv = arap(pos, tri, uv, 2); left = untangle(tri, n, uv); }
  log(`  island ${n} vertices: ${((performance.now() - t0) / 1000).toFixed(1)} s, ${left} folded`);
  return uv;
}

function simplifyIsland(pos: Float64Array, tri: Uint32Array, target: number) {
  const p32 = Float32Array.from(pos);
  const [idx] = MeshoptSimplifier.simplify(tri, p32, 3, target * 3, 1, ['LockBorder']);
  if (idx.length < 30) return null;
  const used = new Int32Array(pos.length / 3).fill(-1), inverse: number[] = [];
  for (const v of idx) if (used[v] === -1) { used[v] = inverse.length; inverse.push(v); }
  const cpos = new Float64Array(inverse.length * 3);
  inverse.forEach((v, i) => { for (let k = 0; k < 3; k++) cpos[i * 3 + k] = pos[v * 3 + k]!; });
  return { pos: cpos, tri: Uint32Array.from(idx, v => used[v]!), inverse };
}

function harmonicFill(tri: Uint32Array, n: number, uv: Float64Array, fixed: Uint8Array, iterations: number) {
  const nb = vertexNeighbours(tri, n);
  // Seed free vertices from any fixed neighbour, breadth first.
  const known = fixed.slice(), queue: number[] = [];
  for (let v = 0; v < n; v++) if (known[v]) queue.push(v);
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]!;
    for (let k = nb.start[v]!; k < nb.start[v + 1]!; k++) { const u = nb.list[k]!; if (!known[u]) { known[u] = 1; uv[2 * u] = uv[2 * v]!; uv[2 * u + 1] = uv[2 * v + 1]!; queue.push(u); } }
  }
  for (let it = 0; it < iterations; it++) for (let v = 0; v < n; v++) {
    if (fixed[v]) continue;
    let sx = 0, sy = 0; const c = nb.start[v + 1]! - nb.start[v]!;
    for (let k = nb.start[v]!; k < nb.start[v + 1]!; k++) { const u = nb.list[k]!; sx += uv[2 * u]!; sy += uv[2 * u + 1]!; }
    if (c) { uv[2 * v] = sx / c; uv[2 * v + 1] = sy / c; }
  }
}

/** As-rigid-as-possible parameterisation refinement with clamped cotangent weights. */
export function arap(pos: Float64Array, tri: Uint32Array, uv: Float64Array, iterations: number): Float64Array {
  const n = pos.length / 3, nt = tri.length / 3;
  // Per-triangle isometric local coordinates and cotangent weights of the edge opposite each corner.
  const lx = new Float64Array(nt * 6), cot = new Float64Array(nt * 3);
  for (let f = 0; f < nt; f++) {
    const ids = [tri[f * 3]!, tri[f * 3 + 1]!, tri[f * 3 + 2]!];
    const P = ids.map(v => [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!]);
    const e1 = P[1]!.map((x, k) => x - P[0]![k]!), e2 = P[2]!.map((x, k) => x - P[0]![k]!);
    const l1 = Math.hypot(e1[0]!, e1[1]!, e1[2]!) || 1e-12;
    const ex = e1.map(x => x / l1);
    const x2 = e2[0]! * ex[0]! + e2[1]! * ex[1]! + e2[2]! * ex[2]!;
    const y2 = Math.sqrt(Math.max(e2[0]! ** 2 + e2[1]! ** 2 + e2[2]! ** 2 - x2 * x2, 1e-24));
    lx.set([0, 0, l1, 0, x2, y2], f * 6);
    for (let c = 0; c < 3; c++) {
      const o = c, a = (c + 1) % 3, b = (c + 2) % 3;
      const ax = lx[f * 6 + a * 2]! - lx[f * 6 + o * 2]!, ay = lx[f * 6 + a * 2 + 1]! - lx[f * 6 + o * 2 + 1]!;
      const bx = lx[f * 6 + b * 2]! - lx[f * 6 + o * 2]!, by = lx[f * 6 + b * 2 + 1]! - lx[f * 6 + o * 2 + 1]!;
      const cr = Math.abs(ax * by - ay * bx) || 1e-24;
      cot[f * 3 + c] = Math.max((ax * bx + ay * by) / cr, 1e-3) * .5;
    }
  }
  // Laplacian (CSR over vertices, symmetric) assembled once.
  const nb = vertexNeighbours(tri, n);
  const rowStart = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) rowStart[v + 1] = rowStart[v]! + (nb.start[v + 1]! - nb.start[v]!) + 1;
  const cols = new Uint32Array(rowStart[n]!), vals = new Float64Array(rowStart[n]!);
  for (let v = 0; v < n; v++) {
    const ns = [v, ...nb.list.subarray(nb.start[v]!, nb.start[v + 1]!)].sort((a, b) => a - b);
    ns.forEach((u, i) => { cols[rowStart[v]! + i] = u; });
  }
  const slot = (r: number, c: number) => { let lo = rowStart[r]!, hi = rowStart[r + 1]! - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cols[m]! < c) lo = m + 1; else hi = m; } return lo; };
  for (let f = 0; f < nt; f++) for (let c = 0; c < 3; c++) {
    const i = tri[f * 3 + (c + 1) % 3]!, j = tri[f * 3 + (c + 2) % 3]!, w = cot[f * 3 + c]!;
    vals[slot(i, i)]! += w; vals[slot(j, j)]! += w; vals[slot(i, j)]! -= w; vals[slot(j, i)]! -= w;
  }
  const pin = 0;
  const diag = new Float64Array(n); for (let v = 0; v < n; v++) diag[v] = vals[slot(v, v)]! || 1;
  const rot = new Float64Array(nt * 4);
  const bx = new Float64Array(n), by = new Float64Array(n);
  const solve = (b: Float64Array, x: Float64Array) => {
    // CG on the Laplacian with vertex `pin` fixed.
    const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
    const mv = (v: Float64Array, out: Float64Array) => { for (let i = 0; i < n; i++) { let s2 = 0; for (let k = rowStart[i]!; k < rowStart[i + 1]!; k++) s2 += vals[k]! * v[cols[k]!]!; out[i] = s2; } };
    mv(x, Ap);
    let rz = 0, b2 = 0;
    for (let i = 0; i < n; i++) { r[i] = i === pin ? 0 : b[i]! - Ap[i]!; z[i] = r[i]! / diag[i]!; p[i] = z[i]!; rz += r[i]! * z[i]!; b2 += b[i]! * b[i]!; }
    const tol = Math.max(b2, 1e-30) * 1e-12;
    for (let it = 0; it < 2000 && rz > 0; it++) {
      mv(p, Ap); Ap[pin] = 0;
      let pAp = 0; for (let i = 0; i < n; i++) pAp += p[i]! * Ap[i]!;
      if (pAp <= 0) break;
      const a = rz / pAp; let rr = 0;
      for (let i = 0; i < n; i++) { x[i]! += a * p[i]!; r[i]! -= a * Ap[i]!; rr += r[i]! * r[i]!; }
      if (rr < tol) break;
      let rzn = 0; for (let i = 0; i < n; i++) { z[i] = r[i]! / diag[i]!; rzn += r[i]! * z[i]!; }
      const beta = rzn / rz; rz = rzn;
      for (let i = 0; i < n; i++) p[i] = z[i]! + beta * p[i]!;
    }
  };
  // Start from the LSCM map rescaled to the surface area.
  let a3 = 0, a2 = 0;
  for (let f = 0; f < nt; f++) {
    a3 += lx[f * 6 + 2]! * lx[f * 6 + 5]! / 2;
    const i = tri[f * 3]!, j = tri[f * 3 + 1]!, k = tri[f * 3 + 2]!;
    a2 += ((uv[2 * j]! - uv[2 * i]!) * (uv[2 * k + 1]! - uv[2 * i + 1]!) - (uv[2 * j + 1]! - uv[2 * i + 1]!) * (uv[2 * k]! - uv[2 * i]!)) / 2;
  }
  const sc = Math.sqrt(a3 / Math.abs(a2)) * (a2 < 0 ? -1 : 1);
  const ux = new Float64Array(n), uy = new Float64Array(n);
  for (let v = 0; v < n; v++) { ux[v] = uv[2 * v]! * Math.abs(sc); uy[v] = uv[2 * v + 1]! * sc; }
  for (let it = 0; it < iterations; it++) {
    // Local step: closest rotation to each triangle's Jacobian.
    for (let f = 0; f < nt; f++) {
      let s11 = 0, s12 = 0, s21 = 0, s22 = 0;
      for (let c = 0; c < 3; c++) {
        const ia = (c + 1) % 3, ib = (c + 2) % 3, i = tri[f * 3 + ia]!, j = tri[f * 3 + ib]!, w = cot[f * 3 + c]!;
        const du = ux[i]! - ux[j]!, dv = uy[i]! - uy[j]!, dx = lx[f * 6 + ia * 2]! - lx[f * 6 + ib * 2]!, dy = lx[f * 6 + ia * 2 + 1]! - lx[f * 6 + ib * 2 + 1]!;
        s11 += w * du * dx; s12 += w * du * dy; s21 += w * dv * dx; s22 += w * dv * dy;
      }
      // Rotation from the 2x2 matrix S (polar decomposition, proper rotations only).
      const a = s11 + s22, b = s21 - s12, l = Math.hypot(a, b) || 1;
      const cs = a / l, sn = b / l;
      rot.set([cs, -sn, sn, cs], f * 4);
    }
    bx.fill(0); by.fill(0);
    for (let f = 0; f < nt; f++) for (let c = 0; c < 3; c++) {
      const ia = (c + 1) % 3, ib = (c + 2) % 3, i = tri[f * 3 + ia]!, j = tri[f * 3 + ib]!, w = cot[f * 3 + c]!;
      const dx = lx[f * 6 + ia * 2]! - lx[f * 6 + ib * 2]!, dy = lx[f * 6 + ia * 2 + 1]! - lx[f * 6 + ib * 2 + 1]!;
      const rx = rot[f * 4]! * dx + rot[f * 4 + 1]! * dy, ry = rot[f * 4 + 2]! * dx + rot[f * 4 + 3]! * dy;
      bx[i]! += w * rx; by[i]! += w * ry; bx[j]! -= w * rx; by[j]! -= w * ry;
    }
    solve(bx, ux); solve(by, uy);
  }
  const out = new Float64Array(2 * n);
  for (let v = 0; v < n; v++) { out[2 * v] = ux[v]!; out[2 * v + 1] = uy[v]!; }
  return out;
}

/**
 * Fix folded triangles: each vertex of a folded triangle moves to the centroid of the kernel of its
 * one-ring (the intersection of the half-planes that keep every incident triangle positive),
 * growing the region when a kernel is empty. Returns the number of folds left.
 */
export function untangle(tri: Uint32Array, n: number, uv: Float64Array) {
  const nt = tri.length / 3;
  const area = (f: number) => {
    const i = tri[f * 3]!, j = tri[f * 3 + 1]!, k = tri[f * 3 + 2]!;
    return (uv[2 * j]! - uv[2 * i]!) * (uv[2 * k + 1]! - uv[2 * i + 1]!) - (uv[2 * j + 1]! - uv[2 * i + 1]!) * (uv[2 * k]! - uv[2 * i]!);
  };
  let total = 0; for (let f = 0; f < nt; f++) total += area(f);
  const sign = total < 0 ? -1 : 1;
  const vf: number[][] = Array.from({ length: n }, () => []);
  for (let f = 0; f < nt; f++) for (let c = 0; c < 3; c++) vf[tri[f * 3 + c]!]!.push(f);
  const nb = vertexNeighbours(tri, n);
  let meanEdge = 0;
  for (let f = 0; f < nt; f++) { const i = tri[f * 3]!, j = tri[f * 3 + 1]!; meanEdge += Math.hypot(uv[2 * j]! - uv[2 * i]!, uv[2 * j + 1]! - uv[2 * i + 1]!); }
  meanEdge /= Math.max(nt, 1);
  const eps = meanEdge * meanEdge * 1e-4;
  const relocate = (v: number) => {
    // Bounding box around the one-ring, then clip by each incident triangle's opposite edge.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = nb.start[v]!; k < nb.start[v + 1]!; k++) { const u = nb.list[k]!; x0 = Math.min(x0, uv[2 * u]!); x1 = Math.max(x1, uv[2 * u]!); y0 = Math.min(y0, uv[2 * u + 1]!); y1 = Math.max(y1, uv[2 * u + 1]!); }
    const pad = meanEdge;
    let poly: [number, number][] = [[x0 - pad, y0 - pad], [x1 + pad, y0 - pad], [x1 + pad, y1 + pad], [x0 - pad, y1 + pad]];
    for (const f of vf[v]!) {
      const c = tri[f * 3] === v ? 0 : tri[f * 3 + 1] === v ? 1 : 2;
      const a = tri[f * 3 + (c + 1) % 3]!, b = tri[f * 3 + (c + 2) % 3]!;
      const ax = uv[2 * a]!, ay = uv[2 * a + 1]!, ex = uv[2 * b]! - ax, ey = uv[2 * b + 1]! - ay;
      const side = (p: [number, number]) => sign * (ex * (p[1] - ay) - ey * (p[0] - ax)) - eps;
      const out: [number, number][] = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!, q = poly[(i + 1) % poly.length]!, sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      poly = out;
      if (poly.length < 3) return false;
    }
    let cx = 0, cy = 0, A = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!, q = poly[(i + 1) % poly.length]!, cr = p[0] * q[1] - q[0] * p[1];
      A += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr;
    }
    if (Math.abs(A) < 1e-30) return false;
    uv[2 * v] = cx / (3 * A); uv[2 * v + 1] = cy / (3 * A);
    return true;
  };
  let region = new Set<number>();
  const laplace = (v: number) => {
    let sx = 0, sy = 0; const c = nb.start[v + 1]! - nb.start[v]!;
    for (let k = nb.start[v]!; k < nb.start[v + 1]!; k++) { const u = nb.list[k]!; sx += uv[2 * u]!; sy += uv[2 * u + 1]!; }
    if (c) { uv[2 * v] = sx / c; uv[2 * v + 1] = sy / c; }
  };
  const boundary = new Set(boundaryVertices(tri, n));
  for (let round = 0; round < 200; round++) {
    const bad = new Set<number>();
    for (let f = 0; f < nt; f++) if (area(f) * sign <= eps) for (let c = 0; c < 3; c++) bad.add(tri[f * 3 + c]!);
    if (!bad.size) return 0;
    for (const v of bad) region.add(v);
    if (round % 8 === 7) { const grown = new Set(region); for (const v of region) for (let k = nb.start[v]!; k < nb.start[v + 1]!; k++) grown.add(nb.list[k]!); region = grown; }
    for (const v of [...region].sort((a, b) => a - b)) if (!relocate(v) && (!boundary.has(v) || round > 100)) laplace(v);
  }
  let left = 0; for (let f = 0; f < nt; f++) if (area(f) * sign <= 0) left++;
  return left;
}
