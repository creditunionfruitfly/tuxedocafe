/**
 * The master cat sculpt as one signed distance field, built on the rig's rest joints.
 *
 * Volumes follow feline anatomy rather than one capsule per bone: a lofted trunk with a deep keel
 * and tucked waist, sliding scapulae over the withers, a thick neck, heavy haunches with hamstrings,
 * a calf that tapers into the hock, slender metapodials, four toe lobes with digital pads,
 * trilobed metacarpal/metatarsal pads, front carpal pads and dewclaws with claw pockets, a tapered
 * tail, and a skull with a projecting muzzle, whisker pads, chin, mouth slit and oral cavity,
 * nose leather with nostrils, open almond eyelid apertures around spherical sockets, and cupped
 * ear shells with a concha.
 *
 * Every frame the later stages need (eyes, ears, mouth, paws, claws) is returned with the field.
 */
import { type Basis, type Child, type Shape, type Vec3, add, basisAlong, basisFrom, capsule, clamp, cross, custom, dot, egg, ellipsoid, expand,
  group, lerp3, mix, normalize, roundCone, scale, smax, smin, smoothstep, sphere, sub } from './sdf.ts';
import { type Rig, joint } from './skeleton.ts';

export type Side = 1 | -1;
export const deg = Math.PI / 180;

export interface EyeFrame {
  side: Side; center: Vec3; radius: number; gap: number; lid: number;
  /** Optical axis, lid up direction and lateral (outward) direction. */
  axis: Vec3; up: Vec3; lateral: Vec3;
  /** Aperture outline in radians: horizontal angle range (medial negative) and lid elevations at t ∈ [0, 1]. */
  inner: number; outer: number; upper: (t: number) => number; lower: (t: number) => number;
  /** Elevation where the lids meet when closed. */
  closure: (t: number) => number;
}
export interface EarFrame { side: Side; base: Vec3; up: Vec3; front: Vec3; lateral: Vec3; height: number; width: number }
export interface MouthFrame {
  /** Mid-height of the lip slit at (x, z) and the 2D arch region (negative inside). */
  slitY: (x: number, z: number) => number; arch: (x: number, z: number) => number; halfGap: number;
  cavity: { center: Vec3; rp: Vec3; rn: Vec3; basis: Basis };
  hinge: Vec3; front: number; corner: Vec3;
}
export interface PawFrame {
  name: string; side: Side; front: boolean; fwd: Vec3; lat: Vec3; joint: Vec3;
  toes: { center: Vec3; dir: Vec3; tip: Vec3 }[]; pads: Vec3[]; dewclaw?: { center: Vec3; dir: Vec3; tip: Vec3 };
}
export interface Anatomy {
  shape: Shape; eyes: [EyeFrame, EyeFrame]; ears: [EarFrame, EarFrame]; mouth: MouthFrame; paws: PawFrame[];
  nose: { center: Vec3; radii: Vec3; basis: Basis };
  /** Named sub-shapes used to label surfaces (pads, nose leather, ears, cavity). */
  labels: Record<string, Shape>;
  landmarks: Record<string, Vec3>;
}

const mirror = (p: Vec3, side: Side): Vec3 => [p[0] * side, p[1], p[2]];
const boxAt = (c: Vec3, r: number) => ({ min: [c[0] - r, c[1] - r, c[2] - r] as Vec3, max: [c[0] + r, c[1] + r, c[2] + r] as Vec3 });

/** Monotone cubic (Fritsch–Carlson) interpolant through (xs, ys) with zero end slopes; returns value and slope. */
export function monotone(xs: number[], ys: number[]) {
  const n = xs.length, d: number[] = [], m: number[] = [];
  for (let i = 0; i + 1 < n; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  for (let i = 0; i < n; i++) m.push(i === 0 || i === n - 1 || d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2);
  for (let i = 0; i + 1 < n; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i]! / d[i]!, b = m[i + 1]! / d[i]!, hh = a * a + b * b;
    if (hh > 9) { const t = 3 / Math.sqrt(hh); m[i] = t * a * d[i]!; m[i + 1] = t * b * d[i]!; }
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

export interface Station { s: number; c: number; w: number; top: number; bottom: number; pTop?: number; pBot?: number }

/**
 * Lofted section along a straight axis from `a` toward `b`: each station gives the axial position
 * `s`, the section centre offset `c` along `up`, the half width and the half heights above/below the
 * centre, with superelliptic exponents for the upper and lower halves (flat back, keeled chest).
 * Profiles are monotone cubics; the value is the first-order distance F/|∇F| including the axial
 * taper. Ellipsoidal caps continue the end sections (zero end slopes), so the loft closes C1.
 */
export function loft(name: string, a: Vec3, b: Vec3, upHint: Vec3, stations: Station[], caps: [number, number]): Shape {
  const axis = normalize(sub(b, a)), lateral = normalize(cross(upHint, axis)), up = cross(axis, lateral);
  const S = stations.map(v => v.s);
  const fc = monotone(S, stations.map(v => v.c)), fw = monotone(S, stations.map(v => v.w)), ft = monotone(S, stations.map(v => v.top)),
    fb = monotone(S, stations.map(v => v.bottom)), fpt = monotone(S, stations.map(v => v.pTop ?? 2)), fpb = monotone(S, stations.map(v => v.pBot ?? 2));
  const s0 = S[0]!, s1 = S[S.length - 1]!;
  let box = { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 };
  for (let i = 0; i <= 64; i++) {
    const s = mix(s0 - caps[0], s1 + caps[1], i / 64), sc = clamp(s, s0, s1);
    const r = Math.max(fw(sc)[0], ft(sc)[0], fb(sc)[0]), centre = add(add(a, scale(axis, s)), scale(up, fc(sc)[0]));
    for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k]!, centre[k]! - r); box.max[k] = Math.max(box.max[k]!, centre[k]! + r); }
  }
  box = expand(box, .002);
  const [ax, ay, az] = a;
  return custom(name, box, (x, y, z) => {
    const dx = x - ax, dy = y - ay, dz = z - az;
    const sRaw = dx * axis[0] + dy * axis[1] + dz * axis[2], s = sRaw < s0 ? s0 : sRaw > s1 ? s1 : sRaw;
    const u = dx * lateral[0] + dy * lateral[1] + dz * lateral[2], vRaw = dx * up[0] + dy * up[1] + dz * up[2];
    const over = sRaw - s;
    const [c, dc] = fc(s), [w, dw] = fw(s), [top, dt] = ft(s), [bottom, db] = fb(s);
    const v = vRaw - c, upper = v > 0, hgt = upper ? top : bottom, dh = upper ? dt : db, p = upper ? fpt(s)[0] : fpb(s)[0];
    const au = Math.abs(u) / w, av = Math.abs(v) / hgt;
    const q = Math.pow(Math.pow(au, p) + Math.pow(av, p), 1 / p);
    if (q < 1e-6 && over === 0) return -Math.min(w, hgt);
    const qp = Math.pow(q, p - 1), pu = Math.pow(au, p - 1), pv = Math.pow(av, p - 1);
    const Fu = pu / (w * qp), Fv = pv / (hgt * qp) * Math.sign(v);
    if (over !== 0) {
      // Cap beyond an end station: the end section shrinks elliptically over the cap length. Value
      // and gradient match the loft at the station (end slopes are zero), so blends stay smooth.
      const L = over < 0 ? caps[0] : caps[1], ls = over / L, qc = Math.sqrt(q * q + ls * ls);
      return (qc - 1) / Math.max(Math.hypot(q / qc * Fu, q / qc * Fv, ls / (qc * L)), 1e-6);
    }
    const Fs = -Fv * dc - (pu * au) / (w * qp) * dw - (pv * av) / (hgt * qp) * dh;
    return (q - 1) / Math.max(Math.hypot(Fu, Fv, Fs), 1e-6);
  });
}

/** Angular position of a point relative to an eye and its signed angular distance to the aperture outline (negative inside). */
export function eyeAngles(eye: EyeFrame, x: number, y: number, z: number) {
  const dx = x - eye.center[0], dy = y - eye.center[1], dz = z - eye.center[2];
  const qa = dx * eye.axis[0] + dy * eye.axis[1] + dz * eye.axis[2], qu = dx * eye.up[0] + dy * eye.up[1] + dz * eye.up[2];
  const ql = dx * eye.lateral[0] + dy * eye.lateral[1] + dz * eye.lateral[2];
  const r = Math.hypot(qa, qu, ql);
  const h = Math.atan2(ql, qa), v = Math.atan2(qu, Math.hypot(qa, ql));
  const t = (h - eye.inner) / (eye.outer - eye.inner), tc = clamp(t, 0, 1);
  const upper = eye.upper(tc), lower = eye.lower(tc);
  const dv = Math.max(v - upper, lower - v), dh = Math.max(eye.inner - h, h - eye.outer);
  const ang = smax(dv, dh * 1.3, 3 * deg);
  return { ang, r, front: qa, h, v, t: tc, upper, lower };
}

export function buildCat(rig: Rig): Anatomy {
  const J = (name: string) => joint(rig, name);
  const U = (shape: Shape, k: number): Child => ({ shape, op: 'union', k });
  const S = (shape: Shape, k: number): Child => ({ shape, op: 'subtract', k });
  const labels: Record<string, Shape> = {};

  // ---------------------------------------------------------------- trunk
  // Stations along world z: dorsal and ventral skin heights, half width, fraction of the depth above
  // the widest line, and the superellipse exponents of the back and the keel.
  const st = (z: number, dorsal: number, ventral: number, w: number, ratio: number, pTop = 2.2, pBot = 2): Station => {
    const depth = dorsal - ventral, top = depth * ratio;
    return { s: z, c: dorsal - top, w, top, bottom: depth - top, pTop, pBot };
  };
  const trunk = loft('trunk', [0, 0, 0], [0, 0, 1], [0, 1, 0], [
    st(-.200, .280, .216, .030, .48, 2.1, 2.0),
    st(-.162, .298, .196, .040, .44, 2.3, 2.0),
    st(-.120, .302, .187, .042, .44, 2.3, 2.0),
    st(-.075, .299, .186, .041, .44, 2.3, 2.0),
    st(-.040, .294, .175, .044, .42, 2.2, 1.9),
    st(-.005, .291, .158, .049, .40, 2.2, 1.85),
    st(.040, .295, .146, .047, .40, 2.2, 1.8),
    st(.082, .301, .150, .043, .40, 2.1, 1.8),
    st(.116, .295, .165, .036, .44, 2.1, 1.9),
    st(.140, .280, .183, .028, .48, 2.0, 2.0),
  ], [.030, .018]);

  // ---------------------------------------------------------------- neck
  const head = J('head');
  const neckA: Vec3 = [0, .236, .104], neckB: Vec3 = [0, head[1] + .010, head[2] + .010];
  const neckLen = Math.hypot(neckB[1] - neckA[1], neckB[2] - neckA[2]);
  const neck = loft('neck', neckA, neckB, [0, 1, -0.4], [
    { s: 0, c: .002, w: .037, top: .043, bottom: .039, pTop: 2.1, pBot: 2.0 },
    { s: neckLen * .35, c: .002, w: .036, top: .038, bottom: .036, pTop: 2.1, pBot: 2.0 },
    { s: neckLen * .70, c: .000, w: .034, top: .034, bottom: .033 },
    { s: neckLen, c: -.002, w: .030, top: .030, bottom: .029 },
  ], [.02, .012]);

  const torsoChildren: Child[] = [U(trunk, 0), U(neck, .03)];
  // Pectorals: the rounded chest front between the forelegs.
  torsoChildren.push(U(egg('pectoral', [0, .178, .130], [.023, .020, .020], [.023, .026, .020], basisFrom([0, -.35, 1], [0, 1, 0])), .03));
  // Throat dewlap blending the neck into the chest.
  torsoChildren.push(U(ellipsoid('throat', [0, .216, .164], [.025, .028, .023], basisFrom([0, .7, 1], [0, 1, 0])), .025));
  // Primordial pouch ahead of the stifles.
  torsoChildren.push(U(ellipsoid('pouch', [0, .190, -.116], [.028, .012, .032]), .03));
  // Croup over the sacrum, carrying the tail root, and the rounded rump below it.
  torsoChildren.push(U(ellipsoid('croup', [0, .282, -.176], [.034, .019, .036]), .03));
  torsoChildren.push(U(ellipsoid('rump', [0, .246, -.204], [.026, .030, .022]), .03));

  for (const side of [1, -1] as const) {
    const m = (p: Vec3) => mirror(p, side);
    const L = (name: string) => mirror(J(name.replace('#', 'L')), side);
    // Scapula: a blade lying on the thorax; its dorsal border rises just proud of the withers.
    const scapTop = L('front_#_scapula'), shoulder = L('front_#_upper'), elbow = L('front_#_fore');
    const scapAxis = normalize(sub(shoulder, scapTop));
    torsoChildren.push(U(egg(`scapula${side}`, add(lerp3(scapTop, shoulder, .42), m([.004, 0, -.002])), [.0085, .044, .024], [.0085, .038, .022],
      basisAlong(scale(scapAxis, -1), [0, 0, 1])), .024));
    // Point of the shoulder.
    torsoChildren.push(U(sphere(`shoulder${side}`, add(shoulder, m([-.004, .002, -.002])), .0100), .022));
    // Upper arm: brachium in front, triceps behind, mostly inside the trunk envelope.
    const humerus = normalize(sub(elbow, shoulder));
    torsoChildren.push(U(egg(`brachium${side}`, add(lerp3(shoulder, elbow, .48), m([-.001, 0, .002])), [.0105, .050, .0150], [.0105, .050, .0125],
      basisAlong(scale(humerus, -1), [0, 0, 1])), .024));
    torsoChildren.push(U(egg(`triceps${side}`, add(lerp3(shoulder, elbow, .58), m([-.002, .004, -.013])), [.0110, .040, .0135], [.0110, .034, .0155],
      basisAlong(scale(humerus, -1), [0, 0, 1])), .024));
    // Haunch: a broad, laterally flattened thigh from the croup to the stifle.
    const hip = L('hind_#_thigh'), knee = L('hind_#_shin');
    const femur = normalize(sub(knee, hip));
    torsoChildren.push(U(egg(`haunch${side}`, add(lerp3(hip, knee, .42), m([-.014, .004, -.010])), [.0310, .058, .040], [.0260, .064, .044],
      basisAlong(scale(femur, -1), [0, 0, 1])), .04));
    // Hamstrings: the rear thigh line from the ischium down to the calf.
    torsoChildren.push(U(egg(`hamstring${side}`, m([.024, .198, -.209]), [.0165, .044, .017], [.0150, .044, .016], basisAlong([.12, 1, -.12], [0, 0, -1])), .025));
  }
  const torso = group('torso', torsoChildren);

  // ---------------------------------------------------------------- legs and paws
  const limbs: Child[] = [];
  const paws: PawFrame[] = [];
  for (const side of [1, -1] as const) {
    const L = (name: string) => mirror(J(name.replace('#', 'L')), side);
    const m = (p: Vec3) => mirror(p, side);
    // Foreleg below the elbow.
    const elbow = L('front_#_fore'), wrist = L('front_#_wrist'), paw = L('front_#_paw'), toe = L('front_#_toe');
    const radius = normalize(sub(wrist, elbow));
    const fore: Child[] = [
      U(sphere(`olecranon${side}`, add(elbow, m([.000, .004, -.0095])), .0100), 0),
      U(roundCone(`forearm${side}`, add(elbow, [0, -.006, .002]), add(wrist, [0, .008, 0]), .0150, .0106), .008),
      U(egg(`forearmMuscle${side}`, add(lerp3(elbow, wrist, .27), m([.0015, 0, .003])), [.0135, .032, .0145], [.0130, .028, .0130], basisAlong(scale(radius, -1), [0, 0, 1])), .01),
      U(sphere(`carpus${side}`, add(wrist, [0, .001, -.0005]), .0110), .006),
    ];
    limbs.push(U(group(`foreleg${side}`, fore), .012));
    const fp = paw4(`frontPaw${side}`, side, true, wrist, paw, toe, labels);
    paws.push(fp.frame);
    limbs.push(U(fp.shape, .005));
    // Hind leg below the stifle.
    const knee = L('hind_#_shin'), hock = L('hind_#_hock'), meta = L('hind_#_metatarsal'), hpaw = L('hind_#_paw'), htoe = L('hind_#_toe');
    const tibia = normalize(sub(hock, knee)), back = normalize(cross([side, 0, 0], tibia));
    const calfBack: Vec3 = dot(back, [0, 0, -1]) > 0 ? back : scale(back, -1);
    const hind: Child[] = [
      U(sphere(`stifle${side}`, add(knee, m([.000, .003, .003])), .0115), 0),
      U(roundCone(`shank${side}`, knee, add(hock, [0, .003, 0]), .0140, .0088), .01),
      U(egg(`calf${side}`, add(lerp3(knee, hock, .34), scale(calfBack, .0085)), [.0120, .028, .0125], [.0120, .036, .0110], basisAlong(scale(tibia, -1), calfBack)), .012),
      U(capsule(`achilles${side}`, add(lerp3(knee, hock, .62), scale(calfBack, .0105)), add(hock, scale(calfBack, .0095)), .0042), .008),
      U(sphere(`calcaneus${side}`, add(hock, add(scale(calfBack, .0098), [0, .002, 0])), .0060), .005),
      U(sphere(`tarsus${side}`, add(hock, [0, -.003, .001]), .0088), .006),
      U(roundCone(`metatarsus${side}`, add(meta, [0, 0, .001]), add(hpaw, [0, .006, -.004]), .0096, .0108), .008),
    ];
    limbs.push(U(group(`hindleg${side}`, hind), .012));
    const hp = paw4(`hindPaw${side}`, side, false, meta, hpaw, htoe, labels);
    paws.push(hp.frame);
    limbs.push(U(hp.shape, .005));
  }

  // ---------------------------------------------------------------- tail
  const tailPoints: Vec3[] = [], tailRadii: number[] = [];
  for (let i = 1; i <= 12; i++) tailPoints.push(J(`tail_${String(i).padStart(2, '0')}`));
  const last = tailPoints[11]!, prev = tailPoints[10]!;
  tailPoints.push(add(last, scale(normalize(sub(last, prev)), .022)));
  for (let i = 0; i < tailPoints.length; i++) {
    const t = i / (tailPoints.length - 1);
    tailRadii.push(mix(.0128, .0068, Math.pow(t, .9)));
  }
  tailRadii[tailRadii.length - 1] = .0058;
  tailPoints.unshift(add(tailPoints[0]!, [0, .006, .026])); tailRadii.unshift(.0165);
  const tailParts: Child[] = [];
  for (let i = 0; i + 1 < tailPoints.length; i++) tailParts.push(U(roundCone(`tail.${i}`, tailPoints[i]!, tailPoints[i + 1]!, tailRadii[i]!, tailRadii[i + 1]!), 0));
  const tail = group('tail', tailParts);

  // ---------------------------------------------------------------- head
  const H = (dx: number, dy: number, dz: number): Vec3 => [head[0] + dx, head[1] + dy, head[2] + dz];
  const eyeL = J('eye_L');
  const eyes = ([1, -1] as const).map(side => makeEye(mirror(eyeL, side), side)) as [EyeFrame, EyeFrame];
  const ears = ([1, -1] as const).map(side => makeEar(side, J('ear_L_01'), J('ear_L_02'))) as [EarFrame, EarFrame];

  const skull: Child[] = [];
  // Cranium and occiput.
  skull.push(U(ellipsoid('cranium', H(0, .0210, .0210), [.0265, .0280, .0330]), 0));
  // Face mass: one continuous dome over the orbits, zygomatic arches, masseters and cheek pads.
  skull.push(U(egg('face', H(0, .0070, .0360), [.0325, .0250, .0270], [.0325, .0230, .0300]), .020));
  skull.push(U(ellipsoid('occiput', H(0, .0100, .0000), [.0245, .0230, .0185]), .012));
  // Forehead: fills between the brows and carries the stop down onto the nose bridge.
  skull.push(U(ellipsoid('forehead', H(0, .0310, .0420), [.0180, .0125, .0170], basisFrom([0, -.6, 1], [0, 1, 0])), .014));
  for (const side of [1, -1] as const) {
    const m = (dx: number, dy: number, dz: number) => H(dx * side, dy, dz);
    // Broad feline cheeks: zygomatic arch and masseter below and behind the eye.
    // Brow over the eye.
    skull.push(U(ellipsoid(`brow${side}`, m(.0150, .0335, .0500), [.0105, .0055, .0090], basisFrom([side * .35, -.25, 1], [0, 1, 0])), .008));
    // Whisker pads: the rounded mystacial pads either side of the philtrum.
    skull.push(U(ellipsoid(`whiskerPad${side}`, m(.0070, -.0094, .0722), [.0081, .0076, .0076], basisFrom([side * .40, -.22, 1], [0, 1, 0])), .0045));
    // Mandible from the chin back to the jaw angle.
    skull.push(U(roundCone(`mandible${side}`, m(.0045, -.0232, .0610), m(.0200, -.0205, .0230), .0054, .0075), .008));
  }
  // Nose bridge from the stop down to the nose leather, the maxilla behind the whisker pads.
  skull.push(U(roundCone('noseBridge', H(0, .0255, .0590), H(0, .0050, .0755), .0074, .0055), .008));
  skull.push(U(ellipsoid('maxilla', H(0, -.0030, .0640), [.0125, .0105, .0130]), .010));
  skull.push(U(ellipsoid('chin', H(0, -.0232, .0640), [.0068, .0056, .0066]), .006));
  skull.push(U(ellipsoid('jawFloor', H(0, -.0200, .0400), [.0155, .0085, .0250]), .010));
  // Nose leather: a rounded inverted triangle at the tip of the muzzle, facing forward and down.
  const noseCenter = H(0, -.0002, .0798), noseRadii: Vec3 = [.0068, .0050, .0044];
  const noseBasis = basisFrom([0, -.55, 1], [0, 1, 0]);
  const noseLeather = custom('noseLeather', boxAt(noseCenter, .009), (x, y, z) => {
    const dx = x - noseCenter[0], dy = y - noseCenter[1], dz = z - noseCenter[2];
    const lx = dx * noseBasis[0][0] + dy * noseBasis[0][1] + dz * noseBasis[0][2], ly = dx * noseBasis[1][0] + dy * noseBasis[1][1] + dz * noseBasis[1][2];
    const lz = dx * noseBasis[2][0] + dy * noseBasis[2][1] + dz * noseBasis[2][2];
    const w = noseRadii[0] * (.50 + .50 * smoothstep(-noseRadii[1], noseRadii[1] * .7, ly));
    const k0 = Math.hypot(lx / w, ly / noseRadii[1], lz / noseRadii[2]), k1 = Math.hypot(lx / (w * w), ly / (noseRadii[1] ** 2), lz / (noseRadii[2] ** 2));
    return k0 < 1e-9 ? -noseRadii[2] : k0 * (k0 - 1) / k1;
  });
  labels.noseLeather = noseLeather;
  skull.push(U(noseLeather, .0025));

  // Ears: cupped shells with thickness and a concha, on a muscular base blended into the cranium.
  for (const ear of ears) {
    skull.push(U(ellipsoid(`earBase${ear.side}`, add(ear.base, scale(ear.up, -.002)), [.0175, .0105, .0085], basisFrom(ear.front, ear.up)), .008));
    const shell = earShell(ear);
    labels[`ear${ear.side}`] = shell;
    skull.push(U(shell, .0045));
  }

  // Periorbital fill: skin wraps the globe so the lids sit on a sphere around the eyeball.
  for (const eye of eyes) {
    const rOuter = eye.radius + eye.gap + eye.lid;
    skull.push(U(sphere(`orbit${eye.side}`, eye.center, rOuter), .0055));
  }
  // Apertures: open the almond through the lid shell; the socket gives the globe its clearance.
  for (const eye of eyes) {
    const rOuter = eye.radius + eye.gap + eye.lid;
    skull.push(S(custom(`aperture${eye.side}`, boxAt(eye.center, eye.radius + .012), (x, y, z) => {
      const a = eyeAngles(eye, x, y, z);
      return Math.max(a.ang * a.r, a.r - (rOuter + .006), -a.front);
    }), eye.lid * .55));
    skull.push(S(sphere(`socket${eye.side}`, eye.center, eye.radius + eye.gap), .0002));
  }

  // Nostrils (comma-shaped, blind) and the philtrum groove.
  for (const side of [1, -1] as const) {
    const n = (dx: number, dy: number, dz: number) => H(dx * side, dy, dz);
    // Comma-shaped nostril: an oval pit on the lower lateral nose leather, its long axis rising outward.
    skull.push(S(ellipsoid(`nostril${side}`, n(.0034, -.0011, .0820), [.0021, .0011, .0026], basisFrom([side * .45, -.25, 1], [side * .75, 1, 0])), .0005));
  }
  skull.push(S(capsule('philtrum', H(0, -.0056, .0814), H(0, -.0132, .0788), .00075), .0006));

  // Mouth: closed lips separated by a thin slit that opens into a closed oral cavity.
  const mouth = makeMouth(head, J('jaw'));
  const slit = custom('mouthSlit', { min: [-.02, head[1] - .032, head[2] + .035], max: [.02, head[1] - .002, head[2] + .095] },
    (x, y, z) => Math.max(Math.abs(y - mouth.slitY(x, z)) - mouth.halfGap, mouth.arch(x, z)));
  skull.push(S(slit, .0004));
  const cavity = egg('oralCavity', mouth.cavity.center, mouth.cavity.rp, mouth.cavity.rn, mouth.cavity.basis);
  labels.cavity = cavity;
  skull.push(S(cavity, .0012));

  const headShape = group('head', skull);
  const shape = group('cat', [U(torso, 0), U(headShape, .018), U(tail, .016), ...limbs]);
  for (const p of paws) for (const k of ['pads']) void k;
  return {
    shape, eyes, ears, mouth, paws, labels,
    nose: { center: noseCenter, radii: noseRadii, basis: noseBasis },
    landmarks: { head, jaw: J('jaw'), noseCenter, noseTip: add(noseCenter, scale(noseBasis[2], noseRadii[2])) },
  };
}

function makeEye(center: Vec3, side: Side): EyeFrame {
  // Optical axis: forward, 9° outward and 3° down. Lids hug a 10.5 mm globe.
  const yaw = 9 * deg, pitch = 3 * deg;
  const axis = normalize([Math.sin(yaw) * Math.cos(pitch) * side, -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
  const lateral = normalize(cross([0, 1, 0], axis)), lat = dot(lateral, [side, 0, 0]) > 0 ? lateral : scale(lateral, -1);
  const up = normalize(cross(axis, lat)), upFixed = up[1] > 0 ? up : scale(up, -1);
  const inner = -44 * deg, outer = 45 * deg;
  // The lid line rises toward the outer corner (oblique almond); the inner corner is the sharper
  // tear-duct canthus, the outer corner is rounder.
  const tilt = (t: number) => mix(-5 * deg, 6 * deg, t);
  const shapeU = (t: number) => Math.pow(Math.sin(Math.PI * Math.pow(t, .82)), .62);
  const shapeL = (t: number) => Math.pow(Math.sin(Math.PI * Math.pow(t, .90)), .70);
  return {
    side, center, radius: .0105, gap: .00045, lid: .0017, axis, up: upFixed, lateral: lat, inner, outer,
    upper: t => tilt(t) + 31 * deg * shapeU(t),
    lower: t => tilt(t) - 27 * deg * shapeL(t),
    closure: t => tilt(t) - 27 * deg * shapeL(t) * .55,
  };
}

function makeEar(side: Side, base01: Vec3, mid02: Vec3): EarFrame {
  const base = mirror(base01, side);
  const up = normalize(mirror(add(normalize(sub(mid02, base01)), [.05, 0, -.05]), side));
  const facing: Vec3 = [Math.sin(24 * deg) * side, .05, Math.cos(24 * deg)];
  const front = normalize(sub(facing, scale(up, dot(up, facing))));
  const lateral = normalize(cross(up, front));
  return { side, base, up, front, lateral, height: .050, width: .043 };
}

/** Ear shell local coordinates: across (s), height (h), depth toward the opening (n), the cupped
 * mid-surface depth, its slope, the shell thickness and the signed distance to the outline (negative inside). */
export function earLocal(ear: EarFrame, x: number, y: number, z: number) {
  const { base, up, front, lateral, height, width } = ear;
  const tipR = .0045;
  const dx = x - base[0], dy = y - base[1], dz = z - base[2];
  const s = dx * lateral[0] + dy * lateral[1] + dz * lateral[2], h = dx * up[0] + dy * up[1] + dz * up[2], n = dx * front[0] + dy * front[1] + dz * front[2];
  const t = clamp(h / height, 0, 1);
  // Cupped mid-surface: the edges curl forward around a recessed concha, flattening toward the tip.
  const c = mix(24, 6, Math.pow(t, .8));
  const recess = .0032 * (1 - t) * (1 - t);
  const mid = c * s * s - recess, slope = 2 * c * s;
  const thick = mix(.0029, .0018, Math.pow(t, .75));
  // Outline: rounded isosceles triangle in (s, h); the outer edge bows out, the inner edge is straighter.
  const hw = width / 2, ht = height - tipR, qy = clamp(h / ht, 0, 1);
  const outer = s * (dot(lateral, [ear.side, 0, 0]) > 0 ? 1 : -1) > 0;
  const edge = (hw - tipR) * (1 - qy) + tipR + (outer ? .0028 : .0010) * Math.sin(Math.PI * qy);
  const sideDist = (Math.abs(s) - edge) * Math.cos(Math.atan2(hw, ht));
  const tip = Math.hypot(s, Math.max(h - ht, 0)) - tipR;
  const outline = h > ht ? tip : Math.max(sideDist, -h - .005);
  return { s, h, n, t, mid, slope, thick, outline };
}

function earShell(ear: EarFrame): Shape {
  const reach = ear.height + .012;
  const box = { min: sub(ear.base, [reach, reach, reach]), max: add(ear.base, [reach, reach, reach]) };
  return custom(`ear${ear.side}`, box, (x, y, z) => {
    const e = earLocal(ear, x, y, z);
    const shell = Math.abs(e.n - e.mid) / Math.sqrt(1 + e.slope * e.slope) - e.thick / 2;
    return smax(shell, e.outline, e.thick * .45);
  });
}

function makeMouth(head: Vec3, hinge: Vec3): MouthFrame {
  // Lip line: from the philtrum base around the dental arch to the commissures under the eyes.
  const zFront = head[2] + .0800, zCorner = head[2] + .0585, yFront = head[1] - .0152, yCorner = head[1] - .0176;
  const halfWidth = .0122;
  const arch = (x: number, z: number) => {
    const cz = zCorner, rz = (zFront + .008) - cz;
    const e = Math.hypot(x / halfWidth, Math.max(z - cz, 0) / rz) - 1;
    return Math.max(e * Math.min(halfWidth, rz), cz - .006 - z);
  };
  const slitY = (x: number, z: number) => mix(yFront, yCorner, clamp((x / halfWidth) ** 2, 0, 1)) - .0012 * clamp((zFront - z) / .02, 0, 1);
  return {
    slitY, arch, halfGap: .00072,
    cavity: { center: [0, head[1] - .0172, head[2] + .0480], rp: [.0108, .0048, .0235], rn: [.0108, .0058, .0200], basis: basisFrom([0, .18, 1], [0, 1, 0]) },
    hinge, front: zFront, corner: [halfWidth, yCorner, zCorner],
  };
}

/** Paw: metapodial, foot mass, four toe lobes with digital pads and claw pockets, a trilobed
 * central pad, and for front paws a carpal pad and a dewclaw. */
function paw4(name: string, side: Side, front: boolean, upper: Vec3, paw: Vec3, toe: Vec3, labels: Record<string, Shape>): { shape: Shape; frame: PawFrame } {
  const fwd = normalize([toe[0] - paw[0], 0, toe[2] - paw[2]]);
  const lat: Vec3 = [fwd[2] * side, 0, -fwd[0] * side];
  const at = (o: Vec3, f: number, l: number, y: number): Vec3 => [o[0] + fwd[0] * f + lat[0] * l, y, o[2] + fwd[2] * f + lat[2] * l];
  const children: Child[] = [];
  const U = (shape: Shape, k: number): Child => ({ shape, op: 'union', k });
  const Sb = (shape: Shape, k: number): Child => ({ shape, op: 'subtract', k });
  const ws = front ? 1.10 : 1.0, ls = front ? 1.08 : 1.18;
  const pads: Shape[] = [], sheaths: Shape[] = [];
  children.push(U(roundCone(`${name}.metapodial`, add(upper, [0, -.003, 0]), at(paw, -.003, 0, .0145), front ? .0100 : .0092, .0118 * ws), 0));
  children.push(U(ellipsoid(`${name}.foot`, at(paw, .0030 * ls, 0, .0115), [.0128 * ws, .0090, .0132 * ls], basisFrom(fwd, [0, 1, 0])), .006));
  // Toes II–V from medial to lateral; the middle toes reach farthest.
  const toeFrames: PawFrame['toes'] = [];
  const spread = [-1.45, -.48, .48, 1.45];
  spread.forEach((u, i) => {
    const reach = (i === 1 || i === 2 ? .0150 : .0124) * ls, off = u * .0061 * ws;
    const c = at(paw, reach, off, .0072);
    const dir = normalize([fwd[0] + lat[0] * u * .2, -.10, fwd[2] + lat[2] * u * .2]);
    children.push(U(ellipsoid(`${name}.toe${i}`, c, [.0051 * ws, .0060, .0066], basisFrom(dir, [0, 1, 0])), .0014));
    const bean = ellipsoid(`${name}.bean${i}`, add(c, [dir[0] * .0006, -.0045, dir[2] * .0006]), [.0038 * ws, .0026, .0044], basisFrom(dir, [0, 1, 0]));
    pads.push(bean);
    children.push(U(bean, .0010));
    const tip = add(c, add(scale(dir, .0066), [0, .0006, 0]));
    toeFrames.push({ center: c, dir, tip });
    // Claw pocket: the sheath opening at the dorsal tip of the toe, where the retracted claw rests.
    const sheath = ellipsoid(`${name}.sheath${i}`, add(c, add(scale(dir, .0064), [0, .0006, 0])), [.00115, .0010, .0024], basisFrom(normalize(add(dir, [0, .12, 0])), [0, 1, 0]));
    sheaths.push(sheath);
    children.push(Sb(sheath, .0005));
  });
  // Trilobed metacarpal/metatarsal pad under the foot.
  const padC = at(paw, -.0010, 0, .0040);
  const main = ellipsoid(`${name}.mainPad`, padC, [.0088 * ws, .0034, .0062], basisFrom(fwd, [0, 1, 0]));
  pads.push(main);
  children.push(U(main, .0012));
  for (const l of [-1, 1]) {
    const lobe = ellipsoid(`${name}.mainPadLobe${l}`, at(padC, -.0036, l * .0054 * ws, .0043), [.0046, .0031, .0042], basisFrom(fwd, [0, 1, 0]));
    pads.push(lobe); children.push(U(lobe, .0015));
  }
  const rear = ellipsoid(`${name}.mainPadRear`, at(padC, -.0050, 0, .0045), [.0050, .0030, .0040], basisFrom(fwd, [0, 1, 0]));
  pads.push(rear); children.push(U(rear, .0015));
  let dewclaw: PawFrame['dewclaw'];
  if (front) {
    // Carpal pad on the palmar side of the wrist and the dewclaw on the medial side.
    const carpal = ellipsoid(`${name}.carpalPad`, add(upper, [0, -.0060, -.0098]), [.0032, .0040, .0026], basisFrom([0, -.4, -1], [0, 1, 0]));
    pads.push(carpal); children.push(U(carpal, .0012));
    const dewC = add(lerp3(upper, paw, .52), [-.0098 * side, .001, .001]);
    const dewDir = normalize([-.35 * side, -.55, 1]);
    children.push(U(ellipsoid(`${name}.dewclaw`, dewC, [.0032, .0044, .0040], basisFrom(dewDir, [0, 1, 0])), .0022));
    const dewSheath = ellipsoid(`${name}.dewSheath`, add(dewC, scale(dewDir, .0036)), [.0012, .0010, .0022], basisFrom(dewDir, [0, 1, 0]));
    sheaths.push(dewSheath);
    children.push(Sb(dewSheath, .0005));
    dewclaw = { center: dewC, dir: dewDir, tip: add(dewC, scale(dewDir, .0040)) };
  }
  labels[`${name}.pads`] = group(`${name}.pads`, pads.map(p => U(p, .001)));
  labels[`${name}.sheaths`] = group(`${name}.sheaths`, sheaths.map(p => U(p, 0)));
  return {
    shape: group(name, children),
    frame: { name, side, front, fwd, lat, joint: paw, toes: toeFrames, pads: [], dewclaw },
  };
}

export const helpers = { smin, mix };
