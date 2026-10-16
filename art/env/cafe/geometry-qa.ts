import { BufferGeometry, Vector3 } from 'three';

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

