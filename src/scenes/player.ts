import { slide } from './collision.ts';
export class Player {
  x = 0; z = 2.2; yaw = 0; pitch = -.08; lean = 0;
  previousX = 0; previousZ = 2.2; vx = 0; vz = 0;
  target: { x: number; z: number } | null = null;
  reducedMotion = false;
  walkTo(x: number, z: number): void { this.target = { x, z }; }
  look(dx: number, dy: number): void { const rate = this.reducedMotion ? .0017 : .003; this.yaw -= dx * rate; this.pitch = Math.max(-1.396, Math.min(1.396, this.pitch - dy * rate)); }
  step(dt: number, side: number, forward: number): void {
    this.previousX = this.x; this.previousZ = this.z;
    let dx = side * Math.cos(this.yaw) - forward * Math.sin(this.yaw);
    let dz = -side * Math.sin(this.yaw) - forward * Math.cos(this.yaw);
    if (side || forward) this.target = null;
    else if (this.target) {
      dx = this.target.x - this.x; dz = this.target.z - this.z;
      if (Math.hypot(dx, dz) < .04) { this.target = null; dx = dz = 0; }
    }
    const length = Math.hypot(dx, dz); if (length > 0) { dx /= Math.max(1, length); dz /= Math.max(1, length); }
    const smooth = 1 - Math.exp(-dt * 12); this.vx += (dx * 1.4 - this.vx) * smooth; this.vz += (dz * 1.4 - this.vz) * smooth;
    slide(this, this.vx * dt, this.vz * dt);
    if (this.target && Math.abs(this.previousX - this.x) + Math.abs(this.previousZ - this.z) < .0001) this.target = null;
  }
}
