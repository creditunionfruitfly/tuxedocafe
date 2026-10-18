import behavior from '../../data/behavior.json' with { type: 'json' };
import catalog from '../../data/animation-catalog.json' with { type: 'json' };
import cats from '../../data/cats.json' with { type: 'json' };
import type { Rng } from '../core/rng.ts';
import { ROOM } from '../scenes/collision.ts';
import { walkable, type Waypoint } from '../scenes/navigation.ts';
import { Mover, wrap } from './mover.ts';

export type Need = keyof typeof behavior.needRise;
export type Gait = keyof typeof behavior.gaitSpeed;
type Satisfy = Partial<Record<Need, number>>;
export type Step =
  | { kind: 'go'; to: Waypoint; gait: Gait; direct?: boolean; clip?: string; layers?: readonly string[]; satisfy?: Satisfy }
  | { kind: 'face'; yaw: number }
  | { kind: 'clip'; clip: string; seconds?: number; layers?: readonly string[]; pulse?: readonly string[]; satisfy?: Satisfy }
  | { kind: 'jump'; clip: string; to: { x: number; z: number; y: number } };
export interface World { readonly player: Waypoint | null; readonly cats: readonly Brain[] }
type Perch = (typeof behavior.perches)[number];

const CLIPS = new Map(catalog.clips.map(clip => [clip.name, clip]));
export const clipSeconds = (name: string): number => CLIPS.get(name)?.durationS ?? 1;
const NEEDS = Object.keys(behavior.needRise) as Need[];
const PAIRS = behavior.pairs as Record<string, string>;
export const pairOf = (a: string, b: string): string => PAIRS[`${a}|${b}`] ?? PAIRS[`${b}|${a}`] ?? 'neutral';
const GOALS = ['rest', 'eat', 'drink', 'litter', 'groom', 'explore', 'window', 'perch', 'play', 'zoomies', 'seekPlayer', 'avoidPlayer', 'socialize', 'scratch'] as const;
export type Goal = (typeof GOALS)[number];
const C = (name: string): string => `cat.${name}`;
const COMMITTED = new Set<Goal>(['window', 'perch', 'litter']);
const RESTING = new Set(['rest.sit_idle', 'rest.loaf', 'rest.lie_side', 'rest.sprawl', 'rest.sleep_curl'].map(C));
const faceTo = (from: Waypoint, to: Waypoint): number => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * One cat's mind (README Cats: behavior spec): needs rise, a utility scorer re-thinks every 0.5–2 s with
 * inertia and seeded noise, and the winning goal becomes a plan of steps that plays the clip catalog.
 * Runs on the fixed step with the cat's own RNG stream and never obeys the player.
 */
export class Brain {
  readonly mover: Mover; readonly traits: (typeof cats.cats)[number]['traits']; readonly needs = {} as Record<Need, number>;
  readonly cap: number; affinity: number; goal: Goal = 'rest';
  action: string | null = null; actionId = 0; layers: readonly string[] = []; pulses: string[] = [];
  #plan: Step[] = []; #fresh = true; #time = 0; #think: number; #from = { x: 0, z: 0, y: 0 }; #turn = 0;
  #cooldown: Record<string, number> = {}; #playerDistance = Infinity; #committed = false;
  readonly id: string; readonly rng: Rng; readonly scale: number;
  constructor(id: string, rng: Rng, start: Waypoint, scale = 1) {
    this.id = id; this.rng = rng; this.scale = scale;
    const cat = cats.cats.find(entry => entry.id === id)!;
    this.traits = cat.traits; this.mover = new Mover(start, rng.range(-Math.PI, Math.PI));
    this.cap = rng.range(cat.maxAffinityRange[0]!, cat.maxAffinityRange[1]!); this.affinity = this.cap * rng.range(.1, .3);
    for (const need of NEEDS) this.needs[need] = rng.range(.1, .6);
    this.#think = rng.range(0, behavior.rethinkSeconds[1]!);
  }
  get busy(): boolean { const step = this.#plan[0]; return step?.kind === 'jump' || (step?.kind === 'clip' && !CLIPS.get(step.clip)?.loop && !this.#fresh); }
  /** Replaces whatever the cat is doing; perk and reaction scenes use this. */
  interrupt(plan: Step[], goal: Goal = this.goal): void {
    this.#plan = plan; this.#fresh = true; this.goal = goal;
    // Perches, the litter box and deep sleep run to their end: no cat is left on a shelf or mid-nap.
    this.#committed = COMMITTED.has(goal) || plan.some(step => step.kind === 'clip' && step.clip === C('rest.sleep_curl'));
  }
  step(dt: number, world: World): void {
    this.mover.begin(); this.pulses = [];
    for (const need of NEEDS) this.needs[need] = Math.min(1, this.needs[need] + behavior.needRise[need] * dt);
    for (const key in this.#cooldown) this.#cooldown[key]! -= dt;
    const free = !this.busy && !(this.#committed && this.#plan.length);
    if (free) this.#react(world, dt);
    if ((this.#think -= dt) <= 0) {
      this.#think = this.rng.range(behavior.rethinkSeconds[0]!, behavior.rethinkSeconds[1]!);
      if (free) this.#rethink(world);
    }
    this.#run(dt);
  }
  score(goal: Goal, world: World): number {
    const n = this.needs, t = this.traits, near = world.player ? Math.hypot(world.player.x - this.mover.x, world.player.z - this.mover.z) : Infinity;
    switch (goal) {
      case 'rest': return n.energy * 1.1;
      case 'eat': return n.hunger;
      case 'drink': return n.thirst;
      case 'litter': return n.litter * (n.litter > .5 ? 1.2 : .5);
      case 'groom': return n.grooming * .8;
      case 'explore': return .22 + t.boldness * .1;
      case 'window': return .14 + (1 - t.sociability) * .12;
      case 'perch': return .12 + t.boldness * .12;
      case 'play': return n.play * (.4 + t.playfulness * .6);
      case 'zoomies': return n.energy < .5 ? n.play * (.3 + t.playfulness) : 0;
      case 'seekPlayer': return world.player ? n.social * t.sociability * (.4 + this.affinity) : 0;
      case 'avoidPlayer': return near < 1.4 ? (1 - this.affinity) * (1 - t.boldness) * 1.2 : 0;
      case 'socialize': return this.#companion(world) ? n.social * t.sociability : 0;
      case 'scratch': return (this.#cooldown.scratch ?? 0) <= 0 ? .3 : 0;
    }
  }
  #rethink(world: World): void {
    let best: Goal = this.goal, top = -Infinity;
    for (const goal of GOALS) {
      const value = this.score(goal, world) + this.rng.range(-behavior.noise, behavior.noise) + (goal === this.goal && this.#plan.length ? behavior.inertia : 0);
      if (value > top) { top = value; best = goal; }
    }
    if (best !== this.goal || !this.#plan.length) this.interrupt(this.#build(best, world), best);
  }
  #react(world: World, dt: number): void {
    const me = this.mover;
    for (const other of world.cats) {
      if (other === this || pairOf(this.id, other.id) !== 'tense' || (this.#cooldown.hiss ?? 0) > 0) continue;
      if (Math.hypot(other.mover.x - me.x, other.mover.z - me.z) > 1 || me.y > 0 || other.mover.y > 0) continue;
      this.#cooldown.hiss = 30;
      const plan: Step[] = [{ kind: 'face', yaw: faceTo(me, other.mover) }, { kind: 'clip', clip: C('react.hiss'), layers: [C('layer.ears_back'), C('layer.tail_lash')] }];
      if (this.traits.boldness > .6) plan.push({ kind: 'clip', clip: C('react.swat'), layers: [C('layer.ears_back')] });
      return this.interrupt([...plan, ...this.#away(other.mover)], 'avoidPlayer');
    }
    if (!world.player) return;
    const distance = Math.hypot(world.player.x - me.x, world.player.z - me.z), closing = (this.#playerDistance - distance) / dt;
    this.#playerDistance = distance;
    if (distance < .6 && closing > 1.2 && (this.#cooldown.startle ?? 0) <= 0 && me.y === 0) {
      this.#cooldown.startle = 25;
      this.interrupt([{ kind: 'clip', clip: C('react.flinch_startle'), layers: [C('layer.ears_back')] }, ...this.#away(world.player)], 'avoidPlayer');
    }
  }
  #companion(world: World): Brain | undefined {
    let best: Brain | undefined, distance = Infinity;
    for (const other of world.cats) {
      const d = Math.hypot(other.mover.x - this.mover.x, other.mover.z - this.mover.z);
      if (other !== this && pairOf(this.id, other.id) !== 'tense' && other.mover.y === 0 && d < distance) { best = other; distance = d; }
    }
    return best;
  }
  /** A spot on open floor away from a threat, walked off with the walk-away clip. */
  #away(from: Waypoint): Step[] {
    const base = faceTo(from, this.mover);
    for (let i = 0; i < 8; i++) {
      const angle = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * .5, to = { x: this.mover.x + Math.sin(angle) * 2, z: this.mover.z + Math.cos(angle) * 2 };
      if (walkable(to.x, to.z)) return [{ kind: 'go', to, gait: 'walk', clip: C('react.walk_away'), layers: [C('layer.tail_low'), C('layer.ears_back')] }];
    }
    return [];
  }
  #spot(min: number, max: number): Waypoint {
    for (let i = 0; i < 12; i++) {
      const to = { x: this.rng.range(ROOM.minX + .5, ROOM.maxX - .5), z: this.rng.range(ROOM.minZ + .5, ROOM.maxZ - .5) }, d = Math.hypot(to.x - this.mover.x, to.z - this.mover.z);
      if (walkable(to.x, to.z) && d >= min && d <= max) return to;
    }
    return { x: this.mover.x, z: this.mover.z };
  }
  #perch(perch: Perch, layers: readonly string[]): Step[] {
    const high = perch.height === 'high', settle = this.rng.pick([C('rest.loaf'), C('rest.sit_idle')]);
    return [{ kind: 'go', to: perch.from, gait: 'walk' }, { kind: 'face', yaw: faceTo(perch.from, perch) },
      { kind: 'jump', clip: C(high ? 'move.jump_up_high' : 'move.jump_up_low'), to: perch }, { kind: 'face', yaw: perch.yaw },
      { kind: 'clip', clip: settle, seconds: this.rng.range(10, 30), layers, satisfy: { energy: .005 } },
      { kind: 'face', yaw: faceTo(perch, perch.from) },
      { kind: 'jump', clip: C(high ? 'move.jump_down_high' : 'move.jump_down_low'), to: { ...perch.from, y: 0 } }, { kind: 'clip', clip: C('move.land') }];
  }
  #build(goal: Goal, world: World): Step[] {
    const r = this.rng, s = behavior.spots, me = this.mover, ears = [C('layer.ears_forward')], happyTail = [C(this.affinity > .5 ? 'layer.tail_up' : 'layer.tail_flick')];
    switch (goal) {
      case 'rest': {
        const e = this.needs.energy, plan: Step[] = [];
        // Cats often knead their spot before settling into a real sleep.
        if (e > .42 || (e > .22 && r.next() < .3)) plan.push({ kind: 'clip', clip: C('care.knead'), seconds: r.range(3, 6), layers: [C('layer.purr_breath')] });
        plan.push({ kind: 'clip', clip: C('rest.sit_down') });
        if (e > .42) plan.push({ kind: 'clip', clip: C('rest.sleep_curl'), seconds: r.range(30, 70), satisfy: { energy: .02 } }, { kind: 'clip', clip: C('rest.wake_stretch') });
        else if (e > .22) plan.push({ kind: 'clip', clip: r.pick([C('rest.loaf'), C('rest.lie_side'), C('rest.sprawl')]), seconds: r.range(15, 35), satisfy: { energy: .012 } });
        else plan.push({ kind: 'clip', clip: C('rest.sit_idle'), seconds: r.range(6, 12), satisfy: { energy: .006 } });
        return plan;
      }
      case 'eat': return [{ kind: 'go', to: s.food, gait: 'walk', layers: happyTail }, { kind: 'face', yaw: s.food.yaw }, { kind: 'clip', clip: C('care.eat_crouch'), seconds: r.range(8, 14), satisfy: { hunger: .1 } }, { kind: 'clip', clip: C('care.groom_face'), seconds: 3, satisfy: { grooming: .05 } }];
      case 'drink': {
        const plan: Step[] = [{ kind: 'go', to: s.water, gait: 'walk' }, { kind: 'face', yaw: s.water.yaw }];
        if (r.next() < this.traits.playfulness * .5) plan.push({ kind: 'clip', clip: C('care.paw_water'), seconds: 3 });
        return [...plan, { kind: 'clip', clip: C('care.drink_lap'), seconds: r.range(4, 7), satisfy: { thirst: .2 } }];
      }
      case 'litter': {
        const box = r.pick(behavior.litter);
        return [{ kind: 'go', to: box.from, gait: 'walk' }, { kind: 'go', to: box, gait: 'walk', direct: true }, { kind: 'face', yaw: box.yaw },
          { kind: 'clip', clip: C('care.litter_dig') }, { kind: 'clip', clip: C('care.litter_squat'), seconds: r.range(4, 6), satisfy: { litter: .25 } }, { kind: 'clip', clip: C('care.litter_cover') },
          { kind: 'go', to: box.from, gait: 'walk', direct: true }];
      }
      case 'groom': { const order = r.next() < .5 ? ['face', 'flank'] : ['flank', 'face']; return order.map((part): Step => ({ kind: 'clip', clip: C(`care.groom_${part}`), seconds: r.range(4, 8), satisfy: { grooming: .06 } })); }
      case 'explore': return [{ kind: 'go', to: this.#spot(1.5, 5), gait: r.next() < this.traits.playfulness * .4 ? 'trot' : 'walk', layers: [...ears, ...happyTail] }, { kind: 'clip', clip: C('rest.sit_idle'), seconds: r.range(2, 4), layers: ears }];
      case 'window': return this.#perch(behavior.perches.find(p => p.window)!, ears);
      case 'perch': return this.#perch(r.pick(behavior.perches.filter(p => !p.window)), []);
      case 'play': {
        const plan: Step[] = [];
        for (let i = r.int(2, 4); i > 0; i--) plan.push({ kind: 'clip', clip: r.pick([C('play.pounce'), C('play.bat_left'), C('play.bat_right'), C('play.roll_over')]), layers: [...ears, C('layer.tail_flick')], satisfy: { play: .12 } });
        return plan;
      }
      case 'zoomies': return [{ kind: 'go', to: this.#spot(3, 9), gait: 'gallop', layers: [C('layer.tail_up')], satisfy: { play: .06 } }, { kind: 'go', to: this.#spot(3, 9), gait: 'gallop', satisfy: { play: .06 } }, { kind: 'go', to: this.#spot(1, 4), gait: 'trot', satisfy: { play: .04 } }];
      case 'seekPlayer': {
        const p = world.player ?? me, d = Math.hypot(me.x - p.x, me.z - p.z) || 1, to = { x: p.x + (me.x - p.x) / d * .55, z: p.z + (me.z - p.z) / d * .55 };
        const greet = [C('layer.tail_up')], warm = [C('layer.tail_up'), C('layer.lean_in'), C('layer.purr_breath')];
        return [{ kind: 'go', to: walkable(to.x, to.z) ? to : { x: me.x, z: me.z }, gait: d > 3 ? 'trot' : 'walk', layers: greet }, { kind: 'face', yaw: faceTo(to, p) },
          { kind: 'clip', clip: C('social.tail_up_greeting'), layers: greet }, { kind: 'clip', clip: C('social.head_rub'), layers: warm, satisfy: { social: .15 } },
          { kind: 'clip', clip: C('rest.sit_idle'), seconds: r.range(2, 5), layers: greet, pulse: [C('social.slow_blink')], satisfy: { social: .08 } }];
      }
      case 'avoidPlayer': return world.player ? this.#away(world.player) : [];
      case 'socialize': {
        const friend = this.#companion(world);
        if (!friend) return [];
        const f = friend.mover, d = Math.hypot(me.x - f.x, me.z - f.z) || 1, to = { x: f.x + (me.x - f.x) / d * .45, z: f.z + (me.z - f.z) / d * .45 };
        const plan: Step[] = [{ kind: 'go', to: walkable(to.x, to.z) ? to : { x: me.x, z: me.z }, gait: 'walk', layers: [C('layer.tail_up')] }, { kind: 'face', yaw: faceTo(to, f) },
          { kind: 'clip', clip: C('social.tail_up_greeting'), layers: [C('layer.tail_up')], satisfy: { social: .08 } }];
        if (pairOf(this.id, friend.id) === 'friendly') plan.push({ kind: 'clip', clip: C('social.head_rub'), layers: [C('layer.lean_in'), C('layer.purr_breath')], satisfy: { social: .15 } }, { kind: 'clip', clip: C('care.groom_face'), seconds: 4, pulse: [C('social.slow_blink')], satisfy: { social: .1 } });
        else plan.push({ kind: 'clip', clip: C('rest.sit_idle'), seconds: 2, layers: ears, satisfy: { social: .05 } });
        return plan;
      }
      case 'scratch': this.#cooldown.scratch = 90; return [{ kind: 'go', to: s.scratch, gait: 'walk' }, { kind: 'face', yaw: s.scratch.yaw }, { kind: 'clip', clip: C('care.scratch_post'), seconds: r.range(4, 6) }];
    }
  }
  #run(dt: number): void {
    const step = this.#plan[0], me = this.mover, fresh = this.#fresh;
    if (!step) { this.action = null; this.layers = []; return; }
    if (fresh) { this.#fresh = false; this.#time = 0; this.actionId++; }
    this.#time += dt;
    const satisfy = (rates?: Satisfy): void => { for (const need in rates) this.needs[need as Need] = Math.max(0, this.needs[need as Need] - rates[need as Need]! * dt); };
    const next = (): void => { this.#plan.shift(); this.#fresh = true; if (!this.#plan.length) this.#think = 0; };
    switch (step.kind) {
      case 'go':
        if (fresh) { if (!me.goTo(step.to, behavior.gaitSpeed[step.gait] * this.scale, step.direct)) { this.interrupt([]); return; } this.pulses.push(C('loco.start')); }
        me.step(dt); this.action = step.clip ?? null; this.layers = step.layers ?? []; satisfy(step.satisfy);
        if (!me.moving) { this.pulses.push(C('loco.stop')); next(); }
        return;
      case 'face': {
        if (fresh) this.#turn = wrap(step.yaw - me.yaw);
        const left = me.turn(step.yaw, dt);
        this.action = Math.abs(this.#turn) > 1.2 ? C(this.#turn > 0 ? 'loco.turn_left' : 'loco.turn_right') : null; this.layers = [];
        if (Math.abs(left) < .05) next();
        return;
      }
      case 'clip': {
        if (fresh && step.pulse) this.pulses.push(...step.pulse);
        this.action = step.clip; this.layers = step.layers ?? []; satisfy(step.satisfy);
        if (RESTING.has(step.clip)) this.#ambient(dt);
        if (this.#time >= (step.seconds ?? clipSeconds(step.clip))) next();
        return;
      }
      case 'jump': {
        if (fresh) this.#from = { x: me.x, z: me.z, y: me.y };
        const t = Math.min(1, this.#time / clipSeconds(step.clip)), e = t * t * (3 - 2 * t), f = this.#from, to = step.to;
        me.place(f.x + (to.x - f.x) * e, f.z + (to.z - f.z) * e, f.y + (to.y - f.y) * e); this.action = step.clip; this.layers = [];
        if (t >= 1) next();
      }
    }
  }
  /** Small signs of life while resting: yawns, ear and skin twitches, a flicking tail tip. */
  #ambient(dt: number): void {
    const r = this.rng;
    if (r.next() < dt / 40) this.pulses.push(C('rest.yawn'));
    if (r.next() < dt / 12) this.pulses.push(C('layer.ear_twitch'));
    if (r.next() < dt / 30) this.pulses.push(C('layer.skin_twitch'));
    if (Math.sin(this.#time * .7) > .6) this.layers = [...this.layers, C('layer.tail_flick')];
  }
}
