import controls from '../../data/interaction.json' with { type: 'json' };
export interface TurnRate { yaw: number; pitch: number }
/** Look joystick: the drag offset's direction splits into yaw and pitch, and its length sets the angular speed. */
export function radialRate(offsetX: number, offsetY: number, touch: boolean, reducedMotion: boolean, out: TurnRate): TurnRate {
  const length = Math.hypot(offsetX, offsetY), dead = controls.dragThresholdPx, full = touch ? controls.radialFullPxTouch : controls.radialFullPxMouse;
  if (length <= dead) { out.yaw = out.pitch = 0; return out; }
  const speed = Math.min(1, (length - dead) / (full - dead)) ** controls.radialCurve * (touch ? controls.radialMaxRadPerSecondTouch : controls.radialMaxRadPerSecondMouse) * (reducedMotion ? controls.reducedMotionLookScale : 1);
  out.yaw = -offsetX / length * speed; out.pitch = -offsetY / length * speed; return out;
}
