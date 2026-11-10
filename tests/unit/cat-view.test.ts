import { expect, it } from 'vitest';
import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Resident } from '../../src/cats/resident.ts';
import { CatView } from '../../src/scenes/cat-view.ts';
import { Player } from '../../src/scenes/player.ts';

it('follows moving and turning eyes with damping while leaving the patron camera parked', () => {
  const playerCamera = new PerspectiveCamera(61, 2, .04, 60);
  playerCamera.position.set(2, 1.6, -3); playerCamera.rotation.set(.22, 1, 0);
  const savedPosition = playerCamera.position.clone(), savedFacing = playerCamera.quaternion.clone();
  const view = new CatView(playerCamera), root = new Object3D(), eye = new Vector3(0, .32, -1), facing = new Quaternion();
  const target = { root, eyes: (position: Vector3, orientation: Quaternion) => { position.copy(eye); orientation.copy(facing); } } as Resident;
  view.enter(target);
  expect(view.camera.position.equals(eye)).toBe(true); expect(view.camera.fov).toBe(75); expect(root.visible).toBe(false);
  eye.set(.8, .12, -2); facing.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  view.render(1 / 60, 2, false);
  expect(view.camera.position.x).toBeGreaterThan(0); expect(view.camera.position.x).toBeLessThan(eye.x);
  expect(new Quaternion().angleTo(view.camera.quaternion)).toBeLessThan(.05);
  for (let i = 0; i < 180; i++) view.render(1 / 60, 2, true);
  expect(view.camera.position.distanceTo(eye)).toBeLessThan(.001); expect(view.camera.quaternion.angleTo(facing)).toBeLessThan(.02);
  view.exit(); expect(root.visible).toBe(true); expect(view.target).toBeNull();
  expect(playerCamera.position.equals(savedPosition)).toBe(true); expect(playerCamera.quaternion.equals(savedFacing)).toBe(true); expect(playerCamera.fov).toBe(61);
});

it('cancels a pending walk without shifting the patron position, lean or facing', () => {
  const player = new Player(); player.yaw = .5; player.pitch = -.4; player.lean = .1;
  expect(player.walkTo(0, .8)).toBe(true); player.step(1 / 30, 0, 0);
  const saved = [player.x, player.z, player.yaw, player.pitch, player.lean];
  player.park(); player.step(1 / 30, 0, 0);
  expect([player.x, player.z, player.yaw, player.pitch, player.lean]).toEqual(saved);
  expect(player.previousX).toBe(player.x); expect(player.previousZ).toBe(player.z);
});
