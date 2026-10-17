import type { Rng } from '../core/rng.ts';
import { ROOM } from '../scenes/collision.ts';
import { route, walkable, type Waypoint } from '../scenes/navigation.ts';

/** Matches cat.loco.walk's authored speed (data/animation-catalog.json). */
export const WALK_SPEED = .7;
const TURN_RATE = 3.2;

/**
 * Minimal movement model until the needs → utility scorer → behavior tree AI
 * lands: rest a while, then stroll to a random open spot on the café floor.
 * Runs on the fixed step with the cat's own RNG stream; never reads input.
 */
export class Wander {
  x: number; z: number; yaw = 0; speed = 0;
  previousX: number; previousZ: number; previousYaw = 0;
  #wait: number; #path: Waypoint[] = []; readonly #rng: Rng;
  constructor(rng: Rng, start: Waypoint) {
    this.#rng = rng; this.x = this.previousX = start.x; this.z = this.previousZ = start.z; this.#wait = rng.range(1, 3);
  }
  get moving(): boolean { return this.#path.length > 0; }
  step(dt: number): void {
    this.previousX = this.x; this.previousZ = this.z; this.previousYaw = this.yaw; this.speed = 0;
    if (!this.moving) {
      if ((this.#wait -= dt) > 0) return;
      for (let tries = 0; tries < 8 && !this.moving; tries++) {
        const target = { x: this.#rng.range(ROOM.minX + .5, ROOM.maxX - .5), z: this.#rng.range(ROOM.minZ + .5, ROOM.maxZ - .5) };
        if (walkable(target.x, target.z) && Math.hypot(target.x - this.x, target.z - this.z) > 1) this.#path = route(this, target);
      }
      this.#wait = this.moving ? 0 : 1;
      return;
    }
    const next = this.#path[0]!, dx = next.x - this.x, dz = next.z - this.z, distance = Math.hypot(dx, dz);
    let turn = Math.atan2(dx, dz) - this.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.yaw += Math.sign(turn) * Math.min(Math.abs(turn), TURN_RATE * dt);
    // Turn on the spot first, then walk; the walk clip's speed follows the real speed.
    this.speed = WALK_SPEED * Math.max(0, Math.cos(turn));
    const advance = Math.min(distance, this.speed * dt);
    if (distance > 1e-6) { this.x += dx / distance * advance; this.z += dz / distance * advance; }
    if (distance - advance < .02) {
      this.#path.shift();
      if (!this.moving) this.#wait = this.#rng.exponential(5) + 2;
    }
  }
}
