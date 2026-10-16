import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three';

/**
 * Baseline placeholder (task M0-1): a blocked-out café room so every deploy has
 * something to look at. Task M0-2 replaces it with the real renderer, tier
 * probe, fixed-step loop and café scene.
 */

/** README's UI palette seed plus two wood tones. */
const COLORS = {
  cream: 0xfff8ec,
  cocoa: 0x5b3a29,
  tuxedo: 0x1e1e24,
  sky: 0x6ec6ff,
  aqua: 0x3ddbd9,
  leaf: 0x8bd450,
  wood: 0xb07a4f,
  walnut: 0x8a5a3c,
} as const;

export interface Cafe { scene: Scene; camera: PerspectiveCamera; dispose(): void }

export function createCafe(): Cafe {

  const scene = new Scene();
  scene.background = new Color(COLORS.cream);

  // Standing eye height, looking into the room.
  const camera = new PerspectiveCamera(60, 1, 0.05, 50);
  camera.position.set(0, 1.6, 3.2);
  camera.lookAt(0, 1.0, -2);

  const disposables: { dispose(): void }[] = [];
  const box = (size: [number, number, number], color: number, at: [number, number, number], emissive = 0): Mesh => {
    const geometry = new BoxGeometry(...size);
    const material = new MeshStandardMaterial({ color, roughness: 0.8, emissive, emissiveIntensity: emissive ? 0.6 : 0 });
    disposables.push(geometry, material);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...at);
    scene.add(mesh);
    return mesh;
  };

  // Room: 8 m wide, 6 m deep, 3 m high, open toward the camera.
  const floorGeometry = new PlaneGeometry(8, 6);
  const floorMaterial = new MeshStandardMaterial({ color: COLORS.wood, roughness: 0.7 });
  disposables.push(floorGeometry, floorMaterial);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -1;
  scene.add(floor);
  box([8, 3, 0.1], COLORS.cream, [0, 1.5, -4]);
  box([0.1, 3, 6], COLORS.cream, [-4, 1.5, -1]);
  box([0.1, 3, 6], COLORS.cream, [4, 1.5, -1]);

  // Counter, window, cat tree and two tables.
  box([2.4, 1.0, 0.7], COLORS.cocoa, [-2.2, 0.5, -3.3]);
  box([1.6, 1.0, 0.05], COLORS.sky, [1.8, 1.7, -3.94], COLORS.sky);
  box([0.25, 1.8, 0.25], COLORS.cocoa, [2.8, 0.9, -2.6]);
  box([0.8, 0.06, 0.8], COLORS.aqua, [2.8, 0.7, -2.6]);
  box([0.7, 0.06, 0.7], COLORS.leaf, [2.8, 1.35, -2.6]);
  box([0.6, 0.06, 0.6], COLORS.aqua, [2.8, 1.8, -2.6]);
  for (const [x, z] of [[-0.8, -1.4], [0.9, -0.7]] as const) {
    box([0.9, 0.05, 0.9], COLORS.walnut, [x, 0.75, z]);
    box([0.12, 0.72, 0.12], COLORS.tuxedo, [x, 0.36, z]);
  }

  scene.add(new HemisphereLight(0xffffff, COLORS.wood, 2.2));
  const sun = new DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(2, 4, 1);
  scene.add(sun);

  return { scene, camera,
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
