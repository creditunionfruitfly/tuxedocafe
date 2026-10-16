import { expect, it } from 'vitest';
import { Euler, Quaternion } from 'three';
import controls from '../../data/interaction.json' with { type: 'json' };
import { Player } from '../../src/scenes/player.ts';
import { slide } from '../../src/scenes/collision.ts';
import { FixedLoop } from '../../src/core/loop.ts';
it('moves at a fixed speed independently of rendering', () => {
  const results = [30,144].map(fps => { const player = new Player(); const loop = new FixedLoop(dt => player.step(dt,0,1), () => {}); for(let i=0;i<=fps;i++)loop.frame(i*1000/fps); return player.z; });
  expect(results[0]).toBeCloseTo(results[1]!,10); expect(results[0]).toBeLessThan(1.1);
});
it('slides against furniture and clamps room boundaries', () => {
  const p = { x: 0, z: 0 }; slide(p,.3,.3,[{minX:.4,maxX:1,minZ:-1,maxZ:1}]); expect(p.x).toBe(0); expect(p.z).toBe(.3);
  slide(p,100,100,[]); expect(p.x).toBe(4.77); expect(p.z).toBe(2.77);
});
it('arrives at walk targets and limits pitch', () => { const player = new Player(); player.walkTo(0,1); for(let i=0;i<180;i++)player.step(1/30,0,0); expect(player.z).toBeCloseTo(1,1); expect(player.target).toBeNull(); player.look(0,99999); expect(player.pitch).toBe(-1.396); });
it('turns a full circle, wraps yaw and composes a roll-free quaternion', () => {
  const player = new Player(); for (let i = 0; i < 40; i++) player.turn(Math.PI / 16, 0);
  expect(player.yaw).toBeCloseTo(Math.PI / 2, 10); expect(Math.abs(player.yaw)).toBeLessThanOrEqual(Math.PI);
  player.turn(0, .5); const q = player.orientation(new Quaternion()), euler = new Euler().setFromQuaternion(q, 'YXZ');
  expect(euler.y).toBeCloseTo(player.yaw, 10); expect(euler.x).toBeCloseTo(player.pitch, 10); expect(euler.z).toBeCloseTo(0, 10);
});
it('uses doubled touch sensitivity, arrow-key steering and the reduced-motion scale', () => {
  const mouse = new Player(), touch = new Player(); mouse.look(100, 0); touch.look(100, 0, true);
  expect(touch.yaw).toBeCloseTo(-100 * controls.lookTouchRadPerPx, 10); expect(mouse.yaw).toBeCloseTo(-100 * controls.lookMouseRadPerPx, 10);
  const keys = new Player(); keys.steer(.5, 1, -1); expect(keys.yaw).toBeCloseTo(.5 * controls.keyLookRadPerSecond, 10); expect(keys.pitch).toBeCloseTo(-.08 - .5 * controls.keyLookRadPerSecond, 10);
  const calm = new Player(); calm.reducedMotion = true; calm.steer(.5, 1, 0); expect(calm.yaw).toBeCloseTo(.5 * controls.keyLookRadPerSecond * controls.reducedMotionLookScale, 10);
});
it('reports whether a walk target has a route', () => { const player = new Player(); expect(player.walkTo(-3.5, 1.5)).toBe(true); expect(player.walkTo(-2, -.6)).toBe(false); });
