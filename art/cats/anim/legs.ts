// Analytic leg solve for one limb (M2-0 rig contract): the scapula or hip
// takes its share of the swing, the two-bone chain (upper/fore/wrist,
// thigh/shin/hock) is solved analytically with the elbow behind and the
// knee in front of the limb axis, and the distal metapodial and digit
// segments are posed either planted (world angles: the pads stay exactly on
// their target) or free (joint angles relative to the forearm or shank, so a
// lifted forepaw folds back at the carpus and a hind paw hangs from the hock).
import { Matrix4, Quaternion, Vector3 } from 'three';
import { type LegDef, type Pose, type Rig, type World } from './rig.ts';

const wrapPi = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

export type V3 = [number, number, number];

export interface Leg {
  /** World target of the toe joint (the digital pads). */
  toe: V3;
  /** Optional direct target for the wrist / hock joint, blended by cw (0 = aim the toe). */
  c: V3; cw: number;
  /** Planted mode: metapodial axis (wrist or hock to paw joint) pitch below horizontal (rad). */
  meta: number;
  /** Planted mode: digit pitch below horizontal (rad); the pads stay on the toe target. */
  dig: number;
  /** 0 = planted (world angles), 1 = free (joint angles below). */
  rel: number;
  /** Free mode: flexion at the carpus / hock (rad, 0 = in line with the forearm / shank; + folds the forepaw back or flexes the hock). */
  carpus: number;
  /** Free mode: digit angle from the metapodial axis (rad, + curls down, - extends up). */
  digits: number;
  /** Toe bone flex (claw curl, + curls) and digit spread (rad). */
  curl: number; spread: number;
  /** Paw heading (+ left), toe-out (+ outward for that side), sole roll (+ inward). */
  yaw: number; out: number; roll: number;
  /** Scapula / hip rotation: share of the limb's protraction plus an offset (+ protracts). */
  share: number; swing: number;
  /** Preferred forearm / shank angle from vertical in the girdle's sagittal plane (+ distal end forward), plus a share of the limb's protraction, and its weight. */
  fore: number; foreK: number; foreW: number;
  /** Twist of the elbow / knee outward (rad). */
  abduct: number;
  /** Scapula slide (m; front legs only): dorsal (the stance blade rides up against the spine) and forward glide along the ribs. */
  slide: number; glide: number;
}

export interface LegInfo {
  /** Distance by which the toe misses its target (m) and the chain's extension (distance / reach). */
  reachError: number; reach: number;
  /** Joint angles after the solve (rad): middle (elbow / knee interior), carpus / hock flexion, digits, scapula / hip rotation. */
  mid: number; carpus: number; digits: number; prox: number;
  /** Forearm / shank angle from vertical (+ forward). */
  fore: number;
}

const AXIS_X = new Vector3(1, 0, 0), UP = new Vector3(0, 1, 0);
/** Scapula / hip rotation beyond this (rad) is strongly resisted. */
const PROX_MAX = 62 * Math.PI / 180;
/** Tightest elbow / knee fold the solver allows (rad). */
const MID_MIN = 24 * Math.PI / 180;
const tmpM = new Matrix4();

/** Rotation whose X/Y/Z columns are the frame built from a direction (e1) and a lateral axis (e2). */
export function frameQuat(dir: Vector3, lateral: Vector3, out = new Quaternion()) {
  const e1 = dir.clone().normalize();
  const e2 = lateral.clone().addScaledVector(e1, -lateral.dot(e1));
  if (e2.lengthSq() < 1e-12) e2.set(0, 0, 1).addScaledVector(e1, -e1.z);
  e2.normalize();
  const e3 = new Vector3().crossVectors(e1, e2);
  return out.setFromRotationMatrix(tmpM.makeBasis(e1, e2, e3));
}

/** World rotation taking a rest segment (rest direction, rest lateral = +X) to a posed direction and lateral axis. */
export function segmentRot(restDir: Vector3, dir: Vector3, lateral: Vector3) {
  return frameQuat(dir, lateral).multiply(frameQuat(restDir, AXIS_X).invert());
}

export function defaultLeg(d: LegDef): Leg {
  const t = d.restToe;
  return {
    toe: [t.x, t.y, t.z], c: [0, 0, 0], cw: 0,
    meta: d.stanceMeta, dig: d.digRestPitch, rel: 0,
    carpus: 0, digits: d.dRest, curl: 0, spread: 0, yaw: 0, out: 0, roll: 0,
    share: 0.35, swing: 0, fore: d.foreRest, foreK: 0.5, foreW: d.front ? 1 : 0.3, abduct: 0, slide: 0, glide: 0,
  };
}

const rotAbout = (v: Vector3, axis: Vector3, angle: number) => v.clone().applyQuaternion(new Quaternion().setFromAxisAngle(axis, angle));

/**
 * Solve one leg into pose.q given world joint frames W of the trunk (legs not yet posed).
 * Returns diagnostics; writes local rotations for prox, chain, metapodials, paw, toe and digits.
 */
export function solveLeg(rig: Rig, pose: Pose, W: World, d: LegDef, L: Leg): LegInfo {
  const q = pose.q;
  const G = W.rot[d.girdle]!, P0 = W.pos[d.prox]!;
  const nG = AXIS_X.clone().applyQuaternion(G), upG = UP.clone().applyQuaternion(G), fwdG = new Vector3(0, 0, 1).applyQuaternion(G);
  const offA = rig.offset[d.a]!;
  const Lsum = d.L1 + d.L2, hi = 0.996 * Lsum, lo = Math.sqrt(d.L1 * d.L1 + d.L2 * d.L2 - 2 * d.L1 * d.L2 * Math.cos(MID_MIN));
  const cs = d.front ? 1 : -1;

  // Paw frame for planted mode.
  const h = L.yaw + d.side * L.out;
  const fwd = new Vector3(Math.sin(h), 0, Math.cos(h));
  const lat = rotAbout(new Vector3(Math.cos(h), 0, -Math.sin(h)), fwd, d.side * L.roll);
  const rm = d.metaVec.clone().normalize(), rd = d.digVec.clone().normalize();
  const dirPitch = (p: number) => fwd.clone().multiplyScalar(Math.cos(p)).addScaledVector(UP, -Math.sin(p));
  const RmW = segmentRot(rm, dirPitch(L.meta), lat), RdW = segmentRot(rd, dirPitch(L.dig), lat);
  const T = new Vector3(...L.toe);
  const restC = rig.restWorld[d.c]!, restP0 = rig.restWorld[d.prox]!;
  const restSwing = Math.atan2(restC.z - restP0.z, -(restC.y - restP0.y));
  const Ginv = G.clone().invert();
  const restA = rig.restWorld[d.a]!, restB = rig.restWorld[d.b]!;

  const A = new Vector3(), B = new Vector3(), Cr = new Vector3(), u = new Vector3(), nP = new Vector3(), v = new Vector3(), tmp = new Vector3();
  const qa = new Quaternion();
  /** Two-bone placement for prox angle alpha toward target C; fills A, B, Cr; returns reach violation and forearm angle. */
  const place = (alpha: number, C: Vector3, n: Vector3) => {
    qa.setFromAxisAngle(AXIS_X, alpha).premultiply(G);
    A.copy(offA).applyQuaternion(qa).add(P0);
    u.subVectors(C, A);
    const dist = u.length();
    const dc = Math.min(Math.max(dist, lo), hi);
    u.divideScalar(dist || 1);
    nP.copy(n).addScaledVector(u, -n.dot(u));
    if (nP.lengthSq() < 1e-10) nP.copy(nG).addScaledVector(u, -nG.dot(u));
    nP.normalize();
    v.crossVectors(nP, u).multiplyScalar(d.bendSign);
    const cosA = Math.min(1, Math.max(-1, (d.L1 * d.L1 + dc * dc - d.L2 * d.L2) / (2 * d.L1 * dc)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    B.copy(A).addScaledVector(u, d.L1 * cosA).addScaledVector(v, d.L1 * sinA);
    Cr.copy(A).addScaledVector(u, dc);
    tmp.subVectors(Cr, B);
    const fore = Math.atan2(tmp.dot(fwdG), -tmp.dot(upG));
    const viol = dist > hi ? dist - hi : dist < lo ? lo - dist : 0;
    return { viol, fore };
  };

  // Hinge axis: the girdle's lateral axis twisted about the limb axis by the abduction.
  const hingeFor = (C: Vector3) => {
    const axis = C.clone().sub(P0).normalize();
    return rotAbout(nG, axis, d.side * d.bendSign * L.abduct);
  };

  /** Distal frames for a given forearm / shank direction (null: planted angles only). */
  const distal = (f: Vector3 | null, hingeAxis: Vector3) => {
    if (!f || L.rel <= 1e-6) return { Rm: RmW.clone(), Rd: RdW.clone() };
    const dm = rotAbout(f, hingeAxis, cs * L.carpus);
    const RmF = segmentRot(rm, dm, hingeAxis), RdF = segmentRot(rd, rotAbout(dm, hingeAxis, L.digits), hingeAxis);
    const w = Math.min(1, L.rel);
    return { Rm: RmW.clone().slerp(RmF, w), Rd: RdW.clone().slerp(RdF, w) };
  };
  /** Full placement for a forearm guess: distal frames, wrist target, prox angle search and the two-bone solve. */
  const evaluate = (f: Vector3 | null, hingeGuess: Vector3, warm: number | null) => {
    const { Rm, Rd } = distal(f, hingeGuess);
    const Cstar = T.clone().sub(d.digVec.clone().applyQuaternion(Rd)).sub(d.metaVec.clone().applyQuaternion(Rm));
    const C = L.cw > 0 ? Cstar.lerp(new Vector3(...L.c), Math.min(1, L.cw)) : Cstar;
    const n = hingeFor(C);
    // Preferred prox angle: a share of the limb's protraction about the girdle's lateral axis.
    const cur = C.clone().sub(P0).applyQuaternion(Ginv);
    const theta = Math.atan2(cur.z, -cur.y) - restSwing;
    const pref = L.share * theta + L.swing, foreWant = L.fore + L.foreK * theta;
    const cost = (a: number) => {
      const r = place(a, C, n);
      const over = Math.max(0, Math.abs(a) - PROX_MAX);
      return 4e4 * (r.viol / Lsum) ** 2 + L.foreW * (r.fore - foreWant) ** 2 + (a - pref) ** 2 + 3000 * over * over;
    };
    // Coarse scan, then golden-section refinement: continuous in the inputs, so frames vary smoothly.
    const center = warm ?? pref, span = warm === null ? 0.9 : 0.25, step = span / 45;
    let best = center, bestC = Infinity;
    for (let k = -45; k <= 45; k++) { const a = center + k * step, c = cost(a); if (c < bestC) { bestC = c; best = a; } }
    let lo2 = best - step, hi2 = best + step;
    const gr = (Math.sqrt(5) - 1) / 2;
    let x1 = hi2 - gr * (hi2 - lo2), x2 = lo2 + gr * (hi2 - lo2), f1 = cost(x1), f2 = cost(x2);
    for (let k = 0; k < 40; k++) {
      if (f1 < f2) { hi2 = x2; x2 = x1; f2 = f1; x1 = hi2 - gr * (hi2 - lo2); f1 = cost(x1); }
      else { lo2 = x1; x1 = x2; f1 = f2; x2 = lo2 + gr * (hi2 - lo2); f2 = cost(x2); }
    }
    const alpha = (lo2 + hi2) / 2;
    place(alpha, C, n);
    return { C, n, alpha, Rm, Rd, fore: Cr.clone().sub(B).normalize(), hinge: nP.clone() };
  };

  let sol = evaluate(null, nG, null);
  if (L.rel > 1e-6 && L.cw < 1 - 1e-6) {
    // Free distal angles depend on the forearm, which depends on where the wrist lands: solve
    // g(phi) = phi'(phi) - phi for the forearm angle phi in the hinge plane by the secant method.
    const plane = (hingeAxis: Vector3) => {
      const down = upG.clone().negate().addScaledVector(hingeAxis, upG.dot(hingeAxis)).normalize();
      const ahead = new Vector3().crossVectors(hingeAxis, down).negate(); // forward in the plane
      return { down, ahead };
    };
    const angleOf = (f: Vector3, hingeAxis: Vector3) => { const p = plane(hingeAxis); return Math.atan2(f.dot(p.ahead), f.dot(p.down)); };
    const dirOf = (phi: number, hingeAxis: Vector3) => { const p = plane(hingeAxis); return p.down.multiplyScalar(Math.cos(phi)).addScaledVector(p.ahead, Math.sin(phi)); };
    let hingeAxis = sol.hinge;
    const g = (phi: number) => {
      const r = evaluate(dirOf(phi, hingeAxis), hingeAxis, sol.alpha);
      return { r, val: wrapPi(angleOf(r.fore, hingeAxis) - phi) };
    };
    let x0 = angleOf(sol.fore, hingeAxis), e0 = g(x0);
    let x1 = x0 + 0.5 * e0.val, e1 = g(x1);
    let bestR = Math.abs(e0.val) < Math.abs(e1.val) ? e0 : e1;
    for (let it = 0; it < 24 && Math.abs(e1.val) > 1e-9; it++) {
      const den = e1.val - e0.val;
      let x2 = Math.abs(den) > 1e-12 ? x1 - e1.val * (x1 - x0) / den : x1 + 0.5 * e1.val;
      if (!Number.isFinite(x2) || Math.abs(x2 - x1) > 0.6) x2 = x1 + Math.sign(x2 - x1 || 1) * 0.6;
      x0 = x1; e0 = e1; x1 = x2; e1 = g(x1);
      hingeAxis = e1.r.hinge;
      if (Math.abs(e1.val) < Math.abs(bestR.val)) bestR = e1;
    }
    sol = bestR.r;
  }
  const { C, n, alpha } = sol;
  let { Rm, Rd } = sol;

  // Final placement and bone rotations.
  const info = place(alpha, C, n);
  const Aw = A.clone(), Bw = B.clone(), Cw = Cr.clone(), hinge = nP.clone();
  const Wprox = G.clone().multiply(new Quaternion().setFromAxisAngle(AXIS_X, alpha));
  const Wa = segmentRot(restB.clone().sub(restA), Bw.clone().sub(Aw), hinge);
  const Wb = segmentRot(restC.clone().sub(restB), Cw.clone().sub(Bw), hinge);
  if (L.rel > 1e-6) {
    // Re-evaluate the free distal frames on the final forearm so the solve is exactly consistent.
    const fd = Cw.clone().sub(Bw).normalize();
    const dm = rotAbout(fd, hinge, cs * L.carpus), RmF = segmentRot(rm, dm, hinge);
    const RdF = segmentRot(rd, rotAbout(dm, hinge, L.digits), hinge);
    Rm = RmW.clone().slerp(RmF, Math.min(1, L.rel));
    Rd = RdW.clone().slerp(RdF, Math.min(1, L.rel));
  }
  q[d.prox] = new Quaternion().setFromAxisAngle(AXIS_X, alpha);
  q[d.a] = Wprox.clone().invert().multiply(Wa);
  q[d.b] = Wa.clone().invert().multiply(Wb);
  q[d.meta[0]!] = Wb.clone().invert().multiply(Rm);
  for (const extra of d.meta.slice(1)) q[extra] = new Quaternion();
  q[d.paw] = Rm.clone().invert().multiply(Rd);
  // Toe bone: planted digits keep the toe pads flat on the floor while the knuckle lifts (heel-off); free digits curl.
  const curlQ = new Quaternion().setFromAxisAngle(AXIS_X, L.curl);
  const toeFlatW = segmentRot(rd, dirPitch(d.digRestPitch), lat).multiply(curlQ);
  const toeW = toeFlatW.slerp(Rd.clone().multiply(curlQ), Math.min(1, L.rel));
  q[d.toe] = Rd.clone().invert().multiply(toeW);
  q[d.digits[0]] = new Quaternion().setFromAxisAngle(UP, -d.side * L.spread);
  q[d.digits[1]] = new Quaternion().setFromAxisAngle(UP, d.side * L.spread);

  // Diagnostics.
  const toeAt = Cw.clone().add(d.metaVec.clone().applyQuaternion(Rm)).add(d.digVec.clone().applyQuaternion(Rd));
  const fdir = Cw.clone().sub(Bw).normalize(), mdir = d.metaVec.clone().applyQuaternion(Rm).normalize(), ddir = d.digVec.clone().applyQuaternion(Rd).normalize();
  const sAng = (a: Vector3, b: Vector3) => Math.atan2(new Vector3().crossVectors(a, b).dot(hinge), a.dot(b));
  return {
    reachError: L.cw > 0 ? 0 : toeAt.distanceTo(T), reach: Aw.distanceTo(C) / Lsum,
    mid: Math.PI - Bw.clone().sub(Aw).angleTo(fdir), carpus: cs * sAng(fdir, mdir), digits: sAng(mdir, ddir), prox: alpha, fore: info.fore,
  };
}
