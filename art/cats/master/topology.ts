/** Indexed triangle mesh topology helpers: edges, boundaries, manifold and orientation checks. */

export interface EdgeInfo { a: number; b: number; faces: number[] }

const key = (a: number, b: number) => a < b ? a * 0x200000 + b : b * 0x200000 + a;

export function edgeMap(indices: Uint32Array | number[]) {
  const map = new Map<number, EdgeInfo>();
  for (let f = 0; f < indices.length / 3; f++) for (let e = 0; e < 3; e++) {
    const a = indices[f * 3 + e]!, b = indices[f * 3 + (e + 1) % 3]!, k = key(a, b);
    let info = map.get(k);
    if (!info) { info = { a: Math.min(a, b), b: Math.max(a, b), faces: [] }; map.set(k, info); }
    info.faces.push(f);
  }
  return map;
}

export interface TopologyReport {
  vertices: number; faces: number; boundaryEdges: number; nonManifoldEdges: number; misorientedEdges: number;
  degenerateFaces: number; components: number; boundaryLoops: number[][]; nonManifoldVertices: number;
}

/** Full topology report; positions are used for degenerate-face detection only. */
export function topology(indices: Uint32Array, vertexCount: number, positions?: Float64Array | Float32Array): TopologyReport {
  const edges = edgeMap(indices);
  let boundaryEdges = 0, nonManifoldEdges = 0, misorientedEdges = 0;
  const next = new Map<number, number[]>();
  for (const e of edges.values()) {
    if (e.faces.length === 1) {
      boundaryEdges++;
      // Directed boundary edge in face winding order.
      const f = e.faces[0]!;
      for (let i = 0; i < 3; i++) {
        const a = indices[f * 3 + i]!, b = indices[f * 3 + (i + 1) % 3]!;
        if (Math.min(a, b) === e.a && Math.max(a, b) === e.b) { const list = next.get(b) ?? []; list.push(a); next.set(b, list); }
      }
    } else if (e.faces.length > 2) nonManifoldEdges++;
    else {
      const dir = (f: number) => { for (let i = 0; i < 3; i++) { const a = indices[f * 3 + i]!, b = indices[f * 3 + (i + 1) % 3]!; if (a === e.a && b === e.b) return 1; if (a === e.b && b === e.a) return -1; } return 0; };
      if (dir(e.faces[0]!) === dir(e.faces[1]!)) misorientedEdges++;
    }
  }
  // Boundary loops (reverse winding chains).
  const boundaryLoops: number[][] = [], used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: number[] = []; let v = start;
    for (let guard = 0; guard < 1e6; guard++) {
      if (used.has(v)) break;
      used.add(v); loop.push(v);
      const n = next.get(v); if (!n || !n.length) break;
      v = n[0]!;
    }
    boundaryLoops.push(loop);
  }
  // Components via union-find over faces sharing vertices.
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  for (let f = 0; f < indices.length / 3; f++) {
    const a = find(indices[f * 3]!), b = find(indices[f * 3 + 1]!), c = find(indices[f * 3 + 2]!);
    parent[b] = a; parent[find(c)] = a;
  }
  const roots = new Set<number>();
  const usedVertex = new Uint8Array(vertexCount);
  for (const i of indices) usedVertex[i] = 1;
  for (let v = 0; v < vertexCount; v++) if (usedVertex[v]) roots.add(find(v));
  let degenerateFaces = 0;
  if (positions) for (let f = 0; f < indices.length / 3; f++) {
    const a = indices[f * 3]! * 3, b = indices[f * 3 + 1]! * 3, c = indices[f * 3 + 2]! * 3;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-14) degenerateFaces++;
  }
  // Non-manifold vertices: the faces around a vertex must form a single fan.
  let nonManifoldVertices = 0;
  const faceOf: number[][] = Array.from({ length: vertexCount }, () => []);
  for (let f = 0; f < indices.length / 3; f++) for (let i = 0; i < 3; i++) faceOf[indices[f * 3 + i]!]!.push(f);
  for (let v = 0; v < vertexCount; v++) {
    const fs = faceOf[v]!;
    if (fs.length < 2) continue;
    // Count connected fans through edges incident to v.
    const seen = new Set<number>([fs[0]!]), queue = [fs[0]!];
    while (queue.length) {
      const f = queue.pop()!;
      for (let i = 0; i < 3; i++) {
        const o = indices[f * 3 + i]!; if (o === v) continue;
        const e = edges.get(key(v, o)); if (!e) continue;
        for (const g of e.faces) if (!seen.has(g)) { seen.add(g); queue.push(g); }
      }
    }
    if (seen.size !== fs.length) nonManifoldVertices++;
  }
  return { vertices: vertexCount, faces: indices.length / 3, boundaryEdges, nonManifoldEdges, misorientedEdges, degenerateFaces, components: roots.size, boundaryLoops, nonManifoldVertices };
}

/** One-ring neighbours per vertex. */
export function neighbours(indices: Uint32Array, vertexCount: number): Int32Array[] {
  const sets: Set<number>[] = Array.from({ length: vertexCount }, () => new Set());
  for (let f = 0; f < indices.length / 3; f++) for (let i = 0; i < 3; i++) {
    const a = indices[f * 3 + i]!, b = indices[f * 3 + (i + 1) % 3]!;
    sets[a]!.add(b); sets[b]!.add(a);
  }
  return sets.map(s => Int32Array.from(s));
}

/** Area-weighted face normals accumulated per vertex (unnormalised input positions). */
export function vertexNormals(positions: Float64Array | Float32Array, indices: Uint32Array) {
  const n = new Float64Array(positions.length);
  for (let f = 0; f < indices.length / 3; f++) {
    const a = indices[f * 3]!, b = indices[f * 3 + 1]!, c = indices[f * 3 + 2]!;
    const ux = positions[b * 3]! - positions[a * 3]!, uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!, uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!, vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!, vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { n[v * 3]! += nx; n[v * 3 + 1]! += ny; n[v * 3 + 2]! += nz; }
  }
  for (let v = 0; v < n.length / 3; v++) { const l = Math.hypot(n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!) || 1; n[v * 3]! /= l; n[v * 3 + 1]! /= l; n[v * 3 + 2]! /= l; }
  return n;
}
