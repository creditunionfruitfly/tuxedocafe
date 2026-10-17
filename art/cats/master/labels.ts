/**
 * Surface (material) and chart (UV island) labels for the source mesh, from anatomy frames and the
 * rig. Labels are assigned per vertex by geometric rules, voted onto faces and cleaned so every
 * chart is one connected island.
 */
import { type Anatomy, earLocal } from './anatomy.ts';
import { edgeTable, edgeFaceCount, type Mesh } from './mesh-ops.ts';
import { type Rig, joint } from './skeleton.ts';
import { type Vec3, clamp, dot, lerp3, normalize, sub } from './sdf.ts';

export const SURFACES = ['fur', 'nose', 'pads', 'innerEar', 'mouth'] as const;
export type Surface = typeof SURFACES[number];
export const CHARTS = ['head', 'muzzle', 'ear_L', 'ear_R', 'torso', 'foreleg_L', 'foreleg_R', 'hindleg_L', 'hindleg_R',
  'frontpaw_L', 'frontpaw_R', 'hindpaw_L', 'hindpaw_R', 'tail', 'mouthUpper', 'mouthLower', 'clawSheath'] as const;
export type Chart = typeof CHARTS[number];

export interface Labels { surface: Uint8Array; chart: Uint8Array }

function segmentDistance(p: Vec3, a: Vec3, b: Vec3) {
  const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / dot(ab, ab), 0, 1);
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
}
function polylineDistance(p: Vec3, pts: Vec3[]) { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segmentDistance(p, pts[i]!, pts[i + 1]!)); return d; }

export function vertexLabels(mesh: Mesh, cat: Anatomy, rig: Rig) {
  const n = mesh.positions.length / 3;
  const J = (name: string) => joint(rig, name);
  const surface = new Uint8Array(n), chart = new Uint8Array(n);
  const C = (c: Chart) => CHARTS.indexOf(c), Sf = (s: Surface) => SURFACES.indexOf(s);
  const head = J('head'), neck2 = J('neck_02');
  const headAxis = normalize(sub(head, neck2));
  const tailPts: Vec3[] = []; for (let i = 1; i <= 12; i++) tailPts.push(J(`tail_${String(i).padStart(2, '0')}`));
  const tailDir = normalize(sub(tailPts[1]!, tailPts[0]!)), tailPlane = lerp3(tailPts[0]!, tailPts[1]!, .15);
  const legs = (['L', 'R'] as const).map(s => {
    const side = s === 'L' ? 1 : -1;
    const f = (b: string) => J(`front_${s}_${b}`), h = (b: string) => J(`hind_${s}_${b}`);
    return {
      side,
      fore: { pts: [f('fore'), f('wrist'), f('paw'), f('toe')], plane: lerp3(f('fore'), f('wrist'), .12), normal: normalize(sub(f('wrist'), f('fore'))),
        pawPlane: lerp3(f('wrist'), f('paw'), .25), pawNormal: normalize(sub(f('paw'), f('wrist'))) },
      hind: { pts: [h('shin'), h('hock'), h('metatarsal'), h('paw'), h('toe')], plane: lerp3(h('shin'), h('hock'), .22), normal: normalize(sub(h('hock'), h('shin'))),
        pawPlane: lerp3(h('metatarsal'), h('paw'), .35), pawNormal: normalize(sub(h('paw'), h('metatarsal'))) },
    };
  });
  const pads = Object.entries(cat.labels).filter(([k]) => k.endsWith('.pads')).map(([, v]) => v);
  const sheaths = Object.entries(cat.labels).filter(([k]) => k.endsWith('.sheaths')).map(([, v]) => v);
  const nose = cat.labels.noseLeather!, cavity = cat.labels.cavity!;
  const m = cat.mouth;
  for (let v = 0; v < n; v++) {
    const p: Vec3 = [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!];
    const [x, y, z] = p;
    // Surfaces.
    let sf: Surface = 'fur';
    const inSlit = Math.abs(y - m.slitY(x, z)) <= m.halfGap + .0003 && m.arch(x, z) <= -.0012;
    const onCavity = Math.abs(cavity.eval(x, y, z)) <= .0004;
    if (onCavity || inSlit) sf = 'mouth';
    else if (nose.eval(x, y, z) <= .00025) sf = 'nose';
    else if (pads.some(s => s.eval(x, y, z) <= .0003)) sf = 'pads';
    // Charts.
    let ch: Chart = 'torso';
    let earChart: Chart | null = null;
    for (const ear of cat.ears) {
      const e = earLocal(ear, x, y, z);
      const shell = Math.abs(e.n - e.mid) / Math.sqrt(1 + e.slope * e.slope) - e.thick / 2;
      if (shell <= .0005 && e.outline <= .0005 && e.h > .003) {
        earChart = ear.side > 0 ? 'ear_L' : 'ear_R';
        if (sf === 'fur' && e.n > e.mid && e.outline <= -.0014 && e.h > .004) sf = 'innerEar';
      }
    }
    if (sf === 'mouth') ch = y >= m.slitY(x, z) ? 'mouthUpper' : 'mouthLower';
    else if (y < .03 && sheaths.some(sh => Math.abs(sh.eval(x, y, z)) <= .00025)) ch = 'clawSheath';
    else if (earChart) ch = earChart;
    else if (dot(sub(p, tailPlane), tailDir) > 0 && polylineDistance(p, tailPts) < .024) ch = 'tail';
    else {
      for (const leg of legs) {
        if (x * leg.side < -.004) continue;
        const L = leg.side > 0 ? 'L' : 'R';
        if (dot(sub(p, leg.fore.plane), leg.fore.normal) > 0 && polylineDistance(p, leg.fore.pts) < .03) {
          ch = dot(sub(p, leg.fore.pawPlane), leg.fore.pawNormal) > 0 ? `frontpaw_${L}` : `foreleg_${L}`;
        } else if (dot(sub(p, leg.hind.plane), leg.hind.normal) > 0 && polylineDistance(p, leg.hind.pts) < .03) {
          ch = dot(sub(p, leg.hind.pawPlane), leg.hind.pawNormal) > 0 ? `hindpaw_${L}` : `hindleg_${L}`;
        }
      }
      if (ch === 'torso' && dot(sub(p, head), headAxis) > 0) {
        const lx = x / .0185, ly = (y - head[1] + .009) / .0185, lz = (z - head[2] - .074) / .022;
        ch = lx * lx + ly * ly + lz * lz < 1 ? 'muzzle' : 'head';
      }
    }
    if (sf === 'nose' && ch !== 'muzzle') sf = 'fur';
    surface[v] = Sf(sf); chart[v] = C(ch);
  }
  return { surface, chart };
}

/** Vote vertex labels onto faces, then make every label's faces one edge-connected island. */
export function faceLabels(mesh: Mesh, vertex: { surface: Uint8Array; chart: Uint8Array }): Labels {
  const faces = mesh.indices.length / 3;
  const vote = (labels: Uint8Array) => {
    const out = new Uint8Array(faces);
    for (let f = 0; f < faces; f++) {
      const a = labels[mesh.indices[f * 3]!]!, b = labels[mesh.indices[f * 3 + 1]!]!, c = labels[mesh.indices[f * 3 + 2]!]!;
      out[f] = a === b || a === c ? a : b === c ? b : Math.min(a, b, c);
    }
    return out;
  };
  const chart = cleanIslands(mesh, vote(vertex.chart), 6, true, undefined, [CHARTS.indexOf('clawSheath')]);
  // Surface islands are cleaned within each chart; small specks merge into their surroundings.
  const surface = cleanIslands(mesh, vote(vertex.surface), 40, false, chart);
  // Surfaces must agree with charts: mouth faces belong to mouth charts and vice versa.
  const mouthS = SURFACES.indexOf('mouth'), up = CHARTS.indexOf('mouthUpper'), lo = CHARTS.indexOf('mouthLower');
  for (let f = 0; f < faces; f++) {
    const isMouthChart = chart[f] === up || chart[f] === lo;
    if (isMouthChart) surface[f] = mouthS;
    else if (surface[f] === mouthS) surface[f] = 0;
  }
  return { surface, chart };
}

/**
 * Keep only the largest island of each label (or islands of at least `minFaces` when `largestOnly`
 * is false); other islands take the label they share the longest border with. `within` restricts
 * neighbourhood to faces with the same value in that array.
 */
function cleanIslands(mesh: Mesh, labels: Uint8Array, minFaces: number, largestOnly: boolean, within?: Uint8Array, multi: number[] = []) {
  const faces = labels.length, n = mesh.positions.length / 3;
  const t = edgeTable(mesh.indices, n);
  const neighbours = (f: number, visit: (g: number, e: number) => void) => {
    for (let i = 0; i < 3; i++) {
      const e = t.faceEdges[f * 3 + i]!;
      if (edgeFaceCount(t, e) !== 2) continue;
      const g = t.faces[t.faceStart[e]!] === f ? t.faces[t.faceStart[e]! + 1]! : t.faces[t.faceStart[e]!]!;
      visit(g, e);
    }
  };
  for (let iter = 0; iter < 8; iter++) {
    const island = new Int32Array(faces).fill(-1), sizes: number[] = [], islandLabel: number[] = [], members: number[][] = [];
    for (let f = 0; f < faces; f++) {
      if (island[f] !== -1) continue;
      const id = sizes.length, stack = [f], list: number[] = []; island[f] = id;
      while (stack.length) {
        const g = stack.pop()!; list.push(g);
        neighbours(g, h => { if (island[h] === -1 && labels[h] === labels[g] && (!within || within[h] === within[g])) { island[h] = id; stack.push(h); } });
      }
      sizes.push(list.length); islandLabel.push(labels[f]!); members.push(list);
    }
    const best = new Map<string, number>();
    sizes.forEach((s, id) => { const key = `${islandLabel[id]}`; const b = best.get(key); if (b === undefined || s > sizes[b]!) best.set(key, id); });
    let changed = 0;
    const next = labels.slice();
    for (let id = 0; id < sizes.length; id++) {
      const keep = largestOnly && !multi.includes(islandLabel[id]!) ? best.get(`${islandLabel[id]}`) === id : sizes[id]! >= minFaces;
      if (keep) continue;
      // Border votes.
      const votes = new Map<number, number>();
      for (const f of members[id]!) neighbours(f, g => { if (island[g] !== id && (!within || within[g] === within[f])) votes.set(labels[g]!, (votes.get(labels[g]!) ?? 0) + 1); });
      let label = -1, count = -1;
      for (const [l, c] of [...votes.entries()].sort((a, b) => a[0] - b[0])) if (c > count) { label = l; count = c; }
      if (label < 0) continue;
      for (const f of members[id]!) next[f] = label;
      changed++;
    }
    labels = next;
    if (!changed) break;
  }
  return labels;
}
