import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Resident } from '../cats/resident.ts';

/** Alternate view of the same render, leaving the patron's camera and FOV parked. */
export class CatView {
  readonly camera: PerspectiveCamera;
  target: Resident | null = null;
  readonly #position = new Vector3(); readonly #orientation = new Quaternion();
  #visible = true;
  constructor(playerCamera: PerspectiveCamera) {
    this.camera = new PerspectiveCamera(75, playerCamera.aspect, playerCamera.near, playerCamera.far);
  }
  enter(cat: Resident): void {
    this.exit();
    this.target = cat;
    // Keep the damped eye position from crossing inside its own skinned mesh.
    this.#visible = cat.root.visible; cat.root.visible = false;
    cat.eyes(this.camera.position, this.camera.quaternion);
  }
  exit(): void {
    if (this.target) this.target.root.visible = this.#visible;
    this.target = null;
  }
  render(dt: number, aspect: number, reduced: boolean): void {
    if (!this.target) return;
    const camera = this.camera;
    this.target.eyes(this.#position, this.#orientation);
    camera.position.lerp(this.#position, 1 - Math.exp(-dt / (reduced ? .18 : .07)));
    const angle = camera.quaternion.angleTo(this.#orientation);
    if (angle > 0) camera.quaternion.slerp(this.#orientation, Math.min(1 - Math.exp(-dt / (reduced ? .29 : .12)), (reduced ? 1.5 : 2.8) * dt / angle));
    if (camera.aspect !== aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }
}
