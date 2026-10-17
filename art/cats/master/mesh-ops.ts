/**
 * Typed-array triangle mesh operations used by the master cat pipeline: edge tables, adjacency,
 * boundary loops, components, non-manifold repair, level-set cutting, seams and normals.
 * Everything is deterministic (sorted keys, no hash iteration order dependence).
 */

export interface Mesh { positions: Float64Array; indices: Uint32Array }

/** Undirected edges as sorted unique (a < b) pairs with the faces that use each one. */
export interface EdgeTable {
  a: Uint32Array; b: Uint32Array;
  /** CSR of faces per edge. */
  faceStart: Uint32Array; faces: Uint32Array;
  /** Edge index of each face corner edge (corner i → edge (i, i+1)). */
  faceEdges: Uint32Array;
}

export function edgeTable(indices: Uint32Array, vertexCount: number): EdgeTable {
  const n = indices.length;
  // Bucket every corner edge by its lower vertex, then sort each (small) bucket by the upper vertex.
  const start = new Uint32Array(vertexCount + 1);
  for (let c = 0; c < n; c++) {
    const u = indices[c]!, v = indices[c - (c % 3) + (c % 3 + 1) % 3]!;
    start[(u < v ? u : v) + 1]!++;
  }
  for (let i = 0; i < vertexCount; i++) start[i + 1]! += start[i]!;
  const fill = start.slice(0, vertexCount), hiOf = new Uint32Array(n), cornerOf = new Uint32Array(n);
  for (let c = 0; c < n; c++) {
    const u = indices[c]!, v = indices[c - (c % 3) + (c % 3 + 1) % 3]!;
    const lo = u < v ? u : v, hi = u < v ? v : u, slot = fill[lo]!++;
    hiOf[slot] = hi; cornerOf[slot] = c;
  }
  const a = new Uint32Array(n), b = new Uint32Array(n), faceStart = new Uint32Array(n + 1), faces = new Uint32Array(n), faceEdges = new Uint32Array(n);
  let edges = 0, fcount = 0;
  for (let lo = 0; lo < vertexCount; lo++) {
    const s = start[lo]!, e = start[lo + 1]!;
    // Insertion sort by (hi, corner) keeps the result deterministic.
    for (let i = s + 1; i < e; i++) {
      const h = hiOf[i]!, c = cornerOf[i]!;
      let j = i - 1;
      while (j >= s && (hiOf[j]! > h || (hiOf[j] === h && cornerOf[j]! > c))) { hiOf[j + 1] = hiOf[j]!; cornerOf[j + 1] = cornerOf[j]!; j--; }
      hiOf[j + 1] = h; cornerOf[j + 1] = c;
    }
    for (let i = s; i < e; i++) {
      if (i === s || hiOf[i] !== hiOf[i - 1]) { a[edges] = lo; b[edges] = hiOf[i]!; faceStart[edges] = fcount; edges++; }
      faces[fcount++] = Math.floor(cornerOf[i]! / 3);
      faceEdges[cornerOf[i]!] = edges - 1;
    }
  }
  faceStart[edges] = fcount;
  return { a: a.slice(0, edges), b: b.slice(0, edges), faceStart: faceStart.slice(0, edges + 1), faces, faceEdges };
}

/** Indices 0..n-1 sorted by key (stable for equal keys by index). */
export function sortIndicesByKey(keys: Float64Array): Uint32Array {
  const n = keys.length, order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // Pack key and index into one float sort when possible; fall back to comparator.
  return order.sort((x, y) => keys[x]! - keys[y]! || x - y);
}

export function edgeFaceCount(t: EdgeTable, e: number) { return t.faceStart[e + 1]! - t.faceStart[e]!; }

/** Vertex → incident faces (CSR). */
export function vertexFaces(indices: Uint32Array, vertexCount: number) {
  const count = new Uint32Array(vertexCount + 1);
  for (const v of indices) count[v + 1]!++;
  for (let i = 0; i < vertexCount; i++) count[i + 1]! += count[i]!;
  const fill = count.slice(0, vertexCount), list = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) { const v = indices[i]!; list[fill[v]!++] = Math.floor(i / 3); }
  return { start: count, faces: list };
}

/** Vertex one-ring neighbours (CSR, sorted, unique). */
export function vertexNeighbours(indices: Uint32Array, vertexCount: number) {
  const t = edgeTable(indices, vertexCount);
  const count = new Uint32Array(vertexCount + 1);
  for (let e = 0; e < t.a.length; e++) { count[t.a[e]! + 1]!++; count[t.b[e]! + 1]!++; }
  for (let i = 0; i < vertexCount; i++) count[i + 1]! += count[i]!;
  const fill = count.slice(0, vertexCount), list = new Uint32Array(t.a.length * 2);
  for (let e = 0; e < t.a.length; e++) { const a = t.a[e]!, b = t.b[e]!; list[fill[a]!++] = b; list[fill[b]!++] = a; }
  for (let v = 0; v < vertexCount; v++) list.subarray(count[v]!, count[v + 1]!).sort();
  return { start: count, list };
}

/** Drop unused vertices; returns the compacted mesh and the old → new map (-1 when dropped). */
export function compact(mesh: Mesh): { mesh: Mesh; map: Int32Array; inverse: Uint32Array } {
  const n = mesh.positions.length / 3, map = new Int32Array(n).fill(-1), inverse: number[] = [];
  for (const v of mesh.indices) if (map[v] === -1) { map[v] = -2; }
  let next = 0;
  for (let v = 0; v < n; v++) if (map[v] === -2) { map[v] = next++; inverse.push(v); }
  const positions = new Float64Array(next * 3);
  for (let v = 0; v < n; v++) if (map[v]! >= 0) { const m = map[v]!; positions[m * 3] = mesh.positions[v * 3]!; positions[m * 3 + 1] = mesh.positions[v * 3 + 1]!; positions[m * 3 + 2] = mesh.positions[v * 3 + 2]!; }
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = map[mesh.indices[i]!]!;
  return { mesh: { positions, indices }, map, inverse: Uint32Array.from(inverse) };
}

export function faceNormal(p: Float64Array | Float32Array, a: number, b: number, c: number, out: number[] = [0, 0, 0]) {
  const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
  const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
  out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
  return out;
}

/** Area-weighted vertex normals; `weld` maps each vertex to a representative so seams share normals. */
export function vertexNormals(positions: Float64Array | Float32Array, indices: Uint32Array, weld?: Uint32Array) {
  const n = positions.length / 3, acc = new Float64Array(n * 3), f = [0, 0, 0];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    faceNormal(positions, a, b, c, f);
    for (const v of [a, b, c]) { const r = weld ? weld[v]! : v; acc[r * 3]! += f[0]!; acc[r * 3 + 1]! += f[1]!; acc[r * 3 + 2]! += f[2]!; }
  }
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const r = weld ? weld[v]! : v;
    const x = acc[r * 3]!, y = acc[r * 3 + 1]!, z = acc[r * 3 + 2]!, l = Math.hypot(x, y, z) || 1;
    out[v * 3] = x / l; out[v * 3 + 1] = y / l; out[v * 3 + 2] = z / l;
  }
  return out;
}

/** Map every vertex to the lowest-index vertex at the identical position (for seams). */
export function positionWeld(positions: Float64Array | Float32Array): Uint32Array {
  const n = positions.length / 3, keys = new Float64Array(n);
  // Exact-position grouping through a sort on a lexicographic key.
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((x, y) => positions[x * 3]! - positions[y * 3]! || positions[x * 3 + 1]! - positions[y * 3 + 1]! || positions[x * 3 + 2]! - positions[y * 3 + 2]! || x - y);
  const rep = new Uint32Array(n);
  let head = order[0] ?? 0;
  for (let k = 0; k < n; k++) {
    const v = order[k]!;
    if (k > 0) {
      const u = order[k - 1]!;
      if (positions[u * 3] !== positions[v * 3] || positions[u * 3 + 1] !== positions[v * 3 + 1] || positions[u * 3 + 2] !== positions[v * 3 + 2]) head = v;
    } else head = v;
    rep[v] = head;
  }
  // Representative = smallest index in each group.
  for (let k = 0; k < n; k++) { const v = order[k]!, h = rep[v]!; if (v < h) rep[v] = v; }
  for (let k = 0; k < n; k++) { const v = order[k]!; rep[v] = Math.min(rep[rep[v]!]!, rep[v]!); }
  void keys;
  return rep;
}

export interface Topo { boundaryEdges: number; nonManifoldEdges: number; components: number; loops: number[][]; nonManifoldVertices: number; misoriented: number }

/** Topology summary of an indexed mesh (optionally after welding coincident vertices). */
export function topologyOf(indices: Uint32Array, vertexCount: number, weld?: Uint32Array): Topo {
  const idx = weld ? indices.map(v => weld[v]!) : indices;
  const t = edgeTable(idx, vertexCount);
  let boundaryEdges = 0, nonManifoldEdges = 0, misoriented = 0;
  const next = new Map<number, number>();
  for (let e = 0; e < t.a.length; e++) {
    const c = edgeFaceCount(t, e);
    if (c === 1) {
      boundaryEdges++;
      const f = t.faces[t.faceStart[e]!]!;
      for (let i = 0; i < 3; i++) {
        const u = idx[f * 3 + i]!, v = idx[f * 3 + (i + 1) % 3]!;
        if ((u === t.a[e] && v === t.b[e]) || (u === t.b[e] && v === t.a[e])) next.set(v, u);
      }
    } else if (c > 2) nonManifoldEdges++;
    else {
      const f0 = t.faces[t.faceStart[e]!]!, f1 = t.faces[t.faceStart[e]! + 1]!;
      if (direction(idx, f0, t.a[e]!, t.b[e]!) === direction(idx, f1, t.a[e]!, t.b[e]!)) misoriented++;
    }
  }
  const loops: number[][] = [], used = new Set<number>();
  for (const start of [...next.keys()].sort((x, y) => x - y)) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let v = start;
    while (!used.has(v)) { used.add(v); loop.push(v); const n = next.get(v); if (n === undefined) break; v = n; }
    loops.push(loop);
  }
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  for (let f = 0; f < idx.length; f += 3) { const a = find(idx[f]!), b = find(idx[f + 1]!), c = find(idx[f + 2]!); parent[b] = a; parent[find(c)] = find(a); }
  const roots = new Set<number>();
  for (const v of idx) roots.add(find(v));
  const nonManifoldVertices = splitFanVertices(idx, vertexCount).length;
  return { boundaryEdges, nonManifoldEdges, components: roots.size, loops, nonManifoldVertices, misoriented };
}

/** Vertices whose incident faces do not form a single edge-connected fan. */
export function splitFanVertices(idx: Uint32Array, vertexCount: number): number[] {
  const vf = vertexFaces(idx, vertexCount), out: number[] = [];
  let other = new Int32Array(64), seen = new Uint8Array(32), stack = new Int32Array(32);
  for (let v = 0; v < vertexCount; v++) {
    const s = vf.start[v]!, k = vf.start[v + 1]! - s;
    if (k < 2) continue;
    if (k > seen.length) { other = new Int32Array(k * 2); seen = new Uint8Array(k); stack = new Int32Array(k); }
    for (let i = 0; i < k; i++) {
      const f = vf.faces[s + i]!;
      let m = 0;
      for (let j = 0; j < 3; j++) { const o = idx[f * 3 + j]!; if (o !== v) other[i * 2 + m++] = o; }
      if (m < 2) other[i * 2 + 1] = -1 - i;
      seen[i] = 0;
    }
    let top = 0, count = 1; stack[top++] = 0; seen[0] = 1;
    while (top) {
      const i = stack[--top]!;
      for (let j = 0; j < k; j++) {
        if (seen[j]) continue;
        const a0 = other[i * 2]!, a1 = other[i * 2 + 1]!, b0 = other[j * 2]!, b1 = other[j * 2 + 1]!;
        if (a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1) { seen[j] = 1; stack[top++] = j; count++; }
      }
    }
    if (count !== k) out.push(v);
  }
  return out;
}

function direction(idx: Uint32Array, f: number, a: number, b: number) {
  for (let i = 0; i < 3; i++) { const u = idx[f * 3 + i]!, v = idx[f * 3 + (i + 1) % 3]!; if (u === a && v === b) return 1; if (u === b && v === a) return -1; }
  return 0;
}

/** Keep only the faces of the largest connected component (by face count). */
export function largestComponent(indices: Uint32Array, vertexCount: number): Uint32Array {
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  for (let f = 0; f < indices.length; f += 3) { const a = find(indices[f]!), b = find(indices[f + 1]!), c = find(indices[f + 2]!); parent[b] = a; parent[find(c)] = find(a); }
  const size = new Map<number, number>();
  for (let f = 0; f < indices.length; f += 3) { const r = find(indices[f]!); size.set(r, (size.get(r) ?? 0) + 1); }
  let best = -1, bestSize = -1;
  for (const [r, s] of [...size.entries()].sort((x, y) => x[0] - y[0])) if (s > bestSize) { best = r; bestSize = s; }
  const out: number[] = [];
  for (let f = 0; f < indices.length; f += 3) if (find(indices[f]!) === best) out.push(indices[f]!, indices[f + 1]!, indices[f + 2]!);
  return Uint32Array.from(out);
}

/**
 * Remove faces around non-manifold edges and vertices (and any face with a repeated vertex), then
 * close the resulting small holes with fans around a projected centre. Repeats until the mesh is
 * a closed 2-manifold (holes larger than `maxHole` edges are left open and reported).
 */
export function repairManifold(mesh: Mesh, projectPoint: (p: [number, number, number]) => [number, number, number], maxHole = 400): Mesh {
  let { positions, indices } = mesh;
  for (let pass = 0; pass < 6; pass++) {
    const n = positions.length / 3;
    const t = edgeTable(indices, n);
    const badVertex = new Uint8Array(n);
    let defects = 0, boundary = 0;
    for (let f = 0; f < indices.length / 3; f++) {
      const a = indices[f * 3]!, b = indices[f * 3 + 1]!, c = indices[f * 3 + 2]!;
      if (a === b || b === c || a === c) { badVertex[a] = badVertex[b] = badVertex[c] = 1; defects++; }
    }
    for (let e = 0; e < t.a.length; e++) {
      const c = edgeFaceCount(t, e);
      if (c > 2) { badVertex[t.a[e]!] = 1; badVertex[t.b[e]!] = 1; defects++; }
      if (c === 1) boundary++;
    }
    for (const v of splitFanVertices(indices, n)) { badVertex[v] = 1; defects++; }
    if (process.env.CAT_VERBOSE) console.log(`repair pass ${pass}: ${defects} defects, ${boundary} boundary edges`);
    if (!defects && !boundary) break;
    let keepFace = new Uint8Array(indices.length / 3).fill(1);
    if (defects) {
      // Delete two rings of faces around every defect.
      const vf = vertexFaces(indices, n);
      let region = badVertex;
      for (let ring = 0; ring < 2; ring++) {
        const grown = region.slice();
        for (let v = 0; v < n; v++) if (region[v]) for (let k = vf.start[v]!; k < vf.start[v + 1]!; k++) { const f = vf.faces[k]!; for (let i = 0; i < 3; i++) grown[indices[f * 3 + i]!] = 1; }
        region = grown;
      }
      for (let f = 0; f < keepFace.length; f++) if (region[indices[f * 3]!] || region[indices[f * 3 + 1]!] || region[indices[f * 3 + 2]!]) keepFace[f] = 0;
    }
    let kept = compactFaces(indices, keepFace);
    // Remove pinches until every boundary vertex has exactly two boundary edges and one fan.
    for (let guard = 0; guard < 20; guard++) {
      const te = edgeTable(kept, n), bcount = new Uint8Array(n);
      for (let e = 0; e < te.a.length; e++) {
        const c = edgeFaceCount(te, e);
        if (c === 1) { bcount[te.a[e]!]!++; bcount[te.b[e]!]!++; }
        if (c > 2) { bcount[te.a[e]!] = 9; bcount[te.b[e]!] = 9; }
      }
      for (const v of splitFanVertices(kept, n)) bcount[v] = 9;
      let pinches = 0;
      keepFace = new Uint8Array(kept.length / 3).fill(1);
      for (let f = 0; f < keepFace.length; f++) for (let i = 0; i < 3; i++) { const b = bcount[kept[f * 3 + i]!]!; if (b > 2) { keepFace[f] = 0; pinches++; break; } }
      if (!pinches) break;
      kept = compactFaces(kept, keepFace);
    }
    indices = largestComponent(kept, n);
    const loops = topologyOf(indices, n).loops;
    const pos = Array.from(positions), idx = Array.from(indices);
    const nb = vertexNeighbours(indices, n);
    const linked = (u: number, v: number) => { for (let k = nb.start[u]!; k < nb.start[u + 1]!; k++) if (nb.list[k] === v) return true; return false; };
    if (process.env.CAT_DEBUG_REPAIR) console.log('loops', loops.map(l => l.length), 'simple', loops.map(l => new Set(l).size === l.length));
    for (const loop of loops) if (loop.length <= maxHole) fillHole(loop, pos, idx, projectPoint, linked);
    positions = Float64Array.from(pos); indices = Uint32Array.from(idx);
    if (process.env.CAT_DEBUG_REPAIR) {
      const after = topologyOf(indices, positions.length / 3);
      console.log('after fill', after.boundaryEdges, after.nonManifoldEdges, after.nonManifoldVertices, after.loops.map(l => l.length));
    }
  }
  return compact({ positions, indices }).mesh;
}

function compactFaces(indices: Uint32Array, keep: Uint8Array) {
  let count = 0;
  for (let f = 0; f < keep.length; f++) if (keep[f]) count++;
  const out = new Uint32Array(count * 3);
  let o = 0;
  for (let f = 0; f < keep.length; f++) if (keep[f]) { out[o++] = indices[f * 3]!; out[o++] = indices[f * 3 + 1]!; out[o++] = indices[f * 3 + 2]!; }
  return out;
}

/**
 * Triangulate a boundary loop (given in reverse face-winding order, as topologyOf returns it) by
 * ear clipping in its Newell plane, then refine large triangles with projected centroids.
 */
export function fillHole(loop: number[], pos: number[], idx: number[], projectPoint: (p: [number, number, number]) => [number, number, number],
  linked: (u: number, v: number) => boolean = () => false) {
  const P = (v: number): [number, number, number] => [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0, perimeter = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = P(loop[i]!), b = P(loop[(i + 1) % loop.length]!);
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    cx += a[0]; cy += a[1]; cz += a[2]; perimeter += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  // In-plane axes.
  const ax = Math.abs(nx) < .9 ? [0, -nz, ny] : [nz, 0, -nx], al = Math.hypot(ax[0]!, ax[1]!, ax[2]!);
  const ux = ax[0]! / al, uy = ax[1]! / al, uz = ax[2]! / al, vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const pts = loop.map(v => { const p = P(v); return [p[0] * ux + p[1] * uy + p[2] * uz, p[0] * vx + p[1] * vy + p[2] * vz] as [number, number]; });
  const ring = loop.map((_, i) => i), tris: [number, number, number][] = [];
  const cross2 = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  let guard = 0;
  while (ring.length > 3 && guard++ < 100000) {
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = pts[ring[(i + ring.length - 1) % ring.length]!]!, b = pts[ring[i]!]!, c = pts[ring[(i + 1) % ring.length]!]!;
      // The loop runs opposite to face winding, so with the Newell normal it is counterclockwise;
      // an ear is a convex corner with no other loop vertex inside it.
      const turn = cross2(a, b, c);
      if (turn <= 1e-14) continue;
      if (linked(loop[ring[(i + ring.length - 1) % ring.length]!]!, loop[ring[(i + 1) % ring.length]!]!)) continue;
      let inside = false;
      for (let j = 0; j < ring.length && !inside; j++) {
        if (Math.abs(j - i) <= 1 || (i === 0 && j === ring.length - 1) || (i === ring.length - 1 && j === 0)) continue;
        const p = pts[ring[j]!]!;
        if (cross2(a, b, p) > 0 && cross2(b, c, p) > 0 && cross2(c, a, p) > 0) inside = true;
      }
      if (inside) continue;
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const angle = Math.acos(Math.max(-1, Math.min(1, ((a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1])) / (ab * bc + 1e-30))));
      if (angle < bestScore) { bestScore = angle; best = i; }
    }
    if (best < 0) break;
    const i = best;
    tris.push([ring[(i + ring.length - 1) % ring.length]!, ring[i]!, ring[(i + 1) % ring.length]!]);
    ring.splice(i, 1);
  }
  let centre = -1;
  if (ring.length === 3) tris.push([ring[0]!, ring[1]!, ring[2]!]);
  else if (ring.length >= 3) {
    // Ear clipping got stuck: fan the remaining polygon around a new projected centre vertex.
    let qx = 0, qy = 0, sx = 0, sy = 0, sz = 0;
    for (const r of ring) { qx += pts[r]![0]; qy += pts[r]![1]; const p = P(loop[r]!); sx += p[0]; sy += p[1]; sz += p[2]; }
    centre = pts.length; pts.push([qx / ring.length, qy / ring.length]);
    const lifted = projectPoint([sx / ring.length, sy / ring.length, sz / ring.length]);
    loop.push(pos.length / 3); pos.push(lifted[0], lifted[1], lifted[2]);
    for (let k = 0; k < ring.length; k++) tris.push([ring[k]!, ring[(k + 1) % ring.length]!, centre]);
  }
  // Work on a local patch: 2D coordinates per patch vertex; refine with centroid insertion and
  // Lawson flips (Delaunay in the plane), then lift new vertices onto the surface.
  const verts: number[] = loop.slice(), xy: [number, number][] = pts.slice();
  const loopCount = centre >= 0 ? loop.length - 1 : loop.length;
  let faces = tris.map(t => [t[0], t[1], t[2]] as [number, number, number]);
  const boundaryKey = new Set<string>();
  for (let i = 0; i < loopCount; i++) { const a = i, b = (i + 1) % loopCount; boundaryKey.add(a < b ? `${a},${b}` : `${b},${a}`); }
  const flipAll = () => {
    for (let iter = 0; iter < 200; iter++) {
      const edgeTris = new Map<string, number[]>();
      faces.forEach((f, fi) => { for (let k = 0; k < 3; k++) { const a = f[k]!, b = f[(k + 1) % 3]!; const key = a < b ? `${a},${b}` : `${b},${a}`; const l = edgeTris.get(key); if (l) l.push(fi); else edgeTris.set(key, [fi]); } });
      let flipped = false;
      const dirty = new Set<number>();
      for (const [key, list] of [...edgeTris.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        if (list.length !== 2 || boundaryKey.has(key) || dirty.has(list[0]!) || dirty.has(list[1]!)) continue;
        const [a, b] = key.split(',').map(Number) as [number, number];
        const f0 = faces[list[0]!]!, f1 = faces[list[1]!]!;
        const c = f0.find(x => x !== a && x !== b)!, d = f1.find(x => x !== a && x !== b)!;
        // Delaunay test: sum of angles opposite edge ab.
        const ang = (o: number, p: number, q: number) => { const u = [xy[p]![0] - xy[o]![0], xy[p]![1] - xy[o]![1]], v = [xy[q]![0] - xy[o]![0], xy[q]![1] - xy[o]![1]]; return Math.acos(Math.max(-1, Math.min(1, (u[0]! * v[0]! + u[1]! * v[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!) + 1e-30)))); };
        if (ang(c, a, b) + ang(d, a, b) <= Math.PI + 1e-9) continue;
        // Flip only if the quad is convex (new triangles keep orientation).
        const orient = (p: number, q: number, r: number) => (xy[q]![0] - xy[p]![0]) * (xy[r]![1] - xy[p]![1]) - (xy[q]![1] - xy[p]![1]) * (xy[r]![0] - xy[p]![0]);
        // Keep winding: find the order of f0 that runs a → b → c.
        const i0 = f0.indexOf(a), runsAB = f0[(i0 + 1) % 3] === b;
        const [p, q] = runsAB ? [a, b] : [b, a];
        const t0: [number, number, number] = [c, p, d], t1: [number, number, number] = [d, q, c];
        if (orient(...t0) <= 1e-18 || orient(...t1) <= 1e-18) continue;
        if (c < loopCount && d < loopCount && linked(verts[c]!, verts[d]!)) continue;
        faces[list[0]!] = t0; faces[list[1]!] = t1; flipped = true; dirty.add(list[0]!); dirty.add(list[1]!);
      }
      if (!flipped) break;
    }
  };
  flipAll();
  const target = (perimeter / loopCount) ** 2 * .5;
  for (let round = 0; round < 6; round++) {
    let split = false;
    const next: [number, number, number][] = [];
    for (const f of faces) {
      const [a, b, c] = f;
      const area = Math.abs((xy[b]![0] - xy[a]![0]) * (xy[c]![1] - xy[a]![1]) - (xy[b]![1] - xy[a]![1]) * (xy[c]![0] - xy[a]![0])) / 2;
      if (area < target) { next.push(f); continue; }
      const m = xy.length;
      xy.push([(xy[a]![0] + xy[b]![0] + xy[c]![0]) / 3, (xy[a]![1] + xy[b]![1] + xy[c]![1]) / 3]);
      const pa = P(verts[a]!), pb = P(verts[b]!), pc = P(verts[c]!);
      const lifted = projectPoint([(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3]);
      verts.push(pos.length / 3); pos.push(lifted[0], lifted[1], lifted[2]);
      next.push([a, b, m], [b, c, m], [c, a, m]); split = true;
    }
    faces = next;
    flipAll();
    if (!split) break;
  }
  for (const [a, b, c] of faces) idx.push(verts[a]!, verts[b]!, verts[c]!);
  void cx; void cy; void cz;
}

/**
 * Cut a mesh along the zero level set of a per-vertex scalar and keep the part where it is ≥ 0.
 * Crossing edges get one shared vertex (linear interpolation, optionally projected), so the cut
 * boundary is a clean, crack-free loop.
 */
export function cutLevelSet(mesh: Mesh, phi: Float64Array, place?: (p: [number, number, number], a: number, b: number, t: number) => [number, number, number]): Mesh {
  const { positions, indices } = mesh, n = positions.length / 3;
  const pos = Array.from(positions), out: number[] = [];
  const edgeVertex = new Map<number, number>();
  const s = (v: number) => phi[v]! >= 0;
  const cross = (a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b), key = lo * n + hi;
    let v = edgeVertex.get(key);
    if (v === undefined) {
      const t = phi[lo]! / (phi[lo]! - phi[hi]!);
      let p: [number, number, number] = [0, 1, 2].map(k => positions[lo * 3 + k]! + t * (positions[hi * 3 + k]! - positions[lo * 3 + k]!)) as [number, number, number];
      if (place) p = place(p, lo, hi, t);
      v = pos.length / 3; pos.push(...p); edgeVertex.set(key, v);
    }
    return v;
  };
  for (let f = 0; f < indices.length; f += 3) {
    const tri = [indices[f]!, indices[f + 1]!, indices[f + 2]!];
    const inside = tri.map(s);
    const k = inside.filter(Boolean).length;
    if (k === 3) { out.push(...tri); continue; }
    if (k === 0) continue;
    // Rotate so the lone vertex is first.
    const lone = k === 1 ? inside.indexOf(true) : inside.indexOf(false);
    const a = tri[lone]!, b = tri[(lone + 1) % 3]!, c = tri[(lone + 2) % 3]!;
    const ab = cross(a, b), ac = cross(a, c);
    if (k === 1) out.push(a, ab, ac);
    else out.push(ab, b, c, ab, c, ac);
  }
  return compact({ positions: Float64Array.from(pos), indices: Uint32Array.from(out) }).mesh;
}

/**
 * Split vertices along seam edges: faces on either side of a seam edge get their own copies of the
 * seam vertices. `isSeam(e)` is evaluated on the edge table of the input. Returns the new indices
 * and, for every output vertex, the input vertex it copies.
 */
export function splitSeams(indices: Uint32Array, vertexCount: number, isSeam: (a: number, b: number, e: number) => boolean) {
  const t = edgeTable(indices, vertexCount);
  const seamEdge = new Uint8Array(t.a.length);
  for (let e = 0; e < t.a.length; e++) if (edgeFaceCount(t, e) === 2 && isSeam(t.a[e]!, t.b[e]!, e)) seamEdge[e] = 1;
  const vf = vertexFaces(indices, vertexCount);
  const corner = new Int32Array(indices.length).fill(-1);
  const source: number[] = [];
  for (let v = 0; v < vertexCount; v++) {
    const s = vf.start[v]!, e = vf.start[v + 1]!;
    // Union faces around v that share a non-seam edge incident to v.
    const fs = Array.from(vf.faces.subarray(s, e));
    const parent = new Map<number, number>(fs.map(f => [f, f]));
    const find = (x: number): number => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
    for (const f of fs) for (let i = 0; i < 3; i++) {
      const u = indices[f * 3 + i]!, w = indices[f * 3 + (i + 1) % 3]!;
      if (u !== v && w !== v) continue;
      const edge = t.faceEdges[f * 3 + i]!;
      if (seamEdge[edge]) continue;
      for (let k = t.faceStart[edge]!; k < t.faceStart[edge + 1]!; k++) { const g = t.faces[k]!; if (g !== f && parent.has(g)) parent.set(find(g), find(f)); }
    }
    const groupIndex = new Map<number, number>();
    for (const f of fs.sort((x, y) => x - y)) {
      const r = find(f);
      let id = groupIndex.get(r);
      if (id === undefined) { id = source.length; source.push(v); groupIndex.set(r, id); }
      for (let i = 0; i < 3; i++) if (indices[f * 3 + i] === v) corner[f * 3 + i] = id;
    }
  }
  return { indices: Uint32Array.from(corner), source: Uint32Array.from(source) };
}

/** Triangle areas. */
export function faceAreas(positions: Float64Array | Float32Array, indices: Uint32Array) {
  const out = new Float64Array(indices.length / 3), f = [0, 0, 0];
  for (let t = 0; t < out.length; t++) { faceNormal(positions, indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!, f); out[t] = Math.hypot(f[0]!, f[1]!, f[2]!) / 2; }
  return out;
}

/** Remove faces that repeat a vertex set: opposite-winding pairs (flaps) cancel, same-winding copies collapse to one. */
export function removeDuplicateFaces(indices: Uint32Array): Uint32Array {
  const faceCount = indices.length / 3, sorted = new Uint32Array(indices.length), parity = new Int8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    let a = indices[f * 3]!, b = indices[f * 3 + 1]!, c = indices[f * 3 + 2]!, p = 1;
    if (a > b) { [a, b] = [b, a]; p = -p; }
    if (b > c) { [b, c] = [c, b]; p = -p; }
    if (a > b) { [a, b] = [b, a]; p = -p; }
    sorted[f * 3] = a; sorted[f * 3 + 1] = b; sorted[f * 3 + 2] = c; parity[f] = a === b || b === c ? 0 : p;
  }
  const order = new Uint32Array(faceCount);
  for (let i = 0; i < faceCount; i++) order[i] = i;
  const cmp = (x: number, y: number) => sorted[x * 3]! - sorted[y * 3]! || sorted[x * 3 + 1]! - sorted[y * 3 + 1]! || sorted[x * 3 + 2]! - sorted[y * 3 + 2]! || x - y;
  order.sort(cmp);
  const keep = new Uint8Array(faceCount);
  for (let i = 0; i < faceCount;) {
    let j = i + 1;
    const fi = order[i]!;
    while (j < faceCount && sorted[order[j]! * 3] === sorted[fi * 3] && sorted[order[j]! * 3 + 1] === sorted[fi * 3 + 1] && sorted[order[j]! * 3 + 2] === sorted[fi * 3 + 2]) j++;
    let net = 0;
    for (let k = i; k < j; k++) net += parity[order[k]!]!;
    if (net !== 0) { const want = Math.sign(net); for (let k = i; k < j; k++) if (parity[order[k]!] === want) { keep[order[k]!] = 1; break; } }
    i = j;
  }
  const out: number[] = [];
  for (let f = 0; f < faceCount; f++) if (keep[f]) out.push(indices[f * 3]!, indices[f * 3 + 1]!, indices[f * 3 + 2]!);
  return Uint32Array.from(out);
}
