/**
 * The master cat sculpt as one signed distance field, built on the rig's rest joints.
 *
 * Volumes follow feline anatomy rather than one capsule per bone: a lofted trunk with a deep keel
 * and tucked waist, sliding scapulae over the withers, heavy haunches and a hamstring mass, a
 * gastrocnemius that tapers into the hock, slender metapodials, four toe lobes with digital pads,
 * trilobed metacarpal/metatarsal pads, front carpal pads and dewclaws, a tapered tail, and a
 * skull with a projecting muzzle, whisker pads, chin, jaw slit and oral cavity, nose leather with
 * nostrils, real eyelid apertures around the eye sockets, and cupped ear shells.
 */
import { type Basis, type Child, type Shape, type Vec3, add, basisFrom, capsule, clamp, cross, custom, dot, ellipsoid, expand, group, mix,
  normalize, roundCone, scale, smax, smin, smoothstep, sphere, sub, tube } from './sdf.ts';
import { type Rig, joint } from './skeleton.ts';

export type Side = 1 | -1;
export type Region = 'torso' | 'neck' | 'head' | 'muzzle' | 'ear' | 'frontLeg' | 'hindLeg' | 'frontPaw' | 'hindPaw' | 'tail' | 'scapula' | 'pad';
export interface Part { shape: Shape; region: Region; side: 0 | Side }

export interface EyeFrame {
  side: Side; center: Vec3; radius: number; gap: number; lid: number;
  axis: Vec3; up: Vec3; lateral: Vec3;
  /** Aperture outline in radians: horizontal angle range and upper/lower margins as functions of t∈[0,1]. */
  inner: number; outer: number; upper: (t: number) => number; lower: (t: number) => number;
}
export interface EarFrame { side: Side; base: Vec3; up: Vec3; front: Vec3; lateral: Vec3; height: number; width: number }
export interface MouthFrame {
  /** Slit mid-surface height at (x, z) and the 2D arch region (negative inside). */
  slitY: (x: number, z: number) => number; arch: (x: number, z: number) => number; halfGap: number;
  cavity: { center: Vec3; radii: Vec3 }; hinge: Vec3; front: number; corner: Vec3;
}
export interface Anatomy {
  shape: Shape; parts: Part[]; eyes: [EyeFrame, EyeFrame]; ears: [EarFrame, EarFrame]; mouth: MouthFrame;
  nose: { tip: Vec3; center: Vec3; radii: Vec3 }; landmarks: Record<string, Vec3>;
  /** Field without eye sockets, mouth and nostrils (head volume only) for morph collision tests. */
  headVolume: Shape;
}

const mirror = (p: Vec3, side: Side): Vec3 => [p[0] * side, p[1], p[2]];
const deg = Math.PI / 180;

/** Catmull–Rom through samples (uniform), returns value at u ∈ [0, n-1]. */
function catmull(values: number[], u: number) {
  const n = values.length, i = clamp(Math.floor(u), 0, n - 2), t = u - i;
  const p0 = values[Math.max(i - 1, 0)]!, p1 = values[i]!, p2 = values[i + 1]!, p3 = values[Math.min(i + 2, n - 1)]!;
  return .5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** Monotone cubic (Fritsch–Carlson) interpolant through (xs, ys); returns value and slope. */
function monotone(xs: number[], ys: number[]) {
  const n = xs.length, d: number[] = [], m: number[] = [];
  for (let i = 0; i + 1 < n; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  // Zero end slopes so lofts can be closed by smooth caps.
  for (let i = 0; i < n; i++) m.push(i === 0 || i === n - 1 || d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2);
  for (let i = 0; i + 1 < n; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i]! / d[i]!, b = m[i + 1]! / d[i]!, h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]!; m[i + 1] = t * b * d[i]!; }
  }
  return (x: number): [number, number] => {
    if (x <= xs[0]!) return [ys[0]!, 0];
    if (x >= xs[n - 1]!) return [ys[n - 1]!, 0];
    let i = 0; while (i + 2 < n && x > xs[i + 1]!) i++;
    const hh = xs[i + 1]! - xs[i]!, t = (x - xs[i]!) / hh, t2 = t * t, t3 = t2 * t;
    const v = (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * hh * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * hh * m[i + 1]!;
    const dv = ((6 * t2 - 6 * t) * ys[i]! + (3 * t2 - 4 * t + 1) * hh * m[i]! + (-6 * t2 + 6 * t) * ys[i + 1]! + (3 * t2 - 2 * t) * hh * m[i + 1]!) / hh;
    return [v, dv];
  };
}

/**
 * Lofted body section sliced along a straight axis: each station gives the section centre offset
 * along `up`, half width, and half heights above/below the widest line (flat back, deep keel),
 * with optional superelliptic flattening. Profiles use monotone cubics, so the field is smooth and
 * unambiguous; the value is the first-order distance F/|∇F| including the axial taper.
 */
function trunkLoft(name: string, stations: { z: number; y: number; w: number; top: number; bottom: number; flat?: number }[], axisFrom: Vec3 = [0, 0, -1], axisTo: Vec3 = [0, 0, 1]): Shape {
  const axis = normalize(sub(axisTo, axisFrom)), up = normalize(cross(axis, [1, 0, 0])), o = axisFrom;
  // Station positions are given in world (z, y); express them as axis coordinate s and offset c.
  const S = stations.map(v => dot(sub([0, v.y, v.z], o), axis)), Cc = stations.map(v => dot(sub([0, v.y, v.z], o), up));
  const fc = monotone(S, Cc), fw = monotone(S, stations.map(v => v.w)), ft = monotone(S, stations.map(v => v.top)), fb = monotone(S, stations.map(v => v.bottom)), ff = monotone(S, stations.map(v => v.flat ?? 0));
  const s0 = S[0]!, s1 = S[S.length - 1]!;
  let rMax = 0, wMax = 0;
  for (const v of stations) { rMax = Math.max(rMax, v.top, v.bottom); wMax = Math.max(wMax, v.w); }
  const pts = stations.flatMap(v => [[0, v.y + rMax, v.z + rMax], [0, v.y - rMax, v.z - rMax]] as Vec3[]);
  const box = { min: [-wMax - .005, Math.min(...pts.map(p => p[1])) - .005, Math.min(...pts.map(p => p[2])) - .005] as Vec3, max: [wMax + .005, Math.max(...pts.map(p => p[1])) + .005, Math.max(...pts.map(p => p[2])) + .005] as Vec3 };
  // Ellipsoidal end caps continue the end sections (zero slope there), so the loft closes C1.
  const capLen = (i: number) => Math.min(stations[i]!.w, stations[i]!.top, stations[i]!.bottom) * .9;
  const cap0 = capLen(0), cap1 = capLen(stations.length - 1);
  return custom(name, expand(box, Math.max(cap0, cap1)), (x, y, z) => {
    const dy = y - o[1], dz = z - o[2], dx = x - o[0];
    const sRaw = dx * axis[0] + dy * axis[1] + dz * axis[2], s = clamp(sRaw, s0, s1);
    const vRaw = dx * up[0] + dy * up[1] + dz * up[2];
    const over = sRaw - s;
    if (over !== 0) {
      // Half-ellipsoid cap on the end section (end slopes are zero, so this joins C1).
      const L = over < 0 ? cap0 : cap1, c = fc(s)[0], w = fw(s)[0], v = vRaw - c, b = v > 0 ? ft(s)[0] : fb(s)[0];
      const lu = x / w, lv = v / b, ls = over / L;
      const k0 = Math.sqrt(lu * lu + lv * lv + ls * ls), k1 = Math.sqrt((lu / w) ** 2 + (lv / b) ** 2 + (ls / L) ** 2);
      return k0 < 1e-9 ? -Math.min(w, b, L) : k0 * (k0 - 1) / k1;
    }
    const [c, dc] = fc(s), [w, dw] = fw(s), [top, dt] = ft(s), [bottom, db] = fb(s), p = 2 + Math.max(ff(s)[0], 0);
    const v = vRaw - c, b = v > 0 ? top : bottom, dbs = v > 0 ? dt : db;
    const au = Math.abs(x) / w, av = Math.abs(v) / b;
    const q = Math.pow(Math.pow(au, p) + Math.pow(av, p), 1 / p);
    if (q < 1e-6) return -Math.min(w, b);
    const qp = Math.pow(q, p - 1), pu = Math.pow(au, p - 1), pv = Math.pow(av, p - 1);
    const Fu = pu / (w * qp), Fv = pv / (b * qp) * Math.sign(v);
    const Fs = -Fv * dc - (pu * au) / (w * qp) * dw - (pv * av) / (b * qp) * dbs;
    return (q - 1) / Math.max(Math.hypot(Fu, Fv, Fs), 1e-6);
  });
}

/**
 * Eyelids: a spherical band of thickness `lid` around the eyeball, open inside the aperture,
 * fading into the face. Margins are rounded by the smooth intersection.
 */
export function apertureDistance(eye: EyeFrame, x: number, y: number, z: number): { ang: number; r: number; front: number; h: number; t: number } {
  const dx = (x - eye.center[0]) * eye.side, dy = y - eye.center[1], dz = z - eye.center[2];
  // Work in the left-eye frame (mirror the right eye).
  const ax = eye.axis[0] * eye.side, ux = eye.up[0] * eye.side, lx = eye.lateral[0] * eye.side;
  const qa = dx * ax + dy * eye.axis[1] + dz * eye.axis[2], qu = dx * ux + dy * eye.up[1] + dz * eye.up[2], ql = dx * lx + dy * eye.lateral[1] + dz * eye.lateral[2];
  const r = Math.hypot(qa, qu, ql);
  const h = Math.atan2(ql, qa), v = Math.atan2(qu, Math.hypot(qa, ql));
  const t = (h - eye.inner) / (eye.outer - eye.inner);
  const tc = clamp(t, 0, 1), up = eye.upper(tc), lo = eye.lower(tc);
  // Angular signed distance to the aperture outline (negative inside).
  const dv = Math.max(v - up, lo - v), dh = Math.max(eye.inner - h, h - eye.outer);
  const ang = smax(dv, dh * 1.4, 4 * deg);
  return { ang, r, front: qa, h, t };
}

export function buildCat(rig: Rig): Anatomy {
  const J = (name: string) => joint(rig, name);
  const parts: Part[] = [];
  const reg = (shape: Shape, region: Region, side: 0 | Side = 0) => { parts.push({ shape, region, side }); return shape; };
  const U = (shape: Shape, k: number): Child => ({ shape, op: 'union', k });
  const S = (shape: Shape, k: number): Child => ({ shape, op: 'subtract', k });

  // ---------------------------------------------------------------- trunk and neck
  const head = J('head');
  // Stations: z, centre height, half width, half heights above/below the widest line (skin
  // surface under a short coat). Dorsal line ~0.29–0.30 m, keel at ~0.13 m, waist tucked to 0.15 m.
  const st = (z: number, dorsal: number, ventral: number, w: number, ratio: number, flat = 0) => {
    const depth = dorsal - ventral, top = depth * ratio;
    return { z, y: dorsal - top, w, top, bottom: depth - top, flat };
  };
  const trunk = reg(trunkLoft('trunk', [
    st(-.240, .242, .208, .016, .5),
    st(-.212, .266, .196, .036, .5, .2),
    st(-.162, .290, .180, .050, .45, .35),
    st(-.098, .296, .166, .045, .45, .4),
    st(-.035, .292, .154, .046, .42, .4),
    st(.025, .290, .138, .053, .40, .3),
    st(.080, .292, .126, .052, .38, .3),
    st(.125, .293, .131, .046, .38, .2),
    st(.160, .286, .152, .040, .42, .1),
    st(.186, .270, .182, .026, .45),
  ]), 'torso');
  // Neck: its own loft along a rising axis from inside the withers to the skull base.
  const neckFrom: Vec3 = [0, .240, .085], neckTo: Vec3 = [0, head[1] + .002, head[2] + .022];
  const neck = reg(trunkLoft('neck', [
    st(.090, .272, .208, .026, .5),
    st(.122, .296, .184, .038, .5),
    st(head[2] - .020, head[1] + .021, head[1] - .066, .039, .5),
    st(head[2] + .004, head[1] + .028, head[1] - .042, .034, .5),
    st(head[2] + .022, head[1] + .022, head[1] - .022, .022, .5),
  ], neckFrom, neckTo), 'neck');
  const torsoChildren: Child[] = [U(trunk, 0), U(neck, .04)];
  // Manubrium and pectorals: the rounded chest front between the forelegs.
  torsoChildren.push(U(reg(ellipsoid('pectoral', [0, .160, .142], [.030, .032, .030], basisFrom([0, -.4, 1], [0, 1, 0])), 'torso'), .035));
  // Abdomen with a slight primordial pouch ahead of the stifles.
  torsoChildren.push(U(reg(ellipsoid('pouch', [0, .172, -.105], [.032, .020, .048]), 'torso'), .028));
  // Croup and sacrum: a broad rounded rump that carries the tail root.
  torsoChildren.push(U(reg(ellipsoid('croup', [0, .262, -.176], [.036, .028, .040]), 'torso'), .022));
  // Neck muscle mass (crest above, throat below) blending into the skull base.
  torsoChildren.push(U(reg(ellipsoid('nape', [0, .296, .146], [.028, .016, .034], basisFrom([0, .25, 1], [0, 1, 0])), 'neck'), .02));
  torsoChildren.push(U(reg(ellipsoid('throat', [0, .214, .160], [.027, .026, .028], basisFrom([0, 1, .9], [0, 1, 0])), 'neck'), .03));

  for (const side of [1, -1] as const) {
    const m = (p: Vec3) => mirror(p, side);
    // Scapula: blade lying on the thorax, its dorsal border just below the withers.
    const scapTop = mirror(J('front_L_scapula'), side), shoulder = mirror(J('front_L_upper'), side);
    const scapAxis = normalize(sub(shoulder, scapTop));
    torsoChildren.push(U(reg(ellipsoid(`scapula${side}`, add(mix3(scapTop, shoulder, .40), m([.006, 0, -.004])), [.0105, .040, .025], basisFrom(cross([side, 0, 0], scapAxis), scapAxis)), 'scapula', side), .024));
    // Haunch: a broad, laterally flattened thigh from the croup to the stifle.
    const hip = mirror(J('hind_L_thigh'), side), knee = mirror(J('hind_L_shin'), side);
    const femur = normalize(sub(knee, hip));
    torsoChildren.push(U(reg(ellipsoid(`haunch${side}`, add(mix3(hip, knee, .46), m([-.002, .004, -.014])), [.0200, .074, .056], basisFrom([side * .06, 0, 1], femur)), 'hindLeg', side), .055));
    // Hamstrings: the rear thigh line from the ischium down to the gastrocnemius.
    torsoChildren.push(U(reg(ellipsoid(`hamstring${side}`, m([.028, .170, -.186]), [.019, .048, .022], basisFrom([0, -.55, 1], [0, 1, .45])), 'hindLeg', side), .03));
    // Upper arm: triceps behind and brachiocephalic in front, mostly inside the trunk outline.
    const elbow = mirror(J('front_L_fore'), side);
    const humerus = normalize(sub(elbow, shoulder));
    torsoChildren.push(U(reg(ellipsoid(`triceps${side}`, add(mix3(shoulder, elbow, .52), m([.003, 0, -.014])), [.0165, .042, .022], basisFrom([0, 0, 1], scale(humerus, -1))), 'frontLeg', side), .022));
    torsoChildren.push(U(reg(ellipsoid(`biceps${side}`, add(mix3(shoulder, elbow, .40), m([.001, .004, .010])), [.0145, .036, .014], basisFrom([0, 0, 1], scale(humerus, -1))), 'frontLeg', side), .018));
  }
  const torso = group('torso', torsoChildren);

  // ---------------------------------------------------------------- legs and paws
  const limbs: Child[] = [];
  for (const side of [1, -1] as const) {
    const L = (name: string) => mirror(J(name.replace('#', 'L')), side);
    const m = (p: Vec3) => mirror(p, side);
    // Foreleg below the elbow.
    const elbow = L('front_#_fore'), wrist = L('front_#_wrist'), paw = L('front_#_paw'), toe = L('front_#_toe');
    const fore: Child[] = [
      U(reg(sphere(`olecranon${side}`, add(elbow, m([.001, .003, -.009])), .0108), 'frontLeg', side), 0),
      U(reg(roundCone(`forearm${side}`, add(elbow, [0, -.004, 0]), add(wrist, [0, .004, 0]), .0158, .0108), 'frontLeg', side), .008),
      U(reg(ellipsoid(`forearmMuscle${side}`, add(mix3(elbow, wrist, .3), m([0, 0, .003])), [.0148, .032, .0142], basisFrom([0, 0, 1], normalize(sub(elbow, wrist)))), 'frontLeg', side), .01),
      U(reg(sphere(`carpus${side}`, add(wrist, [0, 0, -.001]), .0110), 'frontLeg', side), .006),
    ];
    limbs.push(U(group(`foreleg${side}`, fore), .014));
    limbs.push(U(paw4(`frontPaw${side}`, side, wrist, paw, toe, true, reg), .006));
    // Hind leg below the stifle.
    const knee = L('hind_#_shin'), hock = L('hind_#_hock'), meta = L('hind_#_metatarsal'), hpaw = L('hind_#_paw'), htoe = L('hind_#_toe');
    const tibia = normalize(sub(hock, knee));
    const hind: Child[] = [
      U(reg(sphere(`stifle${side}`, add(knee, m([-.003, .006, -.006])), .0115), 'hindLeg', side), 0),
      U(reg(roundCone(`shank${side}`, knee, add(hock, [0, .003, 0]), .0152, .0094), 'hindLeg', side), .01),
      U(reg(ellipsoid(`gastrocnemius${side}`, add(mix3(knee, hock, .32), [0, .006, -.011]), [.0150, .034, .0180], basisFrom(cross([1, 0, 0], tibia), scale(tibia, -1))), 'hindLeg', side), .012),
      U(reg(capsule(`achilles${side}`, add(mix3(knee, hock, .55), [0, 0, -.016]), add(hock, [0, .006, -.0115]), .0045), 'hindLeg', side), .008),
      U(reg(sphere(`calcaneus${side}`, add(hock, [0, .006, -.0098]), .0068), 'hindLeg', side), .006),
      U(reg(sphere(`tarsus${side}`, add(hock, [0, -.004, .000]), .0094), 'hindLeg', side), .006),
      U(reg(roundCone(`metatarsus${side}`, add(meta, [0, 0, .001]), add(hpaw, [0, .006, -.004]), .0098, .0108), 'hindLeg', side), .008),
    ];
    limbs.push(U(group(`hindleg${side}`, hind), .014));
    limbs.push(U(paw4(`hindPaw${side}`, side, meta, hpaw, htoe, false, reg), .006));
  }

  // ---------------------------------------------------------------- tail
  const tailPoints: Vec3[] = [], tailRadii: number[] = [];
  for (let i = 1; i <= 12; i++) tailPoints.push(J(`tail_${String(i).padStart(2, '0')}`));
  const last = tailPoints[11]!, prev = tailPoints[10]!;
  tailPoints.push(add(last, scale(sub(last, prev), .9)));
  for (let i = 0; i < tailPoints.length; i++) {
    const t = i / (tailPoints.length - 1);
    tailRadii.push(mix(.0128, .0080, Math.pow(t, .8)) * (i === tailPoints.length - 1 ? .78 : 1));
  }
  tailPoints.unshift(add(tailPoints[0]!, [0, -.006, .030])); tailRadii.unshift(.017);
  const tail = reg(tube('tail', tailPoints, tailRadii), 'tail');

  // ---------------------------------------------------------------- head
  const eyeL = J('eye_L');
  const eyes = ([1, -1] as const).map(side => makeEye(mirror(eyeL, side), side)) as [EyeFrame, EyeFrame];
  const ears = ([1, -1] as const).map(side => makeEar(side, J('ear_L_01'), J('ear_L_02'))) as [EarFrame, EarFrame];

  const skull: Child[] = [];
  const H = (dx: number, dy: number, dz: number): Vec3 => [head[0] + dx, head[1] + dy, head[2] + dz];
  // Cranium, brow and nose bridge.
  skull.push(U(reg(ellipsoid('cranium', H(0, .0245, .0215), [.0300, .0275, .0340]), 'head'), 0));
  skull.push(U(reg(ellipsoid('brow', H(0, .0275, .0455), [.0205, .0150, .0200], basisFrom([0, -.45, 1], [0, 1, .2])), 'head'), .012));
  skull.push(U(reg(ellipsoid('occiput', H(0, .0150, .0020), [.0235, .0215, .0175]), 'head'), .012));
  skull.push(U(reg(ellipsoid('noseBridge', H(0, .0172, .0722), [.0078, .0058, .0160], basisFrom(normalize([0, -.0170, .0225]), [0, 1, 0])), 'muzzle'), .009));
  for (const side of [1, -1] as const) {
    const m = (dx: number, dy: number, dz: number) => H(dx * side, dy, dz);
    // Zygomatic arch and masseter: the broad cat cheek line below and behind the eye.
    skull.push(U(reg(ellipsoid(`zygoma${side}`, m(.0258, .0098, .0340), [.0135, .0105, .0210], basisFrom([side * .18, 0, 1], [0, 1, 0])), 'head', side), .010));
    skull.push(U(reg(ellipsoid(`masseter${side}`, m(.0228, -.0010, .0225), [.0140, .0145, .0170]), 'head', side), .010));
    // Whisker pads: the rounded mystacial pads either side of the philtrum.
    skull.push(U(reg(ellipsoid(`whiskerPad${side}`, m(.0080, -.0058, .0782), [.0088, .0072, .0084], basisFrom([side * .25, -.1, 1], [0, 1, 0])), 'muzzle', side), .0045));
    // Mandible ramus from the chin back to the jaw angle.
    skull.push(U(reg(roundCone(`mandible${side}`, m(.0048, -.0182, .0655), m(.0205, -.0135, .0175), .0055, .0078), 'muzzle', side), .007));
    // Orbit rims: brow over the eye and the malar ridge under it, holding the lid band.
    skull.push(U(reg(ellipsoid(`supraorbital${side}`, m(.0175, .0335, .0480), [.0105, .0055, .0090], basisFrom([side * .3, -.2, 1], [0, 1, 0])), 'head', side), .006));
  }
  skull.push(U(reg(ellipsoid('maxilla', H(0, -.0005, .0700), [.0150, .0112, .0140]), 'muzzle'), .010));
  skull.push(U(reg(ellipsoid('chin', H(0, -.0182, .0680), [.0074, .0055, .0072]), 'muzzle'), .006));
  skull.push(U(reg(ellipsoid('jawFloor', H(0, -.0165, .0340), [.0175, .0105, .0260]), 'muzzle'), .010));
  // Nose leather: a rounded inverted triangle at the tip of the muzzle.
  const noseCenter = H(0, .0035, .0905), noseRadii: Vec3 = [.0058, .0041, .0033];
  skull.push(U(reg(custom('noseLeather', { min: sub(noseCenter, [.008, .007, .006]), max: add(noseCenter, [.008, .007, .006]) }, (x, y, z) => {
    const lx = x - noseCenter[0], ly = y - noseCenter[1], lz = z - noseCenter[2];
    const w = noseRadii[0] * (.62 + .38 * smoothstep(-noseRadii[1], noseRadii[1], ly));
    const k0 = Math.hypot(lx / w, ly / noseRadii[1], lz / noseRadii[2]), k1 = Math.hypot(lx / (w * w), ly / (noseRadii[1] ** 2), lz / (noseRadii[2] ** 2));
    return k0 < 1e-9 ? -noseRadii[2] : k0 * (k0 - 1) / k1;
  }), 'muzzle'), .0025));

  // Ears: cupped shells with thickness and a concha, blended into the cranium.
  for (const ear of ears) skull.push(U(reg(earShell(ear), 'ear', ear.side), .0045));

  // Eyelid bands around both eyes, then apertures and sockets.
  // Periorbital fill brings the face up to the lid surface so the lids sit flush, not in a crater.
  for (const eye of eyes) skull.push(U(reg(ellipsoid(`orbit${eye.side}`, add(eye.center, scale(eye.axis, -.0012)), [eye.radius + eye.gap + eye.lid * .55, eye.radius + eye.gap + eye.lid * .45, eye.radius + eye.gap + eye.lid * .5], basisFrom(eye.axis, [0, 1, 0])), 'head', eye.side), .0045));
  for (const eye of eyes) skull.push(U(reg(eyelids(eye), 'head', eye.side), .0016));
  for (const eye of eyes) {
    skull.push(S(custom(`aperture${eye.side}`, boxAt(eye.center, eye.radius + .009), (x, y, z) => {
      const a = apertureDistance(eye, x, y, z);
      return Math.max(a.ang * a.r, a.r - (eye.radius + eye.gap + eye.lid + .0045), -a.front);
    }), .0005));
    skull.push(S(sphere(`socket${eye.side}`, eye.center, eye.radius + eye.gap), .0003));
  }

  // Nostrils (comma-shaped, blind) and the philtrum groove.
  for (const side of [1, -1] as const) {
    const n = (dx: number, dy: number, dz: number) => H(dx * side, dy, dz);
    skull.push(S(roundCone(`nostril${side}`, n(.0021, .0012, .0945), n(.0046, .0040, .0898), .00085, .00055), .0006));
  }
  skull.push(S(capsule('philtrum', H(0, .0002, .0952), H(0, -.0122, .0885), .00062), .0006));

  // Mouth: closed lips separated by a thin slit that opens into a closed oral cavity.
  const mouth = makeMouth(head, J('jaw'));
  skull.push(S(custom('mouthSlit', { min: [-.02, mouth.cavity.center[1] - .012, mouth.cavity.center[2] - .03], max: [.02, mouth.cavity.center[1] + .01, mouth.cavity.center[2] + .04] },
    (x, y, z) => Math.max(Math.abs(y - mouth.slitY(x, z)) - mouth.halfGap, mouth.arch(x, z))), .0004));
  skull.push(S(ellipsoid('oralCavity', mouth.cavity.center, mouth.cavity.radii, basisFrom([0, -.12, 1], [0, 1, 0])), .0012));

  const headShape = group('head', skull);
  const headVolume = group('headVolume', skull.filter(c => c.op === 'union' && !c.shape.name.startsWith('ear')));

  const shape = group('cat', [U(torso, 0), U(headShape, .016), U(tail, .02), ...limbs.map(c => ({ ...c, k: c.shape.name.startsWith('fore') || c.shape.name.startsWith('hind') ? .014 : .006 }))]);
  return {
    shape, parts, eyes, ears, mouth, headVolume,
    nose: { tip: add(noseCenter, [0, 0, noseRadii[2]]), center: noseCenter, radii: noseRadii },
    landmarks: { head, jaw: J('jaw'), noseCenter },
  };
}

function mix3(a: Vec3, b: Vec3, t: number): Vec3 { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
function boxAt(c: Vec3, r: number) { return { min: [c[0] - r, c[1] - r, c[2] - r] as Vec3, max: [c[0] + r, c[1] + r, c[2] + r] as Vec3 }; }

function makeEye(center: Vec3, side: Side): EyeFrame {
  // Optical axis: forward, 9° outward and 4° down; the band hugs a 10.5 mm eyeball.
  const axis = normalize([Math.sin(9 * deg) * side, -Math.sin(4 * deg), Math.cos(9 * deg)]);
  const lateral = normalize(cross([0, 1, 0], axis)), up = cross(axis, lateral);
  const inner = -50 * deg, outer = 47 * deg;
  const tiltIn = -7 * deg, tiltOut = 5 * deg;
  return {
    side, center, radius: .0105, gap: .00045, lid: .0013, axis, up, lateral, inner, outer,
    upper: t => mix(tiltIn, tiltOut, t) + 35 * deg * Math.pow(Math.sin(Math.PI * t), .62),
    lower: t => mix(tiltIn, tiltOut, t) - 30 * deg * Math.pow(Math.sin(Math.PI * t), .78),
  };
}

function eyelids(eye: EyeFrame): Shape {
  const rMid = eye.radius + eye.gap + eye.lid / 2;
  return custom(`eyelids${eye.side}`, boxAt(eye.center, eye.radius + .006), (x, y, z) => {
    const a = apertureDistance(eye, x, y, z);
    const shell = Math.abs(a.r - rMid) - eye.lid / 2;
    // The band exists outside the aperture, within ~32° of the margin, and only on the front half.
    const band = Math.max(-a.ang * rMid, (a.ang - 32 * deg) * rMid, -a.front - .002);
    return smax(shell, band, eye.lid * .85);
  });
}

function makeEar(side: Side, base01: Vec3, mid02: Vec3): EarFrame {
  const base = mirror(add(base01, [.0015, -.001, -.0005]), side);
  const up = normalize(mirror(add(normalize(sub(mid02, base01)), [.02, 0, -.06]), side));
  const front = normalize(sub([Math.sin(27 * deg) * side, .1, Math.cos(27 * deg)], scale(up, dot(up, [Math.sin(27 * deg) * side, .1, Math.cos(27 * deg)]))));
  const lateral = normalize(cross(up, front));
  return { side, base, up, front, lateral, height: .0445, width: .0395 };
}

function earShell(ear: EarFrame): Shape {
  const { base, up, front, lateral, height, width } = ear;
  const reach = height + .01;
  const box = { min: sub(base, [reach, reach, reach]), max: add(base, [reach, reach, reach]) };
  const tipR = .0042;
  return custom(`ear${ear.side}`, box, (x, y, z) => {
    const dx = x - base[0], dy = y - base[1], dz = z - base[2];
    const s = dx * lateral[0] + dy * lateral[1] + dz * lateral[2], h = dx * up[0] + dy * up[1] + dz * up[2], n = dx * front[0] + dy * front[1] + dz * front[2];
    const t = clamp(h / height, -.3, 1);
    // Cupped mid-surface: edges curl forward around a recessed concha, flattening toward the tip.
    const c = mix(30, 9, clamp(t, 0, 1));
    const mid = c * s * s - .0035 * (1 - clamp(t, 0, 1));
    const slope = 2 * c * s;
    const thick = mix(.0032, .0015, Math.pow(clamp(t, 0, 1), .7));
    const shell = Math.abs(n - mid) / Math.sqrt(1 + slope * slope) - thick / 2;
    // Outline: rounded isosceles triangle in (s, h); the inner edge is slightly convex.
    const hw = width / 2;
    const ht = height - tipR;
    const qx = Math.abs(s), qy = h;
    const edge = (hw - tipR * .2) * (1 - clamp(qy / ht, 0, 1)) + tipR * .9;
    const bulge = .0018 * Math.sin(Math.PI * clamp(qy / ht, 0, 1)) * (s * ear.side < 0 ? 1 : .3);
    const side = (qx - edge - bulge) * Math.cos(Math.atan2(hw, ht));
    const tip = Math.hypot(s, Math.max(h - ht, 0)) - tipR;
    const outline = h > ht ? tip : Math.max(side, -h - .008);
    return smax(shell, outline, thick * .9);
  });
}

function makeMouth(head: Vec3, hinge: Vec3): MouthFrame {
  const zFront = head[2] + .0828, zCorner = head[2] + .0625, ySlit = head[1] - .0132;
  const halfWidth = .0124;
  const arch = (x: number, z: number) => {
    // Front half-ellipse of the dental arch, extending past the lips; closed behind the corners.
    const cz = zCorner, rz = (zFront + .006) - cz;
    const e = Math.hypot(x / halfWidth, Math.max(z - cz, 0) / rz) - 1;
    return Math.max(e * Math.min(halfWidth, rz), cz - z);
  };
  const slitY = (x: number, z: number) => ySlit + .0024 * (x / halfWidth) ** 2 + .06 * Math.max(zFront - z, 0) * .5;
  return {
    slitY, arch, halfGap: .00058,
    cavity: { center: [0, ySlit + .0002, head[2] + .0620], radii: [.0098, .0042, .0185] },
    hinge, front: zFront, corner: [halfWidth, slitY(halfWidth, zCorner), zCorner],
  };
}

/** Paw: metapodial, foot mass, four toe lobes with digital pads, a trilobed central pad, and for
 * front paws a carpal pad and a dewclaw. Pads are registered as region 'pad'. */
function paw4(name: string, side: Side, upper: Vec3, paw: Vec3, toe: Vec3, front: boolean, reg: (s: Shape, r: Region, side: 0 | Side) => Shape): Shape {
  const region: Region = front ? 'frontPaw' : 'hindPaw';
  const fwd = normalize([toe[0] - paw[0], 0, toe[2] - paw[2]]);
  const lat: Vec3 = [fwd[2] * side, 0, -fwd[0] * side];
  const at = (o: Vec3, f: number, l: number, y: number): Vec3 => [o[0] + fwd[0] * f + lat[0] * l, y, o[2] + fwd[2] * f + lat[2] * l];
  const children: Child[] = [];
  const U = (shape: Shape, k: number): Child => ({ shape, op: 'union', k });
  const widthScale = front ? 1 : .93, lengthScale = front ? 1 : 1.06;
  children.push(U(reg(roundCone(`${name}.metapodial`, add(upper, [0, -.004, 0]), at(paw, -.002, 0, .0150), front ? .0108 : .0100, .0120 * widthScale), region, side), 0));
  children.push(U(reg(ellipsoid(`${name}.foot`, at(paw, .0035 * lengthScale, 0, .0122), [.0128 * widthScale, .0098, .0135 * lengthScale], basisFrom(fwd, [0, 1, 0])), region, side), .006));
  // Toes 2–5 from medial to lateral; the middle toes reach farthest.
  const toes = [-1.42, -.47, .47, 1.42];
  toes.forEach((u, i) => {
    const reach = (i === 1 || i === 2 ? .0138 : .0118) * lengthScale, spread = u * .0058 * widthScale;
    const c = at(paw, reach, spread, .0084);
    const dir = normalize([fwd[0] + lat[0] * u * .22, -.12, fwd[2] + lat[2] * u * .22]);
    children.push(U(reg(ellipsoid(`${name}.toe${i}`, c, [.0052 * widthScale, .0060, .0066], basisFrom(dir, [0, 1, 0])), region, side), .0016));
    children.push(U(reg(ellipsoid(`${name}.bean${i}`, add(c, [dir[0] * .0004, -.0052, dir[2] * .0004]), [.0038 * widthScale, .0026, .0043], basisFrom(dir, [0, 1, 0])), 'pad', side), .0011));
  });
  // Trilobed metacarpal/metatarsal pad under the foot.
  const padC = at(paw, -.0005, 0, .0042);
  children.push(U(reg(ellipsoid(`${name}.mainPad`, padC, [.0086 * widthScale, .0034, .0060], basisFrom(fwd, [0, 1, 0])), 'pad', side), .0012));
  for (const l of [-1, 1]) children.push(U(reg(ellipsoid(`${name}.mainPadLobe${l}`, at(padC, -.0036, l * .0052 * widthScale, .0044), [.0046, .0032, .0042], basisFrom(fwd, [0, 1, 0])), 'pad', side), .0016));
  children.push(U(reg(ellipsoid(`${name}.mainPadRear`, at(padC, -.0048, 0, .0046), [.0050, .0031, .0040], basisFrom(fwd, [0, 1, 0])), 'pad', side), .0016));
  if (front) {
    // Carpal pad on the palmar side of the wrist and the dewclaw on the medial side.
    children.push(U(reg(ellipsoid(`${name}.carpalPad`, add(upper, [0, -.0075, -.0098]), [.0032, .0042, .0026], basisFrom([0, -.4, -1], [0, 1, 0])), 'pad', side), .0012));
    const dew = add(mix3(upper, paw, .48), [-.0102 * side, .002, -.0005]);
    children.push(U(reg(ellipsoid(`${name}.dewclaw`, dew, [.0034, .0046, .0038], basisFrom([-.5 * side, -.4, 1], [0, 1, 0])), region, side), .0022));
  }
  return group(name, children);
}

export const helpers = { catmull, smin, smoothstep, mirror };
