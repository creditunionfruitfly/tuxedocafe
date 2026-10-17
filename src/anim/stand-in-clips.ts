import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type KeyframeTrack } from 'three';
import { PAWS, type Catalog, type ClipSpec, type PawId, type StanceWindows } from './catalog.ts';
import { ROOT_BONE } from './clip-library.ts';
import type { CatRig } from './rig.ts';

/**
 * Procedural stand-ins for every catalogued clip, used until the Artist's
 * cat_anims.glb exists (and for any clip it lacks). They are diagnostic, not
 * the shipped motion: simple poses and cycles on the shared skeleton that honour
 * each clip's name, length, loop, contacts, events and root motion, so the
 * whole runtime (locomotion, IK locking, events, layers) can be exercised.
 * Angles are degrees about the cat's body axes (X pitch: + tips forward bones
 * down and swings hanging limbs back; Y yaw: + turns toward the cat's left;
 * Z roll), applied on top of each bone's rest rotation.
 */
type Angles = readonly [number, number, number];
type Pose = Readonly<Record<string, Angles>> & { readonly $pelvis?: Angles };

const TAU = Math.PI * 2;
const SPINE = ['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05'];
const TAIL = Array.from({ length: 12 }, (_, i) => `tail_${String(i + 1).padStart(2, '0')}`);
const smooth = (a: number, b: number, u: number): number => { const t = Math.min(1, Math.max(0, (u - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (a: number, b: number, u: number): number => u <= a || u >= b ? 0 : Math.sin(Math.PI * (u - a) / (b - a)) ** 2;
const osc = (cycles: number, u: number, phase = 0): number => Math.sin(TAU * (cycles * u + phase));

const SIT: Pose = {
  $pelvis: [0, -.11, -.02], pelvis: [-38, 0, 0], spine_01: [6, 0, 0], spine_02: [6, 0, 0], spine_03: [6, 0, 0], spine_04: [4, 0, 0], spine_05: [4, 0, 0],
  neck_01: [6, 0, 0], head: [8, 0, 0],
  front_L_scapula: [24, 0, 0], front_R_scapula: [24, 0, 0], front_L_upper: [6, 0, 0], front_R_upper: [6, 0, 0],
  hind_L_thigh: [-50, 0, 0], hind_R_thigh: [-50, 0, 0], hind_L_shin: [70, 0, 0], hind_R_shin: [70, 0, 0], hind_L_hock: [-40, 0, 0], hind_R_hock: [-40, 0, 0],
  tail_01: [50, 0, 0], tail_02: [10, 14, 0], tail_03: [0, 14, 0], tail_04: [0, 14, 0], tail_05: [0, 14, 0], tail_06: [0, 12, 0], tail_07: [0, 10, 0],
};
const LOAF: Pose = {
  $pelvis: [0, -.2, 0], pelvis: [-4, 0, 0], head: [6, 0, 0], neck_01: [-4, 0, 0],
  front_L_upper: [-60, 0, 0], front_R_upper: [-60, 0, 0], front_L_fore: [110, 0, 0], front_R_fore: [110, 0, 0], front_L_wrist: [-40, 0, 0], front_R_wrist: [-40, 0, 0],
  hind_L_thigh: [-60, 0, 0], hind_R_thigh: [-60, 0, 0], hind_L_shin: [90, 0, 0], hind_R_shin: [90, 0, 0], hind_L_hock: [-50, 0, 0], hind_R_hock: [-50, 0, 0],
  tail_01: [45, 0, 0], tail_02: [0, 16, 0], tail_03: [0, 16, 0], tail_04: [0, 16, 0], tail_05: [0, 14, 0], tail_06: [0, 12, 0],
};
const CURL: Pose = {
  ...LOAF, $pelvis: [0, -.22, 0], spine_01: [0, 16, 0], spine_02: [0, 18, 0], spine_03: [0, 18, 0], spine_04: [0, 16, 0], spine_05: [0, 14, 0],
  neck_01: [10, 24, 0], neck_02: [10, 24, 0], head: [22, 26, 10], tail_02: [0, 22, 0], tail_03: [0, 22, 0], tail_04: [0, 22, 0], tail_05: [0, 20, 0], tail_06: [0, 18, 0], tail_07: [0, 16, 0],
};
const LIE: Pose = {
  $pelvis: [0, -.2, 0], pelvis: [0, 0, 78], neck_01: [0, 0, -18], head: [0, 0, -30],
  front_L_upper: [-20, 0, 0], front_R_upper: [-10, 0, 0], front_L_fore: [30, 0, 0], front_R_fore: [20, 0, 0],
  hind_L_thigh: [-25, 0, 0], hind_R_thigh: [-15, 0, 0], hind_L_shin: [30, 0, 0], hind_R_shin: [20, 0, 0], tail_01: [20, 10, 0],
};
const SPRAWL: Pose = { ...LIE, front_L_upper: [-55, 0, 0], front_R_upper: [-45, 0, 0], front_L_fore: [5, 0, 0], front_R_fore: [5, 0, 0], hind_L_thigh: [35, 0, 0], hind_R_thigh: [30, 0, 0], hind_L_shin: [-10, 0, 0], hind_R_shin: [-10, 0, 0] };
const CROUCH: Pose = {
  $pelvis: [0, -.05, 0], front_L_upper: [-14, 0, 0], front_R_upper: [-14, 0, 0], front_L_fore: [30, 0, 0], front_R_fore: [30, 0, 0],
  hind_L_thigh: [-14, 0, 0], hind_R_thigh: [-14, 0, 0], hind_L_shin: [24, 0, 0], hind_R_shin: [24, 0, 0], neck_01: [22, 0, 0], neck_02: [14, 0, 0], head: [16, 0, 0], tail_01: [20, 0, 0],
};
const STRETCH_FRONT: Pose = { $pelvis: [0, -.04, -.03], spine_04: [10, 0, 0], spine_05: [8, 0, 0], front_L_upper: [-55, 0, 0], front_R_upper: [-55, 0, 0], front_L_fore: [-10, 0, 0], front_R_fore: [-10, 0, 0], head: [-12, 0, 0], tail_01: [-30, 0, 0] };
const STRETCH_HIND: Pose = { hind_L_thigh: [40, 0, 0], hind_L_shin: [-20, 0, 0], hind_L_hock: [20, 0, 0], tail_01: [-20, 0, 0] };
const EARS_BACK: Pose = { ear_L_01: [0, 55, -25], ear_R_01: [0, -55, 25] };

const DEFAULT_WALK: Readonly<Record<PawId, StanceWindows>> = { LH: [[0, .62]], LF: [[.25, .87]], RH: [[.5, 1.12]], RF: [[.75, 1.37]] };
const GAIT: Readonly<Record<string, { swing: number; lift: number; bob: number; spine: number }>> = {
  walk: { swing: 22, lift: 30, bob: .004, spine: 0 }, trot: { swing: 26, lift: 40, bob: .006, spine: 0 }, gallop: { swing: 36, lift: 50, bob: .012, spine: 8 },
};

/** Accumulates one frame's body-axis angles and offsets. */
class Frame {
  readonly angles = new Map<string, [number, number, number]>();
  readonly pelvis: [number, number, number] = [0, 0, 0];
  readonly root: [number, number, number] = [0, 0, 0];
  add(bone: string, x: number, y = 0, z = 0): void {
    const a = this.angles.get(bone) ?? [0, 0, 0]; a[0] += x; a[1] += y; a[2] += z; this.angles.set(bone, a);
  }
  pose(pose: Pose, weight = 1): void {
    if (weight === 0) return;
    for (const [bone, angles] of Object.entries(pose)) {
      if (bone === '$pelvis') { for (let i = 0; i < 3; i++) this.pelvis[i]! += angles[i]! * weight; continue; }
      this.add(bone, angles[0] * weight, angles[1] * weight, angles[2] * weight);
    }
  }
  breathe(u: number, cycles: number, amount = 1): void { for (const bone of ['spine_02', 'spine_03', 'spine_04']) this.add(bone, osc(cycles, u) * 1.2 * amount); }
  tailWave(u: number, cycles: number, degrees: number, from = 0): void { TAIL.forEach((bone, i) => { if (i >= from) this.add(bone, 0, degrees * osc(cycles, u, -i * .06)); }); }
}

function legs(frame: Frame, u: number, spec: ClipSpec, swing: number, lift: number): void {
  const contacts = spec.contacts ?? DEFAULT_WALK;
  for (const paw of PAWS) {
    const window = (contacts[paw] ?? DEFAULT_WALK[paw])[0]!, duty = window[1] - window[0];
    const d = ((u - window[0]) % 1 + 1) % 1;
    let forward: number, flex: number;
    if (d < duty) { forward = 1 - 2 * d / duty; flex = 0; }
    else { const s = (d - duty) / (1 - duty); forward = -1 + 2 * smooth(0, 1, s); flex = Math.sin(Math.PI * s); }
    const side = paw[0] === 'L' ? 'L' : 'R';
    if (paw[1] === 'F') {
      frame.add(`front_${side}_upper`, -forward * swing); frame.add(`front_${side}_fore`, flex * lift); frame.add(`front_${side}_wrist`, flex * lift * .8);
    } else {
      frame.add(`hind_${side}_thigh`, -forward * swing); frame.add(`hind_${side}_shin`, -flex * lift); frame.add(`hind_${side}_hock`, flex * lift * .7);
    }
  }
}

function gait(frame: Frame, u: number, spec: ClipSpec, kind: string, amount = 1): void {
  const g = GAIT[kind] ?? GAIT.walk!;
  legs(frame, u, spec, g.swing * amount, g.lift * amount);
  frame.pelvis[1] -= g.bob * amount * (1 - Math.cos(2 * TAU * u)) * .5;
  frame.add('pelvis', 0, 2 * amount * osc(1, u), 2 * amount * osc(1, u, .25));
  for (const bone of SPINE) frame.add(bone, g.spine * amount * osc(1, u), 1.5 * amount * osc(1, u, .5));
  frame.add('neck_01', 4 * amount); frame.add('head', -2 * amount * osc(2, u));
  frame.add('tail_01', 10 * amount); frame.tailWave(u, 1, 3 * amount);
}

/** One recipe per clip, chosen by name. */
function recipe(spec: ClipSpec): (frame: Frame, u: number) => void {
  const n = spec.name;
  const crouchBreath = (f: Frame, u: number): void => { f.pose(CROUCH); f.add('head', 5 * osc(4, u)); f.add('jaw', 6 * Math.max(0, osc(4, u))); };
  switch (n) {
    case 'cat.loco.idle': return (f, u) => { f.breathe(u, 2); f.add('head', 0, 6 * bump(.55, .8, u)); f.add('ear_L_01', 0, 18 * bump(.3, .4, u)); f.tailWave(u, 1, 4, 6); f.add('pelvis', 1.5 * osc(1, u)); };
    case 'cat.loco.walk': return (f, u) => gait(f, u, spec, 'walk');
    case 'cat.loco.trot': return (f, u) => gait(f, u, spec, 'trot');
    case 'cat.loco.gallop': case 'cat.perk.catnip_zoom': return (f, u) => { gait(f, u, spec, 'gallop'); f.pose(EARS_BACK, .5); };
    case 'cat.loco.start': return (f, u) => gait(f, u, spec, 'walk', smooth(0, 1, u));
    case 'cat.loco.stop': return (f, u) => gait(f, u, spec, 'walk', 1 - smooth(0, 1, u));
    case 'cat.react.walk_away': return (f, u) => { gait(f, u, spec, 'walk', 1.1); f.pose(EARS_BACK, .6); f.add('tail_01', 25); };
    case 'cat.loco.turn_left': case 'cat.loco.turn_right': return (f, u) => {
      const s = n.endsWith('left') ? 1 : -1, b = bump(0, 1, u);
      for (const bone of ['spine_03', 'spine_04', 'spine_05']) f.add(bone, 0, 6 * s * b);
      f.add('neck_01', 0, 10 * s * b); f.add('neck_02', 0, 10 * s * b); f.add('head', 0, 16 * s * bump(0, .8, u));
      f.add('front_L_upper', -12 * bump(0, .5, u)); f.add('front_R_upper', -12 * bump(.5, 1, u)); f.add('front_L_fore', 25 * bump(0, .5, u)); f.add('front_R_fore', 25 * bump(.5, 1, u));
    };
    case 'cat.rest.sit_down': return (f, u) => { f.pose(SIT, smooth(0, .85, u)); };
    case 'cat.rest.sit_idle': return (f, u) => { f.pose(SIT); f.breathe(u, 2); f.add('head', 0, 8 * bump(.4, .7, u)); f.add('ear_R_01', 0, -15 * bump(.75, .85, u)); };
    case 'cat.rest.loaf': return (f, u) => { f.pose(LOAF); f.breathe(u, 2, .8); };
    case 'cat.rest.lie_side': case 'cat.perk.harness_flop': return (f, u) => { f.pose(LIE, spec.loop ? 1 : smooth(0, .3, u)); f.breathe(u, 2, 1.2); };
    case 'cat.rest.sprawl': return (f, u) => { f.pose(SPRAWL); f.breathe(u, 2, .8); f.add('front_L_wrist', 10 * bump(.6, .7, u)); };
    case 'cat.rest.sleep_curl': return (f, u) => { f.pose(CURL); f.breathe(u, 3, .9); f.add('ear_L_01', 0, 12 * bump(.5, .56, u)); };
    case 'cat.rest.wake_stretch': return (f, u) => {
      f.pose(LOAF, 1 - smooth(0, .18, u)); f.pose(STRETCH_FRONT, smooth(.18, .4, u) * (1 - smooth(.55, .65, u)));
      f.pose(STRETCH_HIND, bump(.6, .9, u));
    };
    case 'cat.rest.yawn': return (f, u) => { const b = bump(.1, .85, u); f.add('head', -18 * b); f.add('jaw', 38 * b); f.add('ear_L_01', 0, 12 * b); f.add('ear_R_01', 0, -12 * b); };
    case 'cat.care.groom_face': return (f, u) => {
      f.pose(SIT); f.add('head', 14, 10 * osc(2, u)); f.add('front_L_upper', -75); f.add('front_L_fore', -40 + 30 * osc(2, u)); f.add('front_L_wrist', 30);
    };
    case 'cat.care.groom_flank': return (f, u) => {
      f.pose(SIT); f.add('spine_04', 0, 18); f.add('spine_05', 0, 18); f.add('neck_01', 10, 30); f.add('neck_02', 10, 30); f.add('head', 25 + 8 * osc(3, u), 35);
    };
    case 'cat.care.eat_crouch': case 'cat.perk.catnip_lick': return crouchBreath;
    case 'cat.care.drink_lap': return (f, u) => { f.pose(CROUCH); f.add('neck_01', 12); f.add('jaw', 8 * Math.max(0, osc(4, u))); };
    case 'cat.care.paw_water': return (f, u) => { f.pose(SIT); const b = bump(.15, .55, u); f.add('front_R_upper', -45 * b); f.add('front_R_fore', 40 * b); f.add('head', 15); };
    case 'cat.care.litter_dig': case 'cat.care.litter_cover': return (f, u) => {
      f.add('neck_01', 18); f.add('head', 14); f.add('front_L_upper', 22 * osc(2, u)); f.add('front_R_upper', -22 * osc(2, u)); f.add('front_L_fore', 30 * Math.max(0, osc(2, u))); f.add('front_R_fore', 30 * Math.max(0, -osc(2, u)));
    };
    case 'cat.care.litter_squat': return (f, u) => { f.pose({ $pelvis: [0, -.07, 0], pelvis: [-14, 0, 0], hind_L_thigh: [-35, 0, 0], hind_R_thigh: [-35, 0, 0], hind_L_shin: [50, 0, 0], hind_R_shin: [50, 0, 0], tail_01: [-55, 0, 0] }); f.breathe(u, 2, .5); };
    case 'cat.care.knead': return (f, u) => { f.pose(CROUCH, .5); f.add('front_L_upper', 10 * osc(1, u)); f.add('front_R_upper', -10 * osc(1, u)); f.add('front_L_fore', 18 * Math.max(0, osc(1, u))); f.add('front_R_fore', 18 * Math.max(0, -osc(1, u))); };
    case 'cat.care.scratch_post': return (f, u) => { f.pose({ $pelvis: [0, -.04, 0], pelvis: [-42, 0, 0], head: [20, 0, 0], front_L_upper: [-95, 0, 0], front_R_upper: [-95, 0, 0] }); f.add('front_L_upper', 10 * osc(2, u)); f.add('front_R_upper', -10 * osc(2, u)); };
    case 'cat.move.jump_up_low': case 'cat.move.jump_up_high': case 'cat.move.jump_down_low': case 'cat.move.jump_down_high': case 'cat.perk.feather_leap': return jump(spec);
    case 'cat.move.land': return (f, u) => { const b = bump(0, 1, u); f.pose(CROUCH, b); f.add('front_L_fore', 25 * b); f.add('front_R_fore', 25 * b); };
    case 'cat.play.pounce': case 'cat.perk.laser_pounce': case 'cat.perk.toy_catch': return (f, u) => {
      const crouch = smooth(0, .25, u) * (1 - smooth(.5, .62, u)) + smooth(.75, 1, u) * .6;
      f.pose(CROUCH, crouch); f.add('pelvis', 0, 8 * osc(4, u) * bump(.2, .5, u));
      f.add('front_L_upper', -45 * bump(.5, .85, u)); f.add('front_R_upper', -45 * bump(.5, .85, u));
      if (spec.rootMotion) { f.root[2] += .4 * smooth(.5, .68, u); f.root[1] += .08 * bump(.5, .7, u); }
    };
    case 'cat.play.bat_left': case 'cat.play.bat_right': case 'cat.react.swat': return (f, u) => {
      const side = n.endsWith('left') ? 'L' : 'R', s = side === 'L' ? 1 : -1, b = n.endsWith('swat') ? bump(.1, .45, u) : bump(.1, .8, u);
      f.add(`front_${side}_upper`, -80 * b, 0, -20 * s * b); f.add(`front_${side}_fore`, 30 * b); f.add('head', -8 * b);
      if (n.endsWith('swat')) f.pose(EARS_BACK, bump(0, 1, u));
    };
    case 'cat.play.roll_over': case 'cat.perk.catnip_roll': return (f, u) => { f.pose(LOAF, .6); f.pelvis[1] -= .08; f.add('pelvis', 0, 0, 170 * bump(0, 1, u)); f.add('spine_03', 0, 0, 10 * osc(3, u) * bump(.3, .7, u)); };
    case 'cat.social.head_rub': return (f, u) => { const b = bump(.1, .9, u); f.add('head', -6 * b, 22 * b, 24 * b); f.add('neck_02', 0, 10 * b, 10 * b); f.add('spine_04', 0, 8 * b); f.add('tail_01', -60); };
    case 'cat.social.tail_up_greeting': return (f, u) => { f.add('tail_01', -70); f.add('tail_11', -15); f.add('tail_12', -20); f.add('head', -10 * bump(0, 1, u)); };
    case 'cat.social.slow_blink': return (f, u) => { f.add('head', 6 * bump(0, 1, u)); };
    case 'cat.react.hiss': return (f, u) => { const b = bump(0, 1, u); f.pose({ $pelvis: [0, -.02, -.03], spine_04: [-8, 0, 0], head: [10, 0, 0], jaw: [25, 0, 0], tail_01: [-30, 0, 0] }, b); f.pose(EARS_BACK, b); };
    case 'cat.react.flinch_startle': return (f, u) => { const b = bump(0, .6, u) + smooth(.6, 1, u) * .3; f.pose(CROUCH, b); f.pelvis[2] -= .04 * b; f.pose(EARS_BACK, bump(0, .5, u)); };
    case 'cat.perk.catnip_sniff': case 'cat.perk.harness_sniff': return (f, u) => { f.pose(CROUCH); f.add('head', 6 * osc(3, u)); f.add('whisker_L', -8); f.add('whisker_R', -8); };
    case 'cat.perk.laser_stalk': case 'cat.perk.harness_low_walk': return (f, u) => { gait(f, u, spec, 'walk', .6); f.pose(CROUCH, .9); };
    case 'cat.perk.laser_butt_wiggle': return (f, u) => { f.pose(CROUCH); f.add('pelvis', 0, 10 * osc(4, u)); };
    case 'cat.perk.feather_bat': return (f, u) => { f.pose(SIT); f.add('front_L_upper', -70 * Math.max(0, osc(1, u))); f.add('front_R_upper', -70 * Math.max(0, -osc(1, u))); f.add('head', -15); };
    case 'cat.perk.feather_catch': return (f, u) => { f.pose(SIT); const b = bump(0, 1, u); f.add('front_L_upper', -80 * b); f.add('front_R_upper', -80 * b); f.add('jaw', 20 * b); };
    case 'cat.perk.harness_freeze': return (f, u) => { f.pose(LOAF, smooth(0, .3, u)); f.pose(EARS_BACK, .6); };
    // Additive layers: offsets from the rest pose.
    case 'cat.layer.tail_up': return () => {};
    case 'cat.layer.tail_low': return () => {};
    case 'cat.layer.tail_lash': return (f, u) => { TAIL.slice(0, 8).forEach((bone, i) => f.add(bone, 0, 18 * osc(1, u, -i * .05))); };
    case 'cat.layer.tail_flick': return (f, u) => { TAIL.slice(6).forEach(bone => f.add(bone, 0, 14 * bump(.2, .45, u))); };
    case 'cat.layer.ears_forward': return () => {};
    case 'cat.layer.ears_back': return f => f.pose(EARS_BACK);
    case 'cat.layer.ear_twitch': return (f, u) => { f.add('ear_L_01', 0, 25 * bump(0, .5, u)); f.add('ear_R_01', 0, -25 * bump(.5, 1, u)); };
    case 'cat.layer.purr_breath': return (f, u) => f.breathe(u, 2, 1.4);
    case 'cat.layer.skin_twitch': return (f, u) => { for (const bone of ['spine_02', 'spine_03', 'spine_04', 'spine_05']) f.add(bone, 0, 0, 3 * osc(3, u) * bump(0, 1, u)); };
    case 'cat.layer.lean_in': return (f, u) => { const b = .8 + .2 * osc(1, u); f.add('spine_04', 0, 6 * b); f.add('neck_01', 0, 0, 8 * b); f.add('neck_02', 0, 0, 8 * b); f.add('head', -5 * b, 0, 12 * b); };
    default: return (f, u) => f.breathe(u, 2);
  }
}

const STATIC_LAYERS: Readonly<Record<string, Pose>> = {
  'cat.layer.tail_up': { tail_01: [-65, 0, 0], tail_02: [-4, 0, 0], tail_03: [-4, 0, 0], tail_04: [-4, 0, 0], tail_10: [12, 0, 0], tail_11: [14, 0, 0], tail_12: [16, 0, 0] },
  'cat.layer.tail_low': { tail_01: [35, 0, 0], tail_02: [4, 0, 0], tail_03: [4, 0, 0], tail_04: [4, 0, 0] },
  'cat.layer.ears_forward': { ear_L_01: [-12, -6, 0], ear_R_01: [-12, 6, 0] },
};

function jump(spec: ClipSpec): (frame: Frame, u: number) => void {
  const takeoff = spec.events.find(e => e.name === 'takeoff' || e.name === 'land')?.t ?? spec.durationS * .4;
  const contact = spec.events.find(e => e.name === 'contact')?.t ?? Math.min(spec.durationS, takeoff + spec.durationS * .3);
  const t0 = takeoff / spec.durationS, t1 = contact / spec.durationS;
  const height = (spec.name.includes('high') ? 1.2 : .45) * (spec.name.includes('down') ? -1 : 1);
  return (f, u) => {
    f.pose(CROUCH, bump(0, t0 * 1.6, u) + .4 * bump(t1, 1.2, u));
    const flight = bump(t0 * .8, Math.min(1, t1 * 1.1), u);
    f.add('front_L_upper', -40 * flight); f.add('front_R_upper', -40 * flight); f.add('hind_L_thigh', 30 * flight); f.add('hind_R_thigh', 30 * flight);
    if (spec.rootMotion) { f.root[1] += height * smooth(t0 * .9, t1, u); f.root[2] += .3 * smooth(t0 * .9, t1, u); }
    else f.pelvis[1] += .25 * flight;
  };
}

interface BoneFrame { parentAxes: [Vector3, Vector3, Vector3]; restLocal: Quaternion; restPosition: Vector3 }

/** Every catalogued clip as a stand-in AnimationClip on `rig`'s rest pose. */
export function standInClips(catalog: Catalog, rig: CatRig, names: readonly string[] = catalog.clips.map(c => c.name)): AnimationClip[] {
  const frames = new Map<string, BoneFrame>(), d = rig.rest.data, q = new Quaternion();
  rig.names.forEach((name, i) => {
    const parent = rig.parentIndex(i);
    if (parent >= 0) rig.restQuaternionCat(parent, q); else q.identity();
    const inverse = q.clone().invert();
    frames.set(name, {
      parentAxes: [new Vector3(1, 0, 0).applyQuaternion(inverse), new Vector3(0, 1, 0).applyQuaternion(inverse), new Vector3(0, 0, 1).applyQuaternion(inverse)],
      restLocal: new Quaternion(d[i * 7 + 3], d[i * 7 + 4], d[i * 7 + 5], d[i * 7 + 6]),
      restPosition: new Vector3(d[i * 7], d[i * 7 + 1], d[i * 7 + 2]),
    });
  });
  /** Cat-space offsets into a bone's parent frame. */
  const toParent = (bone: string): Quaternion => {
    const parent = rig.parentIndex(rig.index(bone));
    return parent >= 0 ? rig.restQuaternionCat(parent, new Quaternion()).invert() : new Quaternion();
  };
  const qx = new Quaternion(), qy = new Quaternion(), qz = new Quaternion(), offset = new Vector3();
  return names.map(name => catalog.byName.get(name)).filter((spec): spec is ClipSpec => !!spec).map(spec => {
    const fps = spec.durationS > 2.5 ? 15 : 30, count = Math.max(2, Math.round(spec.durationS * fps)) + 1;
    const write = recipe(spec), layer = STATIC_LAYERS[spec.name];
    const samples: Frame[] = [];
    for (let k = 0; k < count; k++) { const f = new Frame(), u = k / (count - 1); write(f, spec.loop ? u % 1 : u); if (layer) f.pose(layer); samples.push(f); }
    if (spec.loop) samples[count - 1] = samples[0]!;
    const times = Array.from({ length: count }, (_, k) => k / (count - 1) * spec.durationS);
    const tracks: KeyframeTrack[] = [];
    const bones = new Set<string>(); for (const f of samples) for (const bone of f.angles.keys()) if (frames.has(bone)) bones.add(bone);
    for (const bone of bones) {
      const frame = frames.get(bone)!, values: number[] = [];
      for (const f of samples) {
        const a = f.angles.get(bone) ?? [0, 0, 0];
        qx.setFromAxisAngle(frame.parentAxes[0], a[0] * Math.PI / 180); qy.setFromAxisAngle(frame.parentAxes[1], a[1] * Math.PI / 180); qz.setFromAxisAngle(frame.parentAxes[2], a[2] * Math.PI / 180);
        q.copy(qy).multiply(qx).multiply(qz).multiply(frame.restLocal);
        values.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
    }
    const positionTrack = (bone: string, pick: (f: Frame) => readonly number[]): void => {
      const frame = frames.get(bone);
      if (!frame || samples.every(f => pick(f).every(v => v === 0))) return;
      const values: number[] = [], rotate = toParent(bone);
      for (const f of samples) { const o = pick(f); offset.set(o[0]!, o[1]!, o[2]!).applyQuaternion(rotate).add(frame.restPosition); values.push(offset.x, offset.y, offset.z); }
      tracks.push(new VectorKeyframeTrack(`${bone}.position`, times, values));
    };
    positionTrack('pelvis', f => f.pelvis);
    if (spec.rootMotion) positionTrack(ROOT_BONE, f => f.root);
    const clip = new AnimationClip(spec.name, spec.durationS, tracks);
    clip.userData = { standIn: true };
    return clip;
  });
}
