export interface Box2 { minX: number; maxX: number; minZ: number; maxZ: number }
export const ROOM: Box2 = { minX: -5, maxX: 5, minZ: -5, maxZ: 3 };
export const FURNITURE: readonly Box2[] = [
  { minX: -4.6, maxX: -1, minZ: -4.65, maxZ: -3.75 },
  { minX: -2.65, maxX: -1.35, minZ: -1.25, maxZ: .05 },
  { minX: -.15, maxX: 1.15, minZ: -3.75, maxZ: -2.45 },
  { minX: 3.2, maxX: 4.2, minZ: -2.7, maxZ: -1.7 },
  { minX: 3.7, maxX: 4.8, minZ: -4.7, maxZ: -3.2 },
];
export function blocked(x: number, z: number, box: Box2, radius: number): boolean {
  const nx = Math.max(box.minX, Math.min(box.maxX, x)); const nz = Math.max(box.minZ, Math.min(box.maxZ, z));
  return (nx - x) ** 2 + (nz - z) ** 2 < radius ** 2;
}
/** Resolve axes separately so a player slides along furniture rather than sticking. */
export function slide(position: { x: number; z: number }, dx: number, dz: number, boxes = FURNITURE, radius = .23): void {
  const x = Math.max(ROOM.minX + radius, Math.min(ROOM.maxX - radius, position.x + dx));
  let hit=false;for(const box of boxes)if(blocked(x,position.z,box,radius)){hit=true;break;}
  if (!hit) position.x = x;
  const z = Math.max(ROOM.minZ + radius, Math.min(ROOM.maxZ - radius, position.z + dz));
  hit=false;for(const box of boxes)if(blocked(position.x,z,box,radius)){hit=true;break;}
  if (!hit) position.z = z;
}
