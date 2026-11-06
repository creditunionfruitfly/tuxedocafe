import controls from '../../data/interaction.json' with { type: 'json' };
export interface TurnRate { yaw: number; pitch: number }
/** Look joystick: the drag offset's direction splits into yaw and pitch, and its length sets the angular speed. */
export function radialRate(offsetX: number, offsetY: number, touch: boolean, reducedMotion: boolean, out: TurnRate): TurnRate {
  const length = Math.hypot(offsetX, offsetY), dead = controls.dragThresholdPx, full = touch ? controls.radialFullPxTouch : controls.radialFullPxMouse;
  if (length <= dead) { out.yaw = out.pitch = 0; return out; }
  const speed = Math.min(1, (length - dead) / (full - dead)) ** controls.radialCurve * (touch ? controls.radialMaxRadPerSecondTouch : controls.radialMaxRadPerSecondMouse) * (reducedMotion ? controls.reducedMotionLookScale : 1);
  out.yaw = -offsetX / length * speed; out.pitch = -offsetY / length * speed; return out;
}
export interface Stick { side: number; forward: number }
/** Walk joystick: the two-finger midpoint's offset sets the walking direction, and its length the pace (0 to 1). */
export function moveStick(offsetX: number, offsetY: number, out: Stick): Stick {
  const length = Math.hypot(offsetX, offsetY), dead = controls.dragThresholdPx;
  if (length <= dead) { out.side = out.forward = 0; return out; }
  const pace = Math.min(1, (length - dead) / (controls.moveFullPxTouch - dead));
  out.side = offsetX / length * pace; out.forward = -offsetY / length * pace; return out;
}
