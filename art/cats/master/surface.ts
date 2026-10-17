/**
 * Surface stage: extract the dense sculpt, repair it into a closed 2-manifold, open the eyelid
 * apertures (cutting the socket lining a few degrees under the lids so the body has two clean eye
 * openings), and simplify to the review source with feature-weighted density.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import { type Anatomy, type EyeFrame, eyeAngles } from './anatomy.ts';
import { meshShape, project } from './mesher.ts';
import { type Mesh, compact, cutLevelSet, largestComponent, removeDuplicateFaces, repairManifold, topologyOf, vertexNormals } from './mesh-ops.ts';
import type { Field, Vec3 } from './sdf.ts';
import { log } from './log.ts';

/** Angular depth under the lid margin where the socket lining ends (the eye opening's boundary). */
export const LINING_DEPTH = 9 * Math.PI / 180;

export function denseSurface(cat: Anatomy, h: number): Mesh {
  const raw = meshShape(cat.shape, h);
  log(`surface nets h=${(h * 1000).toFixed(2)} mm: ${raw.indices.length / 3} triangles`);
  project(raw.positions, v => raw.fields[raw.vertexBlock[v]!]!, 4, h);
  const field = cat.shape.eval;
  const projectPoint = (p: Vec3): Vec3 => projectOnto(field, p);
  let mesh: Mesh = { positions: raw.positions, indices: largestComponent(raw.indices, raw.positions.length / 3) };
  mesh = compact(mesh).mesh;
  mesh = repairManifold(mesh, projectPoint);
  const topo = topologyOf(mesh.indices, mesh.positions.length / 3);
  if (topo.boundaryEdges || topo.nonManifoldEdges || topo.nonManifoldVertices || topo.components !== 1 || topo.misoriented)
    throw new Error(`dense surface is not a closed manifold: ${JSON.stringify({ ...topo, loops: topo.loops.length })}`);
  return mesh;
}

export function projectOnto(field: Field, p: Vec3, iterations = 6): Vec3 {
  let [x, y, z] = p;
  const e = 1e-5;
  for (let i = 0; i < iterations; i++) {
    const d = field(x, y, z);
    if (Math.abs(d) < 1e-8) break;
    const gx = (field(x + e, y, z) - field(x - e, y, z)) / (2 * e), gy = (field(x, y + e, z) - field(x, y - e, z)) / (2 * e), gz = (field(x, y, z + e) - field(x, y, z - e)) / (2 * e);
    const g2 = gx * gx + gy * gy + gz * gz;
    if (g2 < 1e-12) break;
    x -= d * gx / g2; y -= d * gy / g2; z -= d * gz / g2;
  }
  return [x, y, z];
}

/** Keep everything except the socket lining deeper than LINING_DEPTH under the lids. */
export function openEyes(mesh: Mesh, eyes: readonly EyeFrame[]): Mesh {
  let out = mesh;
  for (const eye of eyes) {
    const n = out.positions.length / 3, phi = new Float64Array(n), lining = eye.radius + eye.gap;
    for (let v = 0; v < n; v++) {
      const a = eyeAngles(eye, out.positions[v * 3]!, out.positions[v * 3 + 1]!, out.positions[v * 3 + 2]!);
      phi[v] = Math.max((LINING_DEPTH - a.ang) * a.r, a.r - (lining + .00025));
    }
    out = cutLevelSet(out, phi, p => {
      // Cut vertices lie on the lining sphere.
      const d: Vec3 = [p[0] - eye.center[0], p[1] - eye.center[1], p[2] - eye.center[2]], l = Math.hypot(...d);
      return [eye.center[0] + d[0] / l * lining, eye.center[1] + d[1] / l * lining, eye.center[2] + d[2] / l * lining];
    });
  }
  return out;
}

/**
 * Feature-weighted simplification: normals scaled by a per-vertex importance act as attributes,
 * so curved and important regions (lids, lips, muzzle, ears, paws) keep more density. Returns
 * a compacted mesh (vertices are a subset of the input; `inverse` maps back).
 */
export function simplify(mesh: Mesh, targetTriangles: number, importance: Float32Array, options: { weight?: number; regularize?: boolean; lock?: Uint8Array } = {}) {
  const n = mesh.positions.length / 3;
  const positions = Float32Array.from(mesh.positions);
  const normals = vertexNormals(mesh.positions, mesh.indices);
  const attributes = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) attributes[v * 3 + k] = normals[v * 3 + k]! * importance[v]!;
  const flags: ('Regularize' | 'RegularizeLight')[] = options.regularize === false ? [] : ['RegularizeLight'];
  const [indices] = MeshoptSimplifier.simplifyWithAttributes(mesh.indices, positions, 3, attributes, 3, [options.weight ?? .6, options.weight ?? .6, options.weight ?? .6],
    options.lock ?? null, targetTriangles * 3, 1, flags);
  return compact({ positions: mesh.positions, indices: removeDuplicateFaces(indices) });
}
