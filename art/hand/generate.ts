import { Document, Accessor } from '@gltf-transform/core';
import { BufferGeometry, Float32BufferAttribute, Quaternion, Vector3, Uint16BufferAttribute } from 'three';
import { inverseBindMatrices, primitive, saveAsset } from '../../tools/art/gltf.ts';
import { createHandMaterials } from '../../tools/art/materials.ts';

type Point = [number, number, number];
type Four = [number, number, number, number];
const names = ['thumb', 'index', 'middle', 'ring', 'little'];

/** Sewn indexed surfaces; palm and digits share their boundary vertices. */
class Surface {
  points: number[] = []; uvs: number[] = []; joints: number[] = []; weights: number[] = []; faces: number[] = [];
  vertex(p: Point, uv: [number, number], joints: Four = [0, 0, 0, 0], weights: Four = [1, 0, 0, 0]) {
    const id = this.points.length / 3;
    this.points.push(...p); this.uvs.push(...uv); this.joints.push(...joints); this.weights.push(...weights); return id;
  }
  point(id: number): Point { return this.points.slice(id * 3, id * 3 + 3) as Point; }
  weight(id: number, joints: Four, weights: Four) { this.joints.splice(id * 4, 4, ...joints); this.weights.splice(id * 4, 4, ...weights); }
  tri(a: number, b: number, c: number) { if (a !== b && b !== c && a !== c) this.faces.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.tri(a, b, d); this.tri(b, c, d); }
  bridge(a: number[], b: number[]) { for (let i = 0; i < a.length; i++) this.quad(a[i]!, a[(i + 1) % a.length]!, b[(i + 1) % b.length]!, b[i]!); }
  cap(loop: number[]) {
    const mean = loop.map(i => this.point(i)).reduce((a, b) => a.map((v, i) => v + b[i]! / loop.length) as Point, [0, 0, 0] as Point);
    const first = loop[0]!, center = this.vertex(mean, [.5, .5], this.joints.slice(first * 4, first * 4 + 4) as Four, this.weights.slice(first * 4, first * 4 + 4) as Four);
    for (let i = 0; i < loop.length; i++) this.tri(center, loop[i]!, loop[(i + 1) % loop.length]!);
  }
  geometry(expectedComponents = 1) {
    const edges = new Map<string, { face: number; direction: number }[]>();
    for (let f = 0; f < this.faces.length / 3; f++) for (let e = 0; e < 3; e++) {
      const a = this.faces[f * 3 + e]!, b = this.faces[f * 3 + (e + 1) % 3]!, key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const list = edges.get(key) ?? []; list.push({ face: f, direction: a < b ? 1 : -1 }); edges.set(key, list);
    }
    for (const edge of edges.values()) if (edge.length !== 2) throw new Error(`Hand surface has open/nonmanifold edge (${edge.length} faces)`);
    const adjacency = Array.from({ length: this.faces.length / 3 }, () => [] as [number, number][]);
    for (const [a, b] of edges.values()) {
      adjacency[a!.face]!.push([b!.face, a!.direction === b!.direction ? -1 : 1]); adjacency[b!.face]!.push([a!.face, a!.direction === b!.direction ? -1 : 1]);
    }
    const signs = new Int8Array(adjacency.length); let components = 0;
    for (let seed = 0; seed < signs.length; seed++) {
      if (signs[seed]) continue; components++; signs[seed] = 1; const queue = [seed], component: number[] = [];
      for (let q = 0; q < queue.length; q++) {
        const f = queue[q]!; component.push(f);
        for (const [next, sign] of adjacency[f]!) if (!signs[next]) { signs[next] = signs[f]! * sign; queue.push(next); }
      }
      let volume = 0;
      for (const f of component) {
        const a = new Vector3(...this.point(this.faces[f * 3]!)), b = new Vector3(...this.point(this.faces[f * 3 + 1]!)), c = new Vector3(...this.point(this.faces[f * 3 + 2]!));
        volume += a.dot(b.cross(c)) * signs[f]!;
      }
      for (const f of component) if (signs[f]! * volume < 0) [this.faces[f * 3 + 1], this.faces[f * 3 + 2]] = [this.faces[f * 3 + 2]!, this.faces[f * 3 + 1]!];
    }
    if (components !== expectedComponents) throw new Error(`Hand surface has ${components} components; expected ${expectedComponents}`);
    const geo = new BufferGeometry(); geo.setIndex(this.faces); geo.setAttribute('position', new Float32BufferAttribute(this.points, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2)); geo.setAttribute('skinIndex', new Uint16BufferAttribute(this.joints, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(this.weights, 4)); geo.computeVertexNormals(); return geo;
  }
}

export async function makeHand() {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene('Patron first-person arm');
  const wrist = doc.createNode('wrist'); scene.addChild(wrist); const joints = [wrist], worlds: Point[] = [[0, 0, 0]];
  const centers = [-.028, -.0085, .011, .030], radii = [.0091, .0095, .0090, .0074], bases = [.080, .087, .081, .066], lengths = [.071, .079, .074, .059];
  const digits = [
    { start: new Vector3(-.043, 0, .036), direction: new Vector3(-.74, 0, .673).normalize(), length: .062, radius: .0108 },
    ...centers.map((x, i) => ({ start: new Vector3(x, 0, bases[i]!), direction: new Vector3((i - 1.5) * .025, 0, 1).normalize(), length: lengths[i]!, radius: radii[i]! })),
  ];
  for (let f = 0; f < digits.length; f++) {
    const digit = digits[f]!; let parent = wrist;
    for (let k = 0; k < 3; k++) {
      const world = digit.start.clone().addScaledVector(digit.direction, [0, .43, .75][k]! * digit.length), node = doc.createNode(`${names[f]}_${k + 1}`), previous = worlds[joints.indexOf(parent)]!;
      node.setTranslation(world.clone().sub(new Vector3(...previous)).toArray()); parent.addChild(node); joints.push(node); worlds.push(world.toArray()); parent = node;
    }
  }
  const skin = doc.createSkin('Wrist and continuous digits').setSkeleton(wrist).setInverseBindMatrices(doc.createAccessor().setBuffer(buffer).setType(Accessor.Type.MAT4!).setArray(inverseBindMatrices(worlds)));
  joints.forEach(n => skin.addJoint(n)); const surface = new Surface(), nails = new Surface(), cloth = new Surface();
  const columns: { x: number; z: number; y: number }[] = [], fingerColumns: number[][] = [];
  for (let f = 0; f < 4; f++) {
    const indices: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const angle = i / 8 * Math.PI; indices.push(columns.length);
      columns.push({ x: centers[f]! - Math.cos(angle) * radii[f]!, z: bases[f]! + Math.sin(angle) * .002, y: i === 0 || i === 8 ? 0 : Math.sin(angle) * radii[f]! * .88 });
    }
    fingerColumns.push(indices);
    if (f < 3) columns.push({ x: (centers[f]! + radii[f]! + centers[f + 1]! - radii[f + 1]!) / 2, z: Math.min(bases[f]!, bases[f + 1]!) - .009, y: .005 });
  }
  const rows = [0, .012, .025, .040, .055, .067, .078, .087], top: number[][] = [], bottom: number[][] = [];
  for (let r = 0; r < rows.length; r++) {
    const t = r / (rows.length - 1), width = [.025, .029, .034, .038, .040, .040, .039, .038][r]!; top[r] = []; bottom[r] = [];
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c]!, u = (col.x + .0371) / .0745, x = r === rows.length - 1 ? col.x : (u - .5) * width * 2, z = rows[r]! + (col.z - .087) * t ** 4;
      const roundness = Math.sqrt(Math.max(0, 1 - (u * 2 - 1) ** 2)), ridge = .00045 * centers.reduce((sum, center) => sum + Math.exp(-(((x - center) / .004) ** 2)), 0) * t;
      const dorsal = (.007 + .006 * roundness + ridge) * (1 - t ** 8) + col.y * t ** 8, volar = -((.006 + .006 * roundness) * (1 - t ** 8) + col.y * t ** 8);
      top[r]![c] = surface.vertex([x, dorsal, z], [u, z * 8]); bottom[r]![c] = dorsal === 0 && volar === 0 ? top[r]![c]! : surface.vertex([x, volar, z], [u, z * 8]);
      if (r && c) { surface.quad(top[r - 1]![c - 1]!, top[r - 1]![c]!, top[r]![c]!, top[r]![c - 1]!); surface.quad(bottom[r - 1]![c - 1]!, bottom[r - 1]![c]!, bottom[r]![c]!, bottom[r]![c - 1]!); }
    }
  }
  const last = rows.length - 1, edge = columns.length - 1;
  const thumbLow = surface.vertex(new Vector3(...surface.point(top[2]![0]!)).lerp(new Vector3(...surface.point(bottom[2]![0]!)), .5).toArray(), [0, .2]);
  const thumbHigh = surface.vertex(new Vector3(...surface.point(top[4]![0]!)).lerp(new Vector3(...surface.point(bottom[4]![0]!)), .5).toArray(), [0, .5]);
  for (let r = 0; r < last; r++) {
    surface.quad(top[r]![edge]!, top[r + 1]![edge]!, bottom[r + 1]![edge]!, bottom[r]![edge]!);
    if (r >= 2 && r < 4) continue;
    surface.cap([...new Set([top[r]![0]!, top[r + 1]![0]!, ...(r === 1 ? [thumbLow] : []), bottom[r + 1]![0]!, bottom[r]![0]!, ...(r === 4 ? [thumbHigh] : [])])]);
  }
  for (let f = 0; f < 3; f++) {
    const a = fingerColumns[f]!.at(-1)!, b = fingerColumns[f + 1]![0]!;
    for (let c = a; c < b; c++) surface.quad(top[last]![c]!, top[last]![c + 1]!, bottom[last]![c + 1]!, bottom[last]![c]!);
  }
  const thumbLoop = [top[2]![0]!, top[3]![0]!, top[4]![0]!, thumbHigh, bottom[4]![0]!, bottom[3]![0]!, bottom[2]![0]!, thumbLow];
  for (let f = 0; f < digits.length; f++) {
    const digit = digits[f]!, joint = 1 + f * 3, side = new Vector3(digit.direction.z, 0, -digit.direction.x);
    let previous = f === 0 ? thumbLoop : [...fingerColumns[f - 1]!.map(c => top[last]![c]!), ...fingerColumns[f - 1]!.slice(1, -1).reverse().map(c => bottom[last]![c]!)];
    previous.forEach(id => surface.weight(id, [0, joint, 0, 0], [.8, .2, 0, 0])); const count = previous.length;
    for (let ring = 1; ring <= 12; ring++) {
      const t = ring / 12, distance = digit.length * t, profile = Math.sqrt(Math.max(.012, 1 - t ** 4)) * (1 - .30 * t);
      const radius = digit.radius * profile + .0008 * Math.exp(-(((t - .43) / .07) ** 2)) + .0006 * Math.exp(-(((t - .75) / .06) ** 2)), center = digit.start.clone().addScaledVector(digit.direction, distance), loop: number[] = [];
      const segment = t < .43 ? 0 : t < .75 ? 1 : 2, blend = segment === 0 ? Math.max(0, (t - .28) / .15) : segment === 1 ? Math.max(0, (t - .60) / .15) : 0;
      for (let i = 0; i < count; i++) {
        const angle = Math.PI - i / count * Math.PI * 2, p = center.clone().addScaledVector(side, Math.cos(angle) * radius); p.y = Math.sin(angle) * radius * .88;
        loop.push(surface.vertex(p.toArray(), [i / count, distance * 8], [joint + segment, Math.min(joint + 2, joint + segment + 1), 0, 0], [1 - blend, blend, 0, 0]));
      }
      surface.bridge(previous, loop); previous = loop;
    }
    const tip = surface.vertex(digit.start.clone().addScaledVector(digit.direction, digit.length + .0008).toArray(), [.5, digit.length * 8], [joint + 2, 0, 0, 0]);
    for (let i = 0; i < previous.length; i++) surface.tri(previous[i]!, previous[(i + 1) % previous.length]!, tip);
    const nailCenter = digit.start.clone().addScaledVector(digit.direction, digit.length - .0085); nailCenter.y = 0; let nailPrevious: number[] | undefined;
    for (let ring = 0; ring <= 4; ring++) {
      const latitude = -Math.PI / 2 + (ring + .15) / 4.3 * Math.PI, loop: number[] = [];
      for (let i = 0; i < 12; i++) {
        const angle = i / 12 * Math.PI * 2, lateral = Math.cos(angle) * Math.cos(latitude) * digit.radius * .49;
        const p = nailCenter.clone().addScaledVector(side, lateral).addScaledVector(digit.direction, Math.sin(angle) * Math.cos(latitude) * .0065);
        const along = p.clone().sub(digit.start).dot(digit.direction) / digit.length;
        const radius = digit.radius * Math.sqrt(Math.max(.012, 1 - along ** 4)) * (1 - .30 * along);
        p.y = Math.sqrt(Math.max(0, radius ** 2 - lateral ** 2)) * .88 + .00025 + Math.sin(latitude) * .00035;
        loop.push(nails.vertex(p.toArray(), [.5 + Math.cos(angle) * Math.cos(latitude) * .5, .5 + Math.sin(angle) * Math.cos(latitude) * .5], [joint + 2, 0, 0, 0]));
      }
      if (nailPrevious) nails.bridge(nailPrevious, loop); else nails.cap(loop); nailPrevious = loop;
    }
    nails.cap(nailPrevious!);
  }
  const wristLoop = [...top[0]!, ...bottom[0]!.slice().reverse()]; let previous = wristLoop;
  for (let r = 1; r <= 12; r++) {
    const t = r / 12, z = -.22 * t, width = .025 + .016 * Math.sin(t * Math.PI * .65), depth = .014 + .019 * Math.sin(t * Math.PI * .60), loop: number[] = [];
    for (let i = 0; i < wristLoop.length; i++) {
      const p = surface.point(wristLoop[i]!), a = Math.atan2(p[1] / .014, p[0] / .025), blend = Math.min(1, t * 4);
      loop.push(surface.vertex([p[0] * width / .025 * (1 - blend) + Math.cos(a) * width * blend + .014 * t ** 2, p[1] * depth / .014 * (1 - blend) + Math.sin(a) * depth * blend - .012 * t ** 2, z], [i / wristLoop.length, z * 8]));
    }
    surface.bridge(previous, loop); previous = loop;
  }
  surface.cap(previous);
  let clothPrevious: number[] | undefined, clothFirst: number[] | undefined;
  for (let r = 0; r <= 12; r++) {
    const t = r / 12, z = -.155 - .20 * t, width = .044 + .012 * t, depth = .034 + .013 * t, lip = r < 3 ? [.001, .0025, 0][r]! : .0012 * Math.sin(r * 2.1), loop: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * Math.PI * 2, fold = .0016 * Math.cos(a * 5 + t * 8) * Math.sin(t * Math.PI);
      loop.push(cloth.vertex([.008 + .032 * t + Math.cos(a) * (width + lip + fold), -.006 - .050 * t ** 2 + Math.sin(a) * (depth + lip + fold), z], [i / 40, t * 1.7]));
    }
    if (clothPrevious) cloth.bridge(clothPrevious, loop); else clothFirst = loop; clothPrevious = loop;
  }
  const inner = (outer: number[]) => outer.map(i => {
    const p = cloth.point(i), centerX = p[2] < -.3 ? .040 : .008, centerY = p[2] < -.3 ? -.056 : -.006;
    return cloth.vertex([centerX + (p[0] - centerX) * .91, centerY + (p[1] - centerY) * .91, p[2]], [.5, .5]);
  });
  const innerFront = inner(clothFirst!), innerBack = inner(clothPrevious!);
  cloth.bridge(clothFirst!, innerFront); cloth.bridge(innerFront, innerBack); cloth.bridge(innerBack, clothPrevious!);
  const materials = await createHandMaterials(doc);
  for (const [name, source, material] of [['skin', surface, materials.skin], ['sleeve', cloth, materials.sleeve], ['nails', nails, materials.nails]] as const) {
    const geo = source.geometry(name === 'nails' ? 5 : 1); scene.addChild(doc.createNode(name).setSkin(skin).setMesh(doc.createMesh(name).addPrimitive(primitive(doc, geo).setMaterial(material!)))); geo.dispose();
  }
  for (const [pose, curl] of [['open', .025], ['stroke', .25], ['grab', 1.12], ['point', 1]] as const) {
    const animation = doc.createAnimation(`hand.${pose}`), times = doc.createAccessor().setBuffer(buffer).setType(Accessor.Type.SCALAR!).setArray(new Float32Array([0, .3]));
    for (let i = 1; i < joints.length; i++) {
      const thumb = i <= 3, point = pose === 'point' && joints[i]!.getName().startsWith('index'), angle = point ? .03 : curl * (thumb ? .58 : 1) * [1, 1.05, .72][(i - 1) % 3]!;
      const q = new Quaternion().setFromAxisAngle(thumb ? new Vector3(.673, 0, .74) : new Vector3(1, 0, 0), angle).toArray();
      const output = doc.createAccessor().setBuffer(buffer).setType(Accessor.Type.VEC4!).setArray(new Float32Array([...q, ...q])), sampler = doc.createAnimationSampler().setInput(times).setOutput(output).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joints[i]!).setTargetPath('rotation').setSampler(sampler));
    }
  }
  return saveAsset(doc, 'public/assets/art/hand.glb', 8000);
}
