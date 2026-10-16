import { Document } from '@gltf-transform/core';
import { BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, BufferGeometry, Color as ThreeColor } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { primitive, saveAsset } from '../../../tools/art/gltf.ts';

type P = [number, number, number];
const palette = {
  plaster: [0.92, .875, .78], oak: [.54, .34, .19], oakLight: [.65, .45, .28],
  oakPale: [.72, .52, .34], oakDark: [.41, .25, .15], lagoon: [.055, .28, .26],
  teal: [.10, .43, .39], brass: [.63, .46, .22], cream: [.97, .94, .85],
  charcoal: [.075, .095, .09], terracotta: [.63, .26, .15], leaf: [.15, .34, .14],
  leafLight: [.34, .48, .19], sky: [.62, .79, .82], glass: [.35, .62, .61],
  coffee: [.16, .065, .03], pastry: [.7, .43, .17], light: [1, .86, .57], rug: [.68, .70, .54],
} satisfies Record<string, P>;
type Color = keyof typeof palette;

export async function makeCafe() {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Tuxedo Cafe · conservatory');
  const materials = Object.fromEntries(Object.entries(palette).map(([name, color]) => {
    const linear = new ThreeColor(...color).convertSRGBToLinear().toArray();
    const material = doc.createMaterial(name).setBaseColorFactor([...linear, 1]).setMetallicFactor(0).setRoughnessFactor(name === 'brass' ? .32 : .78);
    if (name === 'brass') material.setMetallicFactor(.65);
    if (name === 'light') material.setEmissiveFactor([1, .72, .36]);
    if (name === 'sky') material.setEmissiveFactor([.3, .4, .4]);
    return [name, material];
  }));
  const groups = new Map<string, Map<Color, BufferGeometry[]>>();
  let group = 'architecture';
  const add = (geo: BufferGeometry, color: Color, pos: P, rot: P = [0, 0, 0]) => {
    if (geo.index) { const expanded = geo.toNonIndexed(); geo.dispose(); geo = expanded; }
    geo.deleteAttribute('uv');
    geo.rotateX(rot[0]); geo.rotateY(rot[1]); geo.rotateZ(rot[2]); geo.translate(...pos);
    if (!groups.has(group)) groups.set(group, new Map());
    const map = groups.get(group)!;
    if (!map.has(color)) map.set(color, []);
    map.get(color)!.push(geo);
  };
  const box = (size: P, color: Color, pos: P, round = 0, rot: P = [0, 0, 0]) =>
    add(round ? new RoundedBoxGeometry(...size, 2, round) : new BoxGeometry(...size), color, pos, rot);
  const cyl = (r: number, h: number, color: Color, pos: P, rt = r, rot: P = [0, 0, 0]) =>
    add(new CylinderGeometry(rt, r, h, 24), color, pos, rot);
  const ball = (size: P, color: Color, pos: P, rot: P = [0, 0, 0]) => {
    const geo = new SphereGeometry(1, 12, 8); geo.scale(...size); add(geo, color, pos, rot);
  };
  const ring = (r: number, tube: number, color: Color, pos: P, rot: P = [Math.PI / 2, 0, 0], arc = Math.PI * 2) =>
    add(new TorusGeometry(r, tube, 8, 28, arc), color, pos, rot);

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
  box([10, 1.7, .03], 'sky', [0, 1.8, -5.3]);
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
  // Window banquette, upholstered channel seams and brass feet.
  box([3.4, .42, .65], 'lagoon', [2.0, .33, -4.45], .09);
  box([3.4, .55, .16], 'teal', [2.0, .85, -4.72], .06);
  for (let x = .5; x < 3.7; x += .22) box([.012, .43, .03], 'lagoon', [x, .85, -4.62]);
  for (const x of [.55, 3.5]) cyl(.025, .2, 'brass', [x, .1, -4.18]);
  // Fluted coffee counter, stone lip, joinery and espresso equipment.
  box([3.6, .94, .88], 'lagoon', [-2.8, .47, -4.2], .045);
  for (let x = -4.52; x < -1.05; x += .10) cyl(.037, .82, 'oakLight', [x, .48, -3.735]);
  box([3.76, .10, 1.0], 'cream', [-2.8, .99, -4.16], .04);
  box([3.65, .03, .025], 'brass', [-2.8, .19, -3.69]);
  box([.9, .45, .46], 'charcoal', [-3.65, 1.28, -4.24], .035);
  box([.84, .1, .54], 'brass', [-3.65, 1.06, -4.19], .018);
  for (const x of [-3.85, -3.47]) {
    cyl(.055, .18, 'brass', [x, 1.27, -3.94]);
    cyl(.09, .035, 'charcoal', [x + .09, 1.21, -3.94], .07, [0, 0, Math.PI / 2]);
    cyl(.047, .10, 'cream', [x, 1.1, -3.88], .06);
  }
  for (let i = 0; i < 5; i++) {
    cyl(.075, .035, 'cream', [-4.1, 1.52 + i * .035, -4.23]);
    cyl(.048, .09, 'cream', [-3.55 + (i % 3) * .15, 1.57, -4.24]);
  }
  // Sink and articulated goose-neck tap at the engine proxy coordinates.
  group = 'sink';
  box([.72, .065, .65], 'brass', [-2, 1.07, -3.68], .035);
  box([.61, .025, .51], 'charcoal', [-2, 1.105, -3.68], .04);
  group = 'tap';
  cyl(.025, .28, 'brass', [-2, 1.24, -3.92]);
  ring(.12, .025, 'brass', [-2, 1.38, -3.80], [0, Math.PI / 2, 0], Math.PI);
  cyl(.026, .10, 'brass', [-2, 1.34, -3.68]);
  group = 'architecture';
  // Shelves and a pastry display. Clear acrylic is represented by teal edging.
  for (const y of [1.55, 2.1]) {
    box([2.55, .065, .32], 'oakLight', [-3.35, y, -4.76], .02);
    for (let i = 0; i < 8; i++) cyl(.045, .11, 'cream', [-4.35 + i * .19, y + .085, -4.73], .06);
  }
  box([.63, .05, .48], 'oakLight', [-1.38, 1.08, -4.14], .02);
  for (const x of [-1.66, -1.1]) for (const z of [-4.35, -3.93]) box([.018, .35, .018], 'glass', [x, 1.27, z]);
  box([.65, .025, .50], 'glass', [-1.38, 1.45, -4.14]);
  for (let i = 0; i < 4; i++) ball([.08, .055, .045], 'pastry', [-1.57 + (i % 2) * .25, 1.14, -4.26 + Math.floor(i / 2) * .24]);

  const chair = (x: number, z: number, angle: number) => {
    cyl(.27, .09, 'teal', [x, .44, z]);
    ring(.29, .055, 'lagoon', [x, .76, z], [0, angle, 0], Math.PI);
    for (const dx of [-.18, .18]) for (const dz of [-.17, .17]) cyl(.018, .43, 'oakDark', [x + dx, .215, z + dz]);
  };
  for (const [i, x, z] of [[1, -2, -.6], [2, .5, -3.1]]) {
    group = `table-${i}`;
    cyl(.66, .065, 'oakPale', [x!, .76, z!]); ring(.64, .012, 'brass', [x!, .802, z!]);
    cyl(.07, .72, 'lagoon', [x!, .36, z!], .09); cyl(.32, .035, 'brass', [x!, .025, z!]);
    cyl(.105, .018, 'cream', [x! + .23, .805, z!]); cyl(.065, .10, 'cream', [x! + .23, .86, z!], .08);
    ring(.045, .012, 'cream', [x! + .315, .86, z!], [0, 0, 0]);
    cyl(.06, .007, 'coffee', [x! + .23, .915, z!]);
    group = 'architecture';
    chair(x! - .95, z!, Math.PI / 2); chair(x! + .95, z!, -Math.PI / 2);
  }
  // Pendant shades with visible luminous diffusers; no extra dynamic lights.
  for (const [x, z] of [[-2, -.6], [.5, -3.1], [-3.5, -3.6]]) {
    cyl(.008, .6, 'charcoal', [x!, 2.99, z!]);
    cyl(.30, .20, 'lagoon', [x!, 2.61, z!], .12);
    cyl(.28, .012, 'light', [x!, 2.50, z!]); ring(.29, .014, 'brass', [x!, 2.50, z!]);
  }
  // Soft leaf-shaped rug in the play area with nested stitched rings.
  cyl(.95, .012, 'rug', [3.4, .012, -.3]);
  for (const r of [.82, .87, .91]) ring(r, .006, 'cream', [3.4, .021, -.3]);
  group = 'cat-tree';
  cyl(.52, .09, 'oakLight', [3.7, .055, -2.2]);
  for (const [x, z, h] of [[3.48, -2.25, 1.65], [3.92, -2.15, 1.15]]) {
    cyl(.073, h!, 'cream', [x!, h! / 2, z!]);
    for (let y = .1; y < h!; y += .035) ring(.074, .007, 'oakPale', [x!, y, z!]);
  }
  for (const [x, y, z] of [[3.92, .62, -2.15], [3.6, 1.2, -2.2], [3.45, 1.77, -2.25]]) {
    cyl(.34, .08, 'oakLight', [x!, y!, z!]);
    cyl(.30, .045, 'teal', [x!, y! + .06, z!]); ring(.30, .045, 'teal', [x!, y! + .11, z!]);
  }
  // Bowls are separate nodes, with pivots at their contact points for carrying.
  for (const [id, x, color] of [['water-bowl', 1.4, 'teal'], ['food-bowl', 1.9, 'terracotta']] as const) {
    group = id;
    cyl(.17, .08, color, [x, .04, -.7], .19); ring(.185, .018, 'cream', [x, .083, -.7]);
    cyl(.16, .005, id === 'water-bowl' ? 'glass' : 'coffee', [x, .078, -.7]);
  }
  for (const [i, z] of [[1, -3.6], [2, -4.3]]) {
    group = `litter-${i}`;
    box([.65, .15, .52], 'cream', [4.25, .075, z!], .045);
    box([.53, .02, .4], 'oakPale', [4.25, .15, z!], .025);
  }
  group = 'bin'; cyl(.16, .48, 'lagoon', [-4.65, .24, -3.25]); cyl(.17, .04, 'brass', [-4.65, .5, -3.25]);
  group = 'scoop'; box([.10, .02, .13], 'brass', [4.65, .3, -3.9], .015); box([.025, .02, .28], 'oakDark', [4.65, .3, -4.08]);
  group = 'architecture';
  const plant = (x: number, y: number, z: number, size: number) => {
    cyl(.15 * size, .27 * size, 'terracotta', [x, y + .135 * size, z], .19 * size);
    cyl(.16 * size, .015, 'coffee', [x, y + .27 * size, z]);
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4, h = (.36 + (i % 4) * .12) * size, d = .19 * size;
      cyl(.008 * size, h, 'leaf', [x + Math.cos(a) * .05, y + h / 2 + .25 * size, z + Math.sin(a) * .05]);
      ball([.075 * size, .24 * size, .015 * size], i % 2 ? 'leaf' : 'leafLight',
        [x + Math.cos(a) * d, y + h + .18 * size, z + Math.sin(a) * d], [Math.sin(a) * .7, a, Math.cos(a) * .7]);
    }
  };
  for (const [x, y, z, s] of [[-4.4, 0, 1.4, 1.5], [4.4, 0, 1.5, 1.7], [3.6, .87, -4.8, .6], [.3, .87, -4.8, .5], [-4.35, 2.14, -4.7, .45], [-2, .8, -.6, .3]]) plant(x!, y!, z!, s!);
  // Raised original feline medallion above the counter.
  cyl(.34, .025, 'oakLight', [-2.4, 2.62, -4.84], .34, [Math.PI / 2, 0, 0]);
  ball([.17, .15, .025], 'charcoal', [-2.4, 2.62, -4.8]);
  for (const x of [-2.51, -2.29]) ball([.055, .10, .02], 'charcoal', [x, 2.76, -4.8], [0, 0, x < -2.4 ? .3 : -.3]);
  ball([.08, .08, .015], 'cream', [-2.4, 2.56, -4.765]);

  for (const [name, map] of groups) {
    const mesh = doc.createMesh(name);
    for (const [color, geos] of map) {
      const merged = mergeGeometries(geos)!;
      mesh.addPrimitive(primitive(doc, merged).setMaterial(materials[color]!));
      geos.forEach((g) => g.dispose()); merged.dispose();
    }
    const node = doc.createNode(name).setMesh(mesh);
    if (name === 'water-bowl' || name === 'food-bowl') {
      const x = name === 'water-bowl' ? 1.4 : 1.9;
      // The merged geometry is global; recenter its POSITION accessor exactly once.
      for (const prim of mesh.listPrimitives()) {
        const a = prim.getAttribute('POSITION')!, values = a.getArray()!;
        for (let i = 0; i < values.length; i += 3) { values[i]! -= x; values[i + 2]! += .7; }
      }
      node.setTranslation([x, 0, -.7]);
    }
    scene.addChild(node);
  }
  return saveAsset(doc, 'public/assets/art/env_cafe.glb', 150000);
}
