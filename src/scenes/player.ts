import { Quaternion, Vector3 } from 'three';
import { slide } from './collision.ts';
import { route, type Waypoint } from './navigation.ts';
import controls from '../../data/interaction.json' with { type: 'json' };
export const PITCH_LIMIT = 1.396;
const UP = new Vector3(0, 1, 0), RIGHT = new Vector3(1, 0, 0), yawTurn = new Quaternion(), pitchTurn = new Quaternion();
export class Player {
  x = 0; z = 2.2; yaw = 0; pitch = -.08; lean = 0;
  previousX = 0; previousZ = 2.2; vx = 0; vz = 0;
  target: { x: number; z: number } | null = null;
  private path: Waypoint[] = [];
  reducedMotion = false;
  walkTo(x: number, z: number): boolean { this.path=route(this,{x,z});this.target=this.path.shift()??null;return !!this.target; }
  jumpTo(x:number,z:number):boolean {
    if(Math.hypot(x-this.x,z-this.z)>controls.jumpMaxMeters||!route(this,{x,z}).length)return false;
    this.x=this.previousX=x;this.z=this.previousZ=z;this.vx=this.vz=0;this.target=null;this.path=[];return true;
  }
  /** Direct look follows the drag; touch is more sensitive than the mouse. */
  look(dx: number, dy: number, touch = false): void { const rate = (touch ? controls.lookTouchRadPerPx : controls.lookMouseRadPerPx) * (this.reducedMotion ? controls.reducedMotionLookScale : 1); this.turn(-dx * rate, -dy * rate); }
  /** Arrow keys: turn is +1 for left, tilt is +1 for up. */
  steer(dt: number, turn: number, tilt: number): void { const rate = controls.keyLookRadPerSecond * (this.reducedMotion ? controls.reducedMotionLookScale : 1) * dt; this.turn(turn * rate, tilt * rate); }
  /** Yaw is unbounded (wrapped to ±π for the public stamp); pitch stops short of straight up or down. */
  turn(dYaw: number, dPitch: number): void { this.yaw = Math.atan2(Math.sin(this.yaw + dYaw), Math.cos(this.yaw + dYaw)); this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + dPitch)); }
  /** World yaw × local pitch keeps the horizon level: drags never roll the camera. */
  orientation(target: Quaternion): Quaternion { return target.multiplyQuaternions(yawTurn.setFromAxisAngle(UP, this.yaw), pitchTurn.setFromAxisAngle(RIGHT, this.pitch)); }
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
    const speed=this.target?Math.min(controls.walkMetersPerSecond,length/dt):controls.walkMetersPerSecond*Math.min(1,Math.hypot(side,forward));
    const smooth = 1 - Math.exp(-dt * 12); this.vx += (dx * speed - this.vx) * smooth; this.vz += (dz * speed - this.vz) * smooth;
    slide(this, this.vx * dt, this.vz * dt);
    if (this.target && Math.abs(this.previousX - this.x) + Math.abs(this.previousZ - this.z) < .0001) this.target = null;
  }
}
