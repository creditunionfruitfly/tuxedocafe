import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, ShaderLib, Texture } from 'three';
import { bakedDiffuseShader, bindCafeBake, makeRoomProbe, validateCafeBake, type CafeBake, type RoomProbe } from '../../src/render/baked-lighting.ts';

function sample(x: number, value: number): RoomProbe {
  return { position: [x, 1.3, 0], sh: Array.from({ length: 9 }, () => [value, value * .8, value * .5]) };
}
const bake: CafeBake = { signature: 'a'.repeat(64), resolution: 2048, exposure: 2,
  probes: [sample(-1, 1), sample(1, 3)], metadata: { colorSpace: 'linear', directIncluded: true, encoding: 'rgbm' } };

it('rejects malformed bake data rather than lighting the cafe with NaNs', () => {
  expect(validateCafeBake(bake)).toBe(bake);
  expect(() => validateCafeBake({ ...bake, exposure: NaN })).toThrow('invalid');
  expect(() => validateCafeBake({ ...bake, probes: [sample(0, NaN)] })).toThrow('invalid');
  expect(() => validateCafeBake({ ...bake, probes: [] })).toThrow('invalid');
});
it('binds a unique second-UV atlas without putting static shadows on a carried prop', () => {
  const root = new Group(), material = new MeshStandardMaterial(), map = new Texture();
  const geometry = new BoxGeometry(); geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  geometry.userData.bakedDaylight = true;
  const fixed = new Mesh(geometry, material), carried = new Mesh(new BoxGeometry(), material);
  root.add(fixed, carried);
  const dispose = bindCafeBake(root, map, bake);
  expect(fixed.material).not.toBe(material); expect(fixed.material.lightMap).toBe(map);
  expect(fixed.material.lightMapIntensity).toBe(2); expect(map.channel).toBe(1); expect(map.flipY).toBe(false);
  expect(carried.material).toBe(material); expect(carried.material.lightMap).toBeNull();
  dispose(); material.dispose(); geometry.dispose(); carried.geometry.dispose();
});
it('keeps GGX lighting in the pinned shader while replacing diffuse light exactly once', () => {
  const fragment = bakedDiffuseShader(ShaderLib.standard.fragmentShader, true);
  expect(fragment).toContain('reflectedLight.directDiffuse = vec3( 0.0 );');
  expect(fragment).toContain('iblIrradiance = vec3( 0.0 );');
  expect(fragment).toContain('lightMapTexel.rgb * lightMapTexel.a * lightMapIntensity');
  expect(fragment).toContain('getIBLRadiance( geometryViewDir');
  expect(bakedDiffuseShader(ShaderLib.standard.fragmentShader, false)).not.toContain('reflectedLight.directDiffuse = vec3( 0.0 );');
  expect(() => bakedDiffuseShader('unsupported shader', true)).toThrow('pinned');
});
it('interpolates actual room radiance probes with bounded finite weights', () => {
  const room = makeRoomProbe(bake.probes);
  room.update(0, 1.3, 0); expect(room.light.sh.coefficients[0]!.x).toBeCloseTo(2);
  room.update(-1, 1.3, 0); expect(room.light.sh.coefficients[0]!.x).toBeLessThan(1.01);
  room.update(100, 1.3, 0);
  for (const c of room.light.sh.coefficients) expect(c.toArray().every(Number.isFinite)).toBe(true);
});
