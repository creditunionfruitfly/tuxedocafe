import { BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type Intersection } from 'three';

/** Check authored members after their final world transforms, before batching. */
export function assertContact(name: string, a: BufferGeometry, b: BufferGeometry, tolerance = .002) {
  a.computeBoundingBox(); b.computeBoundingBox();
  const left = a.boundingBox!.clone().expandByScalar(tolerance);
  if (!left.intersectsBox(b.boundingBox!)) {
    throw new Error(`Cafe join '${name}' is disconnected: ${JSON.stringify([a.boundingBox, b.boundingBox])}`);
  }
}

export function assertSurfaceUV(name: string, geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  if (!uv || uv.count !== positions.count || !Array.from(uv.array).every(Number.isFinite)) {
    throw new Error(`Cafe surface '${name}' needs finite UV0 coordinates for every vertex`);
  }
}

export function assertPostUnderDeck(name: string, center: [number, number, number], radius: number,
  start: [number, number, number], end: [number, number, number], deckThickness: number) {
  const horizontal = new Vector3(start[0] - center[0], 0, start[2] - center[2]).length();
  const underside = center[1] - deckThickness / 2;
  if (horizontal > radius - .073 || start[1] >= underside || end[1] < underside + .005) {
    throw new Error(`Cafe post '${name}' must terminate inside the supported deck`);
  }
}


export interface Opening { z: number; minX: number; maxX: number; minY: number; maxY: number }

/** 360° look needs café on every side: each eye ray from a standing spot must meet authored
 * geometry, or leave through a glazed opening onto the sky. */
export function assertEnclosed(pieces: readonly BufferGeometry[], eyes: readonly [number, number, number][],
  openings: readonly Opening[], far = 14) {
  const material = new MeshBasicMaterial({ side: DoubleSide }), raycaster = new Raycaster(), hits: Intersection[] = [];
  const meshes = pieces.map(geometry => { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return new Mesh(geometry, material); });
  raycaster.far = far;
  for (const eye of eyes) for (let yaw = 0; yaw < 360; yaw += 5) for (const pitch of [-75, -45, -20, 0, 20, 45, 75]) {
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
    raycaster.set(new Vector3(...eye), new Vector3(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)));
    hits.length = 0;
    for (const mesh of meshes) { if (raycaster.ray.intersectsBox(mesh.geometry.boundingBox!)) mesh.raycast(raycaster, hits); if (hits.length) break; }
    const { origin, direction } = raycaster.ray;
    const outside = openings.some(o => {
      const t = (o.z - origin.z) / direction.z, x = origin.x + direction.x * t, y = origin.y + direction.y * t;
      return t > 0 && x >= o.minX && x <= o.maxX && y >= o.minY && y <= o.maxY;
    });
    if (!hits.length && !outside) throw new Error(`Cafe enclosure: from (${eye.join(', ')}) yaw ${yaw}° pitch ${pitch}° sees open space within ${far} m`);
  }
  material.dispose();
}
