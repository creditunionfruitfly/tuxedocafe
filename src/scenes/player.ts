import { slide } from './collision.ts';
import { route, type Waypoint } from './navigation.ts';
import controls from '../../data/interaction.json' with { type: 'json' };
export class Player {
  x = 0; z = 2.2; yaw = 0; pitch = -.08; lean = 0;
  previousX = 0; previousZ = 2.2; vx = 0; vz = 0;
  target: { x: number; z: number } | null = null;
  private path: Waypoint[] = [];
  reducedMotion = false;
  walkTo(x: number, z: number): void { this.path=route(this,{x,z});this.target=this.path.shift()??null; }
  jumpTo(x:number,z:number):boolean {
    if(Math.hypot(x-this.x,z-this.z)>controls.jumpMaxMeters||!route(this,{x,z}).length)return false;
    this.x=this.previousX=x;this.z=this.previousZ=z;this.vx=this.vz=0;this.target=null;this.path=[];return true;
  }
  look(dx: number, dy: number): void { const rate = this.reducedMotion ? .0017 : .003; this.yaw -= dx * rate; this.pitch = Math.max(-1.396, Math.min(1.396, this.pitch - dy * rate)); }
  step(dt: number, side: number, forward: number): void {
    this.previousX = this.x; this.previousZ = this.z;
    let dx = side * Math.cos(this.yaw) - forward * Math.sin(this.yaw);
    let dz = -side * Math.sin(this.yaw) - forward * Math.cos(this.yaw);
    if (side || forward) { this.target = null; this.path.length=0; }
    else if (this.target) {
      dx = this.target.x - this.x; dz = this.target.z - this.z;
      if (Math.hypot(dx, dz) < .09) { this.target=this.path.shift()??null;dx=dz=0; }
    }
    const length = Math.hypot(dx, dz); if (length > 0) { dx /= length; dz /= length; }
    const speed=this.target?Math.min(controls.walkMetersPerSecond,length/dt):controls.walkMetersPerSecond;
    const smooth = 1 - Math.exp(-dt * 12); this.vx += (dx * speed - this.vx) * smooth; this.vz += (dz * speed - this.vz) * smooth;
    slide(this, this.vx * dt, this.vz * dt);
    if (this.target && Math.abs(this.previousX - this.x) + Math.abs(this.previousZ - this.z) < .0001) this.target = null;
  }
}
