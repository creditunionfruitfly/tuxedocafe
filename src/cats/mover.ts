import { route, type Waypoint } from '../scenes/navigation.ts';

const TURN_RATE = 3.2;
export const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Moves one cat over the café floor on the fixed step: routes, turns before walking, and keeps the previous pose for interpolation. */
export class Mover {
  x: number; z: number; y = 0; yaw = 0; speed = 0;
  previousX: number; previousZ: number; previousY = 0; previousYaw = 0;
  #path: Waypoint[] = []; #speed = 0;
  constructor(start: Waypoint, yaw = 0) { this.x = this.previousX = start.x; this.z = this.previousZ = start.z; this.yaw = this.previousYaw = yaw; }
  get moving(): boolean { return this.#path.length > 0; }
  get target(): Waypoint | null { return this.#path.at(-1) ?? null; }
  /** Routes over open floor; `direct` walks straight, e.g. into a litter box. False when no route exists. */
  goTo(target: Waypoint, speed: number, direct = false): boolean { this.#path = direct ? [{ ...target }] : route(this, target); this.#speed = speed; return this.moving; }
  stop(): void { this.#path = []; this.speed = 0; }
  begin(): void { this.previousX = this.x; this.previousZ = this.z; this.previousY = this.y; this.previousYaw = this.yaw; this.speed = 0; }
  /** Turns toward a heading and returns the angle still to go. */
  turn(yaw: number, dt: number): number {
    const diff = wrap(yaw - this.yaw), step = Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
    this.yaw = wrap(this.yaw + step); return diff - step;
  }
  place(x: number, z: number, y: number): void { this.x = x; this.z = z; this.y = y; }
  step(dt: number): void {
    const next = this.#path[0];
    if (!next) return;
    const dx = next.x - this.x, dz = next.z - this.z, distance = Math.hypot(dx, dz), left = this.turn(Math.atan2(dx, dz), dt);
    this.speed = this.#speed * Math.max(0, Math.cos(left));
    const advance = Math.min(distance, this.speed * dt);
    if (distance > 1e-6) { this.x += dx / distance * advance; this.z += dz / distance * advance; }
    if (distance - advance < .02) this.#path.shift();
  }
}
