import {
  BufferGeometry, DataTexture, DoubleSide, Float32BufferAttribute, LinearFilter,
  LinearMipmapLinearFilter, MathUtils, MeshStandardMaterial, ShaderChunk,
  SkinnedMesh, Triangle, Uint16BufferAttribute, Vector3, type Object3D, type Texture,
} from 'three';
import cats from '../../data/cats.json' with { type: 'json' };
import { createRng, type Rng } from '../core/rng.ts';
import type { Tier } from '../core/tiers.ts';

const duchess = cats.cats.find(cat => cat.id === 'duchess')!;
const lengths = duchess.model.coat.furLengthMm;
const regions = [
  { name: 'ruff', desktop: 57, phone: 22, low: 18, length: lengths.chest, width: .010, outward: .38 },
  { name: 'tail', desktop: 70, phone: 23, low: 21, length: lengths.tail, width: .008, outward: .44 },
  { name: 'britches', desktop: 32, phone: 11, low: 8, length: lengths.britches!, width: .009, outward: .35 },
  { name: 'cheeks', desktop: 25, phone: 8, low: 6, length: lengths.cheeks, width: .006, outward: .32 },
  { name: 'ears', desktop: 16, phone: 6, low: 4, length: 13, width: .003, outward: .22 },
  { name: 'body', desktop: 22, phone: 7, low: 5, length: lengths.body, width: .008, outward: .22 },
] as const;

type Region = typeof regions[number]['name'];
interface Face { vertices: [number, number, number]; end: number }
type Disposable = { dispose(): void };

function regionOf({ x, y, z }: Vector3): Region | undefined {
  const side = Math.abs(x);
  if (z < -.229) return 'tail';
  if (y > .337 && z > .167 && z < .212 && side > .012) return 'ears';
  if (y > .264 && y < .316 && z > .162 && z < .222 && side > .031) return 'cheeks';
  if (z > .093 && z < .205 && y > .151 && y < .291) return 'ruff';
  if (z < -.107 && y > .091 && y < .227 && side > .028) return 'britches';
  if (y > .158 && y < .286 && side > .038 && z > -.192 && z < .102) return 'body';
}

function strandAlpha(): DataTexture {
  const width = 64, height = 64, pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const v = (row + .5) / height;
    for (let col = 0; col < width; col++) {
      const u = (col + .5) / width;
      const across = u - .5 + .025 * Math.sin(6 * v);
      const fibers = .60 * Math.sin(78 * u + 2 * v) + .40 * Math.sin(163 * u - 4 * v);
      const taper = .48 - .27 * v ** 1.5 + .053 * fibers;
      const edge = 1 - MathUtils.smoothstep(Math.abs(across), taper - .17, taper);
      const root = MathUtils.smoothstep(v, .05, .32);
      const tip = 1 - MathUtils.smoothstep(v, .51 + .09 * fibers, .98);
      const offset = (row * width + col) * 4;
      pixels.fill(Math.round(232 * root * edge * tip * (.77 + .23 * fibers)), offset, offset + 4);
    }
  }
  const texture = new DataTexture(pixels, width, height);
  texture.channel = 1;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function peltVolume({ x, y, z }: Vector3): number {
  const ramp = MathUtils.smoothstep;
  const flank = ramp(y, .12, .22) * (1 - ramp(z, .113, .166)) * ramp(z, -.232, -.186);
  const ruff = ramp(z, .095, .161) * (1 - ramp(z, .192, .226)) *
    ramp(y, .130, .203) * (1 - ramp(y, .259, .318));
  const cheeks = ramp(Math.abs(x), .022, .042) * ramp(z, .151, .181) * (1 - ramp(z, .214, .235)) *
    ramp(y, .258, .282) * (1 - ramp(y, .308, .335));
  const britches = (1 - ramp(z, -.143, -.091)) * ramp(y, .077, .142) * (1 - ramp(y, .164, .239));
  const tail = (1 - ramp(z, -.263, -.229)) * ramp(y, .050, .113);
  return Math.max(.0048 * flank, .014 * ruff, .0075 * cheeks, .010 * britches, .013 * tail);
}

/** Share the other master buffers and give Duchess her own resting pelt contour. */
function shapePelt(source: SkinnedMesh, owned?: Set<Disposable>): void {
  const base = source.geometry, pelt = new BufferGeometry();
  const { position, normal, _surface: surface } = base.attributes;
  const grown = new Float32Array(position!.count * 3);
  const point = new Vector3(), outward = new Vector3();
  for (let i = 0; i < position!.count; i++) {
    point.fromBufferAttribute(position!, i);
    if (!surface || surface.getX(i) < .5)
      point.addScaledVector(outward.fromBufferAttribute(normal!, i), peltVolume(point));
    point.toArray(grown, i * 3);
  }
  for (const [name, attribute] of Object.entries(base.attributes)) pelt.setAttribute(name, attribute);
  pelt.setAttribute('position', new Float32BufferAttribute(grown, 3));
  pelt.setIndex(base.index);
  pelt.morphAttributes = base.morphAttributes;
  pelt.morphTargetsRelative = base.morphTargetsRelative;
  source.geometry = pelt;
  owned?.add(pelt);
}

function groom(region: Region, origin: Vector3, rng: Rng): Vector3 {
  const side = Math.sign(origin.x);
  if (region === 'tail') return new Vector3(side * .16, -.40 - .54 * (1 - MathUtils.smoothstep(origin.y, .09, .22)), -.84);
  if (region === 'ears') return new Vector3(-side * .32, .74, .23);
  if (region === 'body') return new Vector3(side * .15, -.48, -.78);
  return new Vector3(side * rng.range(.20, .53), -1, region === 'ruff' ? .38 : -.34);
}

/** Root each ribbon to the rest pelt and bind it to the same joints as that patch. */
export function addDuchessFur(root: Object3D, tier: Tier, map: Texture, owned?: Set<Disposable>): void {
  let body: SkinnedMesh | undefined;
  root.traverse(node => {
    if (node instanceof SkinnedMesh && node.material instanceof MeshStandardMaterial &&
        node.material.name === 'cat_fur') body = node;
  });
  if (!body) return;
  const source = body;
  const geometry = source.geometry;
  const { position, normal, uv, skinIndex, skinWeight, _surface: surface } = geometry.attributes;
  const index = geometry.index!;
  const patches = new Map(regions.map(patch => [patch.name, { faces: [] as Face[], area: 0 }]));
  const triangle = new Triangle(), center = new Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const vertices: Face['vertices'] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const [a, b, c] = vertices;
    if (surface && vertices.some(vertex => surface.getX(vertex) > .5)) continue;
    triangle.a.fromBufferAttribute(position!, a);
    triangle.b.fromBufferAttribute(position!, b);
    triangle.c.fromBufferAttribute(position!, c);
    const region = regionOf(triangle.getMidpoint(center));
    if (!region) continue;
    const patch = patches.get(region)!;
    const end = patch.area + triangle.getArea();
    if (end <= patch.area) continue;
    patch.area = end;
    patch.faces.push({ vertices, end });
  }

  shapePelt(source, owned);
  const grown = source.geometry.attributes.position!;
  const rng = createRng('duchess-longhair');
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], alphaUVs: number[] = [];
  const joints: number[] = [], weights: number[] = [], indices: number[] = [];
  const furTier = tier === 'high' ? 'desktop' : tier;
  const origin = new Vector3(), outward = new Vector3(), sample = new Vector3();
  const tip = new Vector3(), across = new Vector3(), point = new Vector3();
  const fat = source.morphTargetDictionary?.bodyFat;
  const fatDelta = fat === undefined ? undefined : geometry.morphAttributes.position?.[fat];
  const fatWeight = fat === undefined ? 0 : (source.morphTargetInfluences?.[fat] ?? 0);
  for (const patch of regions) {
    const { faces, area } = patches.get(patch.name)!;
    if (faces.length === 0) continue;
    let face = 0;
    const count = patch[furTier];
    for (let card = 0; card < count; card++) {
      const pick = (card + rng.next()) * area / count;
      while (faces[face]!.end < pick) face++;
      const radius = Math.sqrt(rng.next()), blend = rng.next();
      const bary = [1 - radius, radius * (1 - blend), radius * blend];
      origin.set(0, 0, 0);
      outward.set(0, 0, 0);
      let u = 0, v = 0;
      const influences = new Map<number, number>();
      for (const [corner, vertex] of faces[face]!.vertices.entries()) {
        const factor = bary[corner]!;
        origin.addScaledVector(sample.fromBufferAttribute(grown, vertex), factor);
        if (fatDelta && fatWeight && geometry.morphTargetsRelative)
          origin.addScaledVector(sample.fromBufferAttribute(fatDelta, vertex), factor * fatWeight);
        outward.addScaledVector(sample.fromBufferAttribute(normal!, vertex), factor);
        u += uv!.getX(vertex) * factor;
        v += uv!.getY(vertex) * factor;
        for (let i = 0; i < 4; i++) {
          const joint = skinIndex!.getComponent(vertex, i), weight = skinWeight!.getComponent(vertex, i) * factor;
          influences.set(joint, (influences.get(joint) ?? 0) + weight);
        }
      }
      const skin = [...influences].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = skin.reduce((sum, value) => sum + value[1], 0);
      outward.normalize();
      const flow = groom(patch.name, origin, rng).projectOnPlane(outward).normalize();
      tip.copy(flow).addScaledVector(outward, patch.outward);
      across.crossVectors(outward, tip).normalize().applyAxisAngle(tip.normalize(), rng.range(-.92, .92));
      const length = patch.length * .001 * rng.range(.64, .91);
      const width = patch.width * rng.range(.73, 1.19);
      const base = positions.length / 3;
      for (const [row, t] of [0, .46, 1].entries()) {
        point.copy(origin).addScaledVector(flow, length * (.49 * t + .31 * t * t))
          .addScaledVector(outward, length * patch.outward * (1.30 * t - .30 * t * t) - .0007);
        const spread = width * [.65, 1, .46][row]!;
        for (const side of [-1, 1]) {
          positions.push(point.x + side * spread * across.x, point.y + side * spread * across.y, point.z + side * spread * across.z);
          normals.push(outward.x, outward.y, outward.z);
          uvs.push(u, v);
          alphaUVs.push(side === -1 ? 0 : 1, t);
          for (let i = 0; i < 4; i++) {
            joints.push(skin[i]?.[0] ?? 0);
            weights.push((skin[i]?.[1] ?? 0) / total);
          }
        }
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2,
        base + 2, base + 3, base + 4, base + 3, base + 5, base + 4);
    }
  }
  const cards = new BufferGeometry();
  cards.setAttribute('position', new Float32BufferAttribute(positions, 3));
  cards.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  cards.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  cards.setAttribute('uv1', new Float32BufferAttribute(alphaUVs, 2));
  cards.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
  cards.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  cards.setIndex(indices);
  const alphaMap = strandAlpha();
  const material = new MeshStandardMaterial({
    map, alphaMap, alphaTest: .025, side: DoubleSide, roughness: .84,
    transparent: true, depthWrite: false, forceSinglePass: true,
  });
  material.onBeforeCompile = shader => {
    // Both sides use the outward pelt normal inherited from the root.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  const mesh = new SkinnedMesh(cards, material);
  mesh.name = 'duchess_fur';
  mesh.frustumCulled = false;
  source.add(mesh);
  mesh.bind(source.skeleton, source.bindMatrix);
  owned?.add(cards).add(material).add(alphaMap);
}
