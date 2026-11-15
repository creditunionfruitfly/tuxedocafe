import { expect, it } from 'vitest';
import {
  Bone, BufferGeometry, Float32BufferAttribute, Group, MeshStandardMaterial,
  Skeleton, SkinnedMesh, Texture, Uint16BufferAttribute, Vector3,
} from 'three';
import { addDuchessFur } from '../../src/cats/duchess-fur.ts';

it('binds the phone plume to the animated surface and leaves leather uncovered', () => {
  const geometry = new BufferGeometry();
  const position = [.01, .19, -.28, .018, .17, -.28, .013, .17, -.30];
  geometry.setAttribute('position', new Float32BufferAttribute([...position, ...position], 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(Array.from({ length: 6 }, () => [1, 0, 0]).flat(), 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(Array(12).fill(.5), 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array(24).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: 6 }, () => [1, 0, 0, 0]).flat(), 4));
  geometry.setAttribute('_surface', new Float32BufferAttribute([0, 0, 0, 1, 1, 1], 1));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const root = new Group(), joint = new Bone(), map = new Texture();
  const body = new SkinnedMesh(geometry, new MeshStandardMaterial({ name: 'cat_fur' }));
  root.add(body, joint);
  body.bind(new Skeleton([joint]));
  const owned = new Set<{ dispose(): void }>();
  addDuchessFur(root, 'phone', map, owned);
  const fur = body.getObjectByName('duchess_fur') as SkinnedMesh;
  expect(fur.skeleton).toBe(body.skeleton);
  expect(fur.geometry.index?.count).toBe(23 * 4 * 3);
  expect(owned.size).toBe(4);
  expect(body.geometry.attributes.uv).toBe(geometry.attributes.uv);
  expect(body.geometry.attributes.position!.getX(0)).toBeGreaterThan(position[0]!);
  expect(body.geometry.attributes.position!.getX(3)).toBeCloseTo(position[0]!);
  const start = fur.getVertexPosition(5, new Vector3());
  joint.position.y += .02;
  root.updateMatrixWorld(true);
  expect(fur.getVertexPosition(5, new Vector3()).y - start.y).toBeCloseTo(.02);
  for (const resource of owned) resource.dispose();
  geometry.dispose();
  body.material.dispose();
  map.dispose();
});
