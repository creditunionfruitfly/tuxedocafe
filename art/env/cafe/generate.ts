import { Document } from '@gltf-transform/core';
import { BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, BufferGeometry, Vector3, Quaternion,
  Shape, ExtrudeGeometry, CatmullRomCurve3, TubeGeometry, CurvePath, LineCurve3, CubicBezierCurve3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { primitive, saveAsset } from '../../../tools/art/gltf.ts';
import { createCafeMaterials, applySurfaceUV } from '../../../tools/art/materials.ts';
import { applyCafeLightBake } from '../../../tools/art/bake-cafe.ts';
import { assertContact, assertEnclosed, assertPostUnderDeck, assertSurfaceUV } from './geometry-qa.ts';

type P = [number, number, number];
const palette = {
  plaster: [0.92, .875, .78], oak: [.54, .34, .19], oakLight: [.65, .45, .28],
  oakPale: [.72, .52, .34], oakDark: [.41, .25, .15], lagoon: [.055, .28, .26],
  teal: [.10, .43, .39], brass: [.63, .46, .22], cream: [.97, .94, .85],
  charcoal: [.075, .095, .09], terracotta: [.63, .26, .15], leaf: [.15, .34, .14],
  leafLight: [.34, .48, .19], sky: [.62, .79, .82], glass: [.35, .62, .61],
  coffee: [.16, .065, .03], pastry: [.7, .43, .17], light: [1, .86, .57], rug: [.68, .70, .54],
  sisal: [.77, .67, .49], stone: [.86, .84, .76],
  paintLagoon: [.055, .28, .26], paintTeal: [.10, .43, .39],
} satisfies Record<string, P>;
type Color = keyof typeof palette;

export async function makeCafe() {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Tuxedo Cafe · conservatory');
  const materials = await createCafeMaterials(doc);
  const groups = new Map<string, Map<Color, BufferGeometry[]>>();
  let group = 'architecture';
  const add = (geo: BufferGeometry, color: Color, pos: P, rot: P = [0, 0, 0]) => {
    if (geo.index) { const expanded = geo.toNonIndexed(); geo.dispose(); geo = expanded; }
    applySurfaceUV(geo, color);
    assertSurfaceUV(`${group}/${color}`, geo);
    geo.rotateX(rot[0]); geo.rotateY(rot[1]); geo.rotateZ(rot[2]); geo.translate(...pos);
    if (!groups.has(group)) groups.set(group, new Map());
    const map = groups.get(group)!;
    if (!map.has(color)) map.set(color, []);
    map.get(color)!.push(geo);
    return geo;
  };
  const box = (size: P, color: Color, pos: P, round = 0, rot: P = [0, 0, 0]) =>
    add(round ? new RoundedBoxGeometry(...size, 2, round) : new BoxGeometry(...size), color, pos, rot);
  const cyl = (r: number, h: number, color: Color, pos: P, rt = r, rot: P = [0, 0, 0]) =>
    add(new CylinderGeometry(rt, r, h, r >= .25 ? 64 : r >= .07 ? 32 : 20), color, pos, rot);
  const ball = (size: P, color: Color, pos: P, rot: P = [0, 0, 0]) => {
    const geo = new SphereGeometry(1, 20, 12); geo.scale(...size); return add(geo, color, pos, rot);
  };
  const ring = (r: number, tube: number, color: Color, pos: P, rot: P = [Math.PI / 2, 0, 0], arc = Math.PI * 2) =>
    add(new TorusGeometry(r, tube, 8, r > .1 ? 48 : 24, arc), color, pos, rot);
  const beam = (a: P, b: P, radius: number, color: Color) => {
    const start = new Vector3(...a), end = new Vector3(...b), direction = end.clone().sub(start);
    const geo = new CylinderGeometry(radius, radius, direction.length(), 16);
    geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()));
    return add(geo, color, start.add(end).multiplyScalar(.5).toArray() as P);
  };

  // Real gaps, beveled profiles and staggered plank lengths catch grazing light.
  box([10, .10, 8], 'oakDark', [0, -.08, -1]);
  for (let row = 0; row < 40; row++) for (let col = 0; col < 8; col++) {
    const x = -4.875 + row * .25, z = -4.5 + col;
    box([.242, .025, .987], (['oak', 'oakLight', 'oakPale'] as const)[(row * 7 + col * 3 + row % 3) % 3]!, [x, -.016, z]);
  }
  box([.16, 3.35, 8.1], 'plaster', [-5.03, 1.65, -1]);
  box([.16, 3.35, 8.1], 'plaster', [5.03, 1.65, -1]);
  box([10, .85, .16], 'plaster', [0, .41, -5]);
  box([10, .55, .16], 'plaster', [0, 3.08, -5]);
  box([4.8, 2.0, .16], 'plaster', [-2.6, 1.82, -5]);
  box([.85, 2, .16], 'plaster', [4.6, 1.82, -5]);
  box([10, .12, 8.1], 'cream', [0, 3.38, -1]);
  box([12, 4, .03], 'sky', [0, 1.9, -8.8]);
  box([7, .04, 3], 'plaster', [1.5, -.02, -6.5]);
  box([7, .65, .16], 'oakPale', [1.5, .325, -8]);
  for (const x of [.05, 2.05, 4.05]) {
    box([.07, 2, .22], 'oakDark', [x, 1.82, -4.98]);
    box([2.04, .08, .22], 'oakDark', [x + 1, .85, -4.98]);
    box([2.04, .08, .22], 'oakDark', [x + 1, 2.8, -4.98]);
  }
  box([4.12, .10, .5], 'oakLight', [2.05, .82, -4.8], .025);
  for (const x of [-4.95, 4.95]) {
    box([.09, .18, 8], 'oakDark', [x, .09, -1]);
    box([.1, .035, 8], 'brass', [x, .95, -1]);
  }
  for (let z = -4.8; z < 3; z += .48) box([.065, 1.0, .035], 'oakLight', [-4.93, .5, z]);
  for (let x = -4.8; x < 5; x += .65) box([.075, .10, 8], 'oakLight', [x, 3.25, -1]);
  // Entry wall behind the patron closes the room for 360° look. It stays out of the
  // static bake (probe-lit like the bowls) until the next Cycles rebake.
  group = 'entry';
  for (const side of [-1, 1]) {
    box([4.51, 3.35, .16], 'plaster', [side * 2.855, 1.65, 3.03]);
    box([4.215, .18, .09], 'oakDark', [side * 2.7975, .09, 2.905]);
    box([4.215, .035, .1], 'brass', [side * 2.7975, .95, 2.9]);
    box([.09, 2.3, .22], 'oakDark', [side * .645, 1.15, 3.03]);
  }
  box([1.2, 1.1, .16], 'plaster', [0, 2.775, 3.03]);
  box([1.38, .09, .22], 'oakDark', [0, 2.27, 3.03]);
  const door = box([1.2, 2.22, .05], 'oak', [0, 1.11, 3.0]);
  box([.78, 1.18, .02], 'oakDark', [0, 1.5, 2.966]);
  box([.7, 1.1, .02], 'glass', [0, 1.5, 2.956]);
  const handle = cyl(.02, .05, 'brass', [.42, 1.05, 2.955], .02, [Math.PI / 2, 0, 0]);
  assertContact('entry door/handle', door, handle);
  cyl(.016, .2, 'brass', [.42, 1.05, 2.93], .016, [0, 0, Math.PI / 2]);
  // Chalk menu board and coat rail keep the far side of the room readable.
  box([1.1, .8, .05], 'oakDark', [-2.6, 1.6, 2.925]);
  box([1.0, .7, .02], 'charcoal', [-2.6, 1.6, 2.89]);
  for (let i = 0; i < 4; i++) box([.6 - i * .08, .02, .005], 'plaster', [-2.6, 1.82 - i * .13, 2.878]);
  const rail = box([1.2, .12, .03], 'oak', [2.6, 1.75, 2.935]);
  for (const x of [2.15, 2.45, 2.75, 3.05]) {
    const hook = beam([x, 1.75, 2.925], [x, 1.8, 2.85], .012, 'brass');
    assertContact('entry coat hook/rail', rail, hook);
    ball([.022, .022, .022], 'brass', [x, 1.8, 2.85]);
  }
  group = 'architecture';
  // Window banquette, upholstered channel seams and brass feet.
  const banquetteSeat = box([3.4, .46, .65], 'lagoon', [2.0, .34, -4.45], .065);
  const banquetteBack = box([3.4, .58, .16], 'teal', [2.0, .855, -4.72], .045);
  assertContact('banquette back/seat', banquetteSeat, banquetteBack);
  for (let x = .5; x < 3.7; x += .22) box([.012, .43, .03], 'lagoon', [x, .85, -4.62]);
  for (const x of [.55, 3.5]) cyl(.025, .2, 'brass', [x, .1, -4.18]);
  // Fluted coffee counter, stone lip, joinery and espresso equipment.
  box([3.6, .94, .88], 'paintLagoon', [-2.8, .47, -4.2], .045);
  for (let x = -4.52; x < -1.05; x += .10) cyl(.037, .82, 'oakLight', [x, .48, -3.735]);
  box([3.76, .10, 1.0], 'stone', [-2.8, .99, -4.16], .04);
  box([3.65, .03, .025], 'brass', [-2.8, .19, -3.69]);
  box([.9, .45, .46], 'charcoal', [-3.65, 1.28, -4.24], .035);
  box([.84, .1, .54], 'brass', [-3.65, 1.06, -4.19], .018);
  box([.82, .27, .015], 'brass', [-3.65, 1.3, -4.002], .012);
  box([.23, .11, .018], 'charcoal', [-3.65, 1.37, -3.99], .008);
  for (let i = 0; i < 5; i++) cyl(.009, .011, i === 0 ? 'light' : 'cream', [-3.77 + i * .06, 1.29, -3.982], .009, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 13; i++) box([.012, .008, .26], 'charcoal', [-4.02 + i * .06, 1.115, -3.95]);
  for (const x of [-3.85, -3.47]) {
    cyl(.055, .18, 'brass', [x, 1.27, -3.94]);
    cyl(.09, .035, 'charcoal', [x + .09, 1.21, -3.94], .07, [0, 0, Math.PI / 2]);
    cyl(.047, .10, 'cream', [x, 1.1, -3.88], .06);
  }
  for (let i = 0; i < 5; i++) {
    cyl(.075, .035, 'cream', [-4.1, 1.52 + i * .035, -4.23]);
    cyl(.048, .09, 'cream', [-3.55 + (i % 3) * .15, 1.5475, -4.24]);
  }
  // Sink and articulated goose-neck tap at the engine proxy coordinates.
  group = 'sink';
  box([.72, .065, .65], 'brass', [-2, 1.07, -3.68], .035);
  box([.58, .018, .47], 'charcoal', [-2, 1.105, -3.68], .035);
  for (const dx of [-.30, .30]) box([.025, .035, .5], 'brass', [-2 + dx, 1.113, -3.68], .009);
  for (const z of [-3.93, -3.43]) box([.61, .035, .025], 'brass', [-2, 1.113, z], .009);
  cyl(.035, .004, 'brass', [-2, 1.117, -3.68]);
  group = 'tap';
  const tapPath = new CurvePath<Vector3>();
  tapPath.add(new LineCurve3(new Vector3(-2, 1.1, -3.92), new Vector3(-2, 1.38, -3.92)));
  tapPath.add(new CubicBezierCurve3(new Vector3(-2, 1.38, -3.92), new Vector3(-2, 1.57, -3.92),
    new Vector3(-2, 1.57, -3.68), new Vector3(-2, 1.38, -3.68)));
  tapPath.add(new LineCurve3(new Vector3(-2, 1.38, -3.68), new Vector3(-2, 1.29, -3.68)));
  const tap = add(new TubeGeometry(tapPath, 40, .023, 10, false), 'brass', [0, 0, 0]);
  const tapFoot = cyl(.048, .038, 'brass', [-2, 1.12, -3.92]);
  const nozzle = cyl(.028, .045, 'brass', [-2, 1.30, -3.68]);
  assertContact('tap continuous foot', tap, tapFoot); assertContact('tap outlet', tap, nozzle);
  beam([-1.96, 1.13, -3.92], [-1.88, 1.23, -3.92], .012, 'brass');
  ring(.022, .005, 'charcoal', [-2, 1.278, -3.68]);
  group = 'architecture';
  // Shelves and a pastry display. Clear acrylic is represented by teal edging.
  for (const y of [1.55, 2.1]) {
    box([2.55, .065, .32], 'oakLight', [-3.35, y, -4.76], .02);
    for (const x of [-4.35, -2.35]) {
      box([.035, .2, .025], 'brass', [x, y - .09, -4.91]);
      beam([x, y - .18, -4.91], [x, y - .025, -4.62], .012, 'brass');
    }
    for (let i = 0; i < 8; i++) cyl(.045, .11, 'cream', [-4.35 + i * .19, y + .085, -4.73], .06);
  }
  box([.63, .05, .48], 'oakLight', [-1.38, 1.08, -4.14], .02);
  for (const x of [-1.66, -1.1]) for (const z of [-4.35, -3.93]) box([.018, .35, .018], 'glass', [x, 1.27, z]);
  box([.65, .025, .50], 'glass', [-1.38, 1.45, -4.14]);
  for (let i = 0; i < 4; i++) ball([.08, .055, .045], 'pastry', [-1.57 + (i % 2) * .25, 1.14, -4.26 + Math.floor(i / 2) * .24]);

  const chair = (x: number, z: number, angle: number) => {
    const local = (p: P): P => [x + p[0] * Math.cos(angle) + p[2] * Math.sin(angle), p[1],
      z - p[0] * Math.sin(angle) + p[2] * Math.cos(angle)];
    const shell = cyl(.29, .06, 'oakDark', [x, .415, z]);
    const cushion = cyl(.275, .065, 'teal', [x, .472, z], .265);
    assertContact('chair cushion/seat shell', shell, cushion);
    ring(.265, .006, 'lagoon', [x, .499, z]);
    // A closed bent-plywood shell, upholstered on its inner face. The rear legs
    // continue through the seat to the back; there are no suspended torus arcs.
    const backPanel = (inner: number, outer: number, y: number, height: number, color: Color, inset = 0) => {
      const shape = new Shape();
      shape.moveTo(outer * Math.cos(inset), outer * Math.sin(inset));
      shape.absarc(0, 0, outer, inset, Math.PI - inset, false);
      shape.lineTo(inner * Math.cos(Math.PI - inset), inner * Math.sin(Math.PI - inset));
      shape.absarc(0, 0, inner, Math.PI - inset, inset, true); shape.closePath();
      const geo = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelSize: .004,
        bevelThickness: .004, bevelSegments: 2, curveSegments: 20, steps: 1 });
      geo.rotateX(-Math.PI / 2);
      return add(geo, color, [x, y, z], [0, angle, 0]);
    };
    const back = backPanel(.307, .335, .645, .25, 'oakDark');
    backPanel(.278, .309, .665, .205, 'teal', .15);
    for (const y of [.67, .867]) {
      const path = Array.from({ length: 25 }, (_, i) => {
        const a = .15 + i / 24 * (Math.PI - .3);
        return new Vector3(...local([.279 * Math.cos(a), y, -.279 * Math.sin(a)]));
      });
      add(new TubeGeometry(new CatmullRomCurve3(path), 24, .004, 4, false), 'lagoon', [0, 0, 0]);
    }
    for (const side of [-1, 1]) {
      const rear = beam(local([side * .19, .015, -.16]), local([side * .24, .735, -.22]), .022, 'oakDark');
      const front = beam(local([side * .23, .015, .20]), local([side * .18, .438, .16]), .021, 'oakDark');
      assertContact('chair rear leg/seat', rear, shell); assertContact('chair rear leg/back', rear, back);
      assertContact('chair front leg/seat', front, shell);
      beam(local([side * .195, .27, -.17]), local([side * .20, .27, .175]), .012, 'brass');
      cyl(.023, .025, 'charcoal', local([side * .19, .009, -.16]));
      cyl(.023, .025, 'charcoal', local([side * .23, .009, .20]));
    }
  };
  for (const [i, x, z] of [[1, -2, -.6], [2, .5, -3.1]]) {
    group = `table-${i}`;
    const top = cyl(.66, .065, 'oakPale', [x!, .76, z!]); ring(.64, .012, 'brass', [x!, .795, z!]);
    const pedestal = cyl(.07, .72, 'paintLagoon', [x!, .385, z!], .09);
    const base = cyl(.32, .04, 'brass', [x!, .018, z!], .29);
    const socket = cyl(.14, .035, 'charcoal', [x!, .724, z!], .16);
    assertContact('table pedestal/base', pedestal, base); assertContact('table mounting socket', pedestal, socket);
    assertContact('table top/socket', top, socket);
    cyl(.105, .018, 'cream', [x! + .23, .805, z!]); cyl(.065, .10, 'cream', [x! + .23, .86, z!], .08);
    ring(.045, .012, 'cream', [x! + .315, .86, z!], [0, 0, 0]);
    cyl(.06, .007, 'coffee', [x! + .23, .915, z!]);
    group = 'architecture';
    chair(x! - .95, z!, Math.PI / 2); chair(x! + .95, z!, -Math.PI / 2);
  }
  // Pendant shades with visible luminous diffusers; no extra dynamic lights.
  for (const [x, z] of [[-2, -.6], [.5, -3.1], [-3.5, -3.6]]) {
    cyl(.008, .6, 'charcoal', [x!, 2.99, z!]);
    cyl(.30, .20, 'paintLagoon', [x!, 2.61, z!], .12);
    cyl(.28, .012, 'light', [x!, 2.50, z!]); ring(.29, .014, 'brass', [x!, 2.50, z!]);
  }
  // Soft leaf-shaped rug in the play area with nested stitched rings.
  cyl(.95, .012, 'rug', [3.4, .012, -.3]);
  for (const r of [.82, .87, .91]) ring(r, .006, 'cream', [3.4, .021, -.3]);
  group = 'cat-tree';
  const treeBase = cyl(.52, .10, 'oakLight', [3.7, .048, -2.2]);
  const posts: { geo: BufferGeometry; start: P; end: P }[] = [];
  for (const [x, z, top] of [[3.48, -2.25, 1.745], [3.92, -2.15, .605]]) {
    const start: P = [x!, .08, z!], end: P = [x!, top!, z!];
    const post = cyl(.073, top! - .08, 'sisal', [x!, (top! + .08) / 2, z!]);
    posts.push({ geo: post, start, end }); assertContact('cat-tree base/post', treeBase, post);
    // Tactile fiber comes from the sisal normal map. Real end collars and sockets
    // retain silhouette detail without spending tens of thousands of rope tris.
    for (const y of [.115, top! - .025]) {
      cyl(.091, .035, 'oakDark', [x!, y, z!]); ring(.080, .008, 'oakPale', [x!, y, z!]);
    }
  }
  for (const [i, x, y, z] of [[0, 3.92, .62, -2.15], [1, 3.6, 1.2, -2.2], [2, 3.45, 1.77, -2.25]]) {
    const center: P = [x!, y!, z!], post = posts[i === 0 ? 1 : 0]!;
    const deck = cyl(.34, .08, 'oakLight', center);
    const cushion = cyl(.306, .07, 'teal', [x!, y! + .07, z!], .293);
    assertContact('perch cushion/deck', deck, cushion); assertContact('perch deck/support', deck, post.geo);
    assertPostUnderDeck(`perch-${i}`, center, .34, post.start, post.end, .08);
    ring(.301, .007, 'lagoon', [x!, y! + .083, z!]);
    ring(.281, .028, 'teal', [x!, y! + .117, z!]);
    ring(.285, .004, 'lagoon', [x!, y! + .140, z!]);
    cyl(.11, .025, 'oakDark', [post.start[0], y! - .045, post.start[2]]);
    for (const dx of [-.11, .11]) for (const dz of [-.11, .11]) cyl(.009, .006, 'lagoon', [x! + dx, y! + .106, z! + dz]);
  }
  // Bowls are separate nodes, with pivots at their contact points for carrying.
  for (const [id, x, color] of [['water-bowl', 1.4, 'paintTeal'], ['food-bowl', 1.9, 'terracotta']] as const) {
    group = id;
    cyl(.17, .08, color, [x, .04, -.7], .19); ring(.185, .018, 'cream', [x, .083, -.7]);
    cyl(.16, .005, id === 'water-bowl' ? 'glass' : 'coffee', [x, .078, -.7]);
  }
  for (const [i, z] of [[1, -3.6], [2, -4.3]]) {
    group = `litter-${i}`;
    box([.65, .15, .52], 'cream', [4.25, .075, z!], .045);
    box([.53, .02, .4], 'oakPale', [4.25, .15, z!], .025);
  }
  group = 'bin'; cyl(.16, .48, 'paintLagoon', [-4.65, .24, -3.25]); cyl(.17, .04, 'brass', [-4.65, .5, -3.25]);
  group = 'scoop'; box([.10, .02, .13], 'brass', [4.65, .3, -3.9], .015); box([.025, .02, .28], 'oakDark', [4.65, .3, -4.08]);
  group = 'architecture';
  const plant = (x: number, y: number, z: number, size: number) => {
    cyl(.15 * size, .27 * size, 'terracotta', [x, y + .135 * size, z], .19 * size);
    cyl(.16 * size, .015, 'coffee', [x, y + .27 * size, z]);
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4, h = (.36 + (i % 4) * .12) * size, d = .19 * size;
      cyl(.008 * size, h, 'leaf', [x + Math.cos(a) * .05, y + h / 2 + .25 * size, z + Math.sin(a) * .05]);
      beam([x + Math.cos(a) * .05, y + h + .21 * size, z + Math.sin(a) * .05],
        [x + Math.cos(a) * .18 * size, y + h + .18 * size, z + Math.sin(a) * .18 * size], .006 * size, 'leaf');
      ball([.075 * size, .24 * size, .015 * size], i % 2 ? 'leaf' : 'leafLight',
        [x + Math.cos(a) * d, y + h + .18 * size, z + Math.sin(a) * d], [Math.sin(a) * .7, a, Math.cos(a) * .7]);
    }
  };
  for (const [x, y, z, s] of [[-4.4, 0, 1.4, 1.5], [4.4, 0, 1.5, 1.7], [3.6, .87, -4.8, .6], [.3, .87, -4.8, .5], [-4.35, 2.14, -4.7, .45], [-2, .8, -.6, .3]]) plant(x!, y!, z!, s!);
  for (const x of [.8, 3.1]) {
    plant(x, 0, -6.6, 1.3);
    cyl(.035, 1.4, 'oakDark', [x, .7, -7.1]);
    ball([.47, .6, .38], 'leaf', [x, 1.5, -7.1]);
    ball([.35, .43, .32], 'leafLight', [x + .16, 1.62, -6.96]);
  }
  // Raised original feline medallion above the counter.
  cyl(.34, .025, 'oakLight', [-2.4, 2.62, -4.84], .34, [Math.PI / 2, 0, 0]);
  ball([.17, .15, .025], 'charcoal', [-2.4, 2.62, -4.8]);
  for (const x of [-2.51, -2.29]) ball([.055, .10, .02], 'charcoal', [x, 2.76, -4.8], [0, 0, x < -2.4 ? .3 : -.3]);
  ball([.08, .08, .015], 'cream', [-2.4, 2.56, -4.765]);

  // Standing eye points: spawn, both entry corners and the far side of the room.
  assertEnclosed([...groups.values()].flatMap(map => [...map.values()].flat()),
    [[0, 1.6, 2.2], [-4.7, 1.6, 2.75], [4.7, 1.6, 2.75], [-4.5, 1.6, -2.6], [4.6, 1.6, -1], [.5, 1.6, -1.8]],
    [{ z: -5, minX: -.2, maxX: 4.18, minY: .83, maxY: 2.81 }]);
  for (const [name, map] of groups) {
    const mesh = doc.createMesh(name);
    for (const [color, geos] of map) {
      const merged = mergeGeometries(geos)!;
      mesh.addPrimitive(primitive(doc, merged).setMaterial(materials[color]!));
      geos.forEach((g) => g.dispose()); merged.dispose();
    }
    const node = doc.createNode(name).setMesh(mesh);
    if (name === 'water-bowl' || name === 'food-bowl' || name === 'scoop') {
      const x = name === 'water-bowl' ? 1.4 : name === 'food-bowl' ? 1.9 : 4.65;
      const y = name === 'scoop' ? .29 : 0, z = name === 'scoop' ? -3.9 : -.7;
      // The merged geometry is global; recenter its POSITION accessor exactly once.
      for (const prim of mesh.listPrimitives()) {
        const a = prim.getAttribute('POSITION')!, values = a.getArray()!;
        for (let i = 0; i < values.length; i += 3) { values[i]! -= x; values[i + 1]! -= y; values[i + 2]! -= z; }
      }
      node.setTranslation([x, y, z]);
    }
    scene.addChild(node);
  }
  await applyCafeLightBake(doc);
  return saveAsset(doc, 'public/assets/art/env_cafe.glb', 150000);
}
