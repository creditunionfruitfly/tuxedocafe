import { AdditiveAnimationBlendMode, AnimationMixer, LoopRepeat, NormalAnimationBlendMode, type AnimationAction, type Object3D } from 'three';
import { CATALOG, PAWS, stanceWeight, type Catalog, type ClipEvent } from './catalog.ts';
import type { BoundClip } from './clip-library.ts';
import { advanceTime, visitCrossedEvents } from './clip-timeline.ts';
import { sampleCurve, type ExpressionLibrary } from './expressions.ts';
import { gaitTimeScale, gaitWeights, IDLE_SPEED, normalizeSpeed } from './locomotion.ts';

/**
 * The mixer stack (README Animation spec): locomotion blend by speed and turn
 * rate, full-body actions with cross-fades, then additive layers. This class
 * owns every clip's time and weight on the fixed step; AnimationMixer only
 * evaluates them (apply), which keeps events, contacts and decisions identical
 * at any render rate and any per-cat update rate.
 */
export type AnimEventSink = (clip: string, event: string) => void;

class Track {
  readonly bound: BoundClip; readonly action: AnimationAction;
  time = 0; weight = 0; fresh = true;
  constructor(bound: BoundClip, action: AnimationAction) { this.bound = bound; this.action = action; }
  get name(): string { return this.bound.spec.name; }
  get duration(): number { return this.bound.duration; }
}
interface Fade { track: Track; weight: number; target: number; rate: number }

/** Events fire only from clips with at least this much weight (no ghost events from a fading clip). */
const EVENT_WEIGHT = .3;
/** Additive layers ease toward their target weight at this rate (per second). */
const LAYER_RATE = 4;
const MAX_SLOTS = 3;

export class Animator {
  readonly mixer: AnimationMixer;
  readonly catalog: Catalog;
  readonly tracks: ReadonlyMap<string, Track>;
  /** Per paw (PAWS order): locomotion stance weight × that clip's share of the pose. */
  readonly contacts = new Float64Array(4);
  /** Share of the pose from clips with contact data; the rest plants by pad height. */
  locoWeight = 0;
  /** Share of the pose from root-motion clips (leg IK fades out under them). */
  rootMotion = 0;
  /** Morph weights requested by clips (catalog morph order). */
  readonly morphs: Float64Array;
  speedFactor: number;
  speed = 0; turnRate = 0;
  style: 'walk' | 'walk_away' = 'walk';
  previewPaused = false;
  expressions: ExpressionLibrary | null = null;
  #phase = 0; #moving = false;
  readonly #gait = new Float64Array(4);
  readonly #list: Track[];
  readonly #gaits: (Track | undefined)[] = [undefined, undefined, undefined];
  readonly #slots: Fade[] = [];
  readonly #layers: Fade[] = [];
  #startStop: Track | null = null;
  #preview: Track | null = null;
  #sink: AnimEventSink | null = null;
  readonly #emit = (event: ClipEvent): void => { if (this.#current) this.#sink?.(this.#current, event.name); };
  #current: string | null = null;

  constructor(root: Object3D, clips: ReadonlyMap<string, BoundClip>, speedFactor: number, catalog: Catalog = CATALOG) {
    this.catalog = catalog; this.speedFactor = speedFactor;
    this.mixer = new AnimationMixer(root);
    this.morphs = new Float64Array(catalog.morphTargets.length);
    const tracks = new Map<string, Track>();
    // Every action plays from the start at weight 0 with the bones at rest, so the
    // mixer's "original" values (used where weights sum below 1) are the rest pose.
    for (const [name, bound] of clips) {
      const action = this.mixer.clipAction(bound.clip, root, bound.additive ? AdditiveAnimationBlendMode : NormalAnimationBlendMode);
      action.setLoop(LoopRepeat, Infinity); action.play(); action.setEffectiveWeight(0);
      tracks.set(name, new Track(bound, action));
    }
    this.tracks = tracks; this.#list = [...tracks.values()];
  }

  has(name: string): boolean { return this.tracks.has(name); }
  setLocomotion(speed: number, turnRate: number): void { this.speed = speed; this.turnRate = turnRate; }

  /** Full-body action (any non-additive clip); additive clips are triggered as layers. */
  play(name: string, fade = .25): boolean {
    const track = this.tracks.get(name); if (!track) return false;
    if (track.bound.additive) return this.trigger(name);
    const rate = fade > 0 ? 1 / fade : Infinity;
    for (const slot of this.#slots) { slot.target = 0; slot.rate = rate; }
    let slot = this.#slots.find(s => s.track === track);
    if (!slot) {
      if (this.#slots.length >= MAX_SLOTS) this.#slots.sort((a, b) => b.weight - a.weight).length = MAX_SLOTS - 1;
      slot = { track, weight: 0, target: 1, rate }; this.#slots.push(slot);
    }
    slot.target = 1; slot.rate = rate; track.time = 0; track.fresh = true;
    return true;
  }

  /** Fade every action out, back to locomotion. */
  stopAction(fade = .25): void { for (const slot of this.#slots) { slot.target = 0; slot.rate = fade > 0 ? 1 / fade : Infinity; } }

  /** The dominant full-body action, if any. */
  get action(): string | null {
    let best: Fade | null = null;
    for (const slot of this.#slots) if (slot.target > 0 && (!best || slot.weight > best.weight)) best = slot;
    return best?.track.name ?? null;
  }

  /** Target weight for a looping additive layer (tail, ears, purr, lean-in…). */
  setLayer(name: string, weight: number): boolean {
    const track = this.tracks.get(name); if (!track?.bound.additive) return false;
    let layer = this.#layers.find(l => l.track === track);
    if (!layer) { layer = { track, weight: 0, target: 0, rate: LAYER_RATE }; this.#layers.push(layer); track.time = 0; track.fresh = true; }
    layer.target = Math.min(1, Math.max(0, weight));
    return true;
  }

  /** A one-shot additive clip (yawn, ear twitch, skin twitch, slow blink). */
  trigger(name: string): boolean {
    const track = this.tracks.get(name); if (!track?.bound.additive) return false;
    let layer = this.#layers.find(l => l.track === track);
    if (!layer) { layer = { track, weight: 0, target: 1, rate: 10 }; this.#layers.push(layer); }
    layer.target = 1; layer.rate = 10; track.time = 0; track.fresh = true;
    return true;
  }

  layerWeight(name: string): number { return this.#layers.find(l => l.track.name === name)?.weight ?? 0; }

  /** Lookdev: play one clip alone (additive clips over idle); null returns to the stack. */
  preview(name: string | null): boolean {
    const track = name ? this.tracks.get(name) ?? null : null;
    this.#preview = track;
    if (track) { track.time = 0; track.fresh = true; }
    return !!track || name === null;
  }
  get previewClip(): string | null { return this.#preview?.name ?? null; }
  /** Lookdev scrubbing. */
  setPreviewTime(time: number): void { const p = this.#preview; if (p) p.time = Math.min(p.duration, Math.max(0, time)); }
  get previewTime(): number { return this.#preview?.time ?? 0; }

  /** Advances every clock, weight and contact by one fixed step and emits crossed events. */
  advance(dt: number, sink: AnimEventSink | null = null): void {
    this.#sink = sink;
    for (let i = 0; i < this.#list.length; i++) this.#list[i]!.weight = 0;
    this.morphs.fill(0); this.contacts.fill(0); this.locoWeight = 0; this.rootMotion = 0;
    if (this.#preview) this.#advancePreview(dt);
    else {
      const actionBlend = this.#advanceActions(dt);
      this.#advanceLocomotion(dt, 1 - actionBlend);
      this.#advanceLayers(dt);
    }
    this.#sink = null;
  }

  /** Writes clip times and weights to the mixer and evaluates (no time passes inside the mixer). */
  apply(): void {
    for (let i = 0; i < this.#list.length; i++) {
      const track = this.#list[i]!, action = track.action;
      if (track.weight > 0 || action.getEffectiveWeight() > 0) { action.time = Math.min(track.duration, Math.max(0, track.time)); action.setEffectiveWeight(track.weight); }
    }
    this.mixer.update(0);
  }

  /** Moves a clip's clock, firing its events if it carries enough weight. */
  #step(track: Track, delta: number, loop: boolean, weight: number): void {
    if (weight >= EVENT_WEIGHT && this.#sink && track.bound.spec.events.length) {
      this.#current = track.name;
      visitCrossedEvents(track.bound.spec.events, track.time, Math.max(0, delta), track.duration, loop, track.fresh, this.#emit);
    }
    track.fresh = false;
    track.time = advanceTime(track.time, delta, track.duration, loop);
    track.weight += weight;
    const spec = track.bound.spec;
    const curves = this.expressions?.clips.get(track.name);
    if (curves && weight > 0) for (const curve of curves.curves) this.morphs[curve.morph] = Math.max(this.morphs[curve.morph]!, sampleCurve(curve, track.time / track.duration * curves.durationS) * weight);
    else if (spec.morphs.length && weight > 0) {
      const envelope = loop ? 1 : Math.sin(Math.PI * Math.min(1, track.time / track.duration)) ** .5;
      for (let i = 0; i < spec.morphs.length; i++) {
        const index = this.catalog.morphTargets.indexOf(spec.morphs[i]!);
        if (index >= 0) this.morphs[index] = Math.max(this.morphs[index]!, envelope * weight);
      }
    }
  }

  #advancePreview(dt: number): void {
    const p = this.#preview!, step = this.previewPaused ? 0 : dt;
    if (p.bound.additive) { const idle = this.tracks.get('cat.loco.idle'); if (idle) this.#step(idle, step, true, 1); }
    this.#step(p, step, p.bound.spec.loop || p.bound.spec.layer === 'locomotion', 1);
    if (!p.bound.spec.loop && p.time >= p.duration && !this.previewPaused) { p.time = 0; p.fresh = true; }
    if (p.bound.spec.contacts) this.#addContacts(p.bound.spec.contacts, p.time / p.duration, 1);
    if (p.bound.spec.rootMotion) this.rootMotion = 1;
  }

  #advanceActions(dt: number): number {
    let blend = 0;
    for (let i = this.#slots.length - 1; i >= 0; i--) {
      const slot = this.#slots[i]!, delta = slot.target - slot.weight;
      slot.weight += Math.sign(delta) * Math.min(Math.abs(delta), slot.rate * dt);
      if (slot.weight <= 0 && slot.target <= 0) { this.#slots.splice(i, 1); continue; }
      blend += slot.weight;
    }
    const scale = blend > 1 ? 1 / blend : 1;
    for (const slot of this.#slots) {
      const spec = slot.track.bound.spec, weight = slot.weight * scale;
      this.#step(slot.track, dt, spec.loop, weight);
      if (spec.rootMotion) this.rootMotion += weight;
      if (spec.contacts) this.#addContacts(spec.contacts, slot.track.time / slot.track.duration, weight);
    }
    return Math.min(1, blend);
  }

  #advanceLocomotion(dt: number, share: number): void {
    const s = normalizeSpeed(this.speed, this.speedFactor), g = gaitWeights(s, this.catalog.gaitThresholds, this.#gait);
    const walkName = this.style === 'walk_away' && this.tracks.has('cat.react.walk_away') ? 'cat.react.walk_away' : 'cat.loco.walk';
    const idle = this.tracks.get('cat.loco.idle'), walk = this.tracks.get(walkName), trot = this.tracks.get('cat.loco.trot'), gallop = this.tracks.get('cat.loco.gallop');
    // Start and stop clips play once at the edges of motion.
    const moving = s >= IDLE_SPEED * 2;
    if (moving !== this.#moving) {
      const edge = this.tracks.get(moving ? 'cat.loco.start' : 'cat.loco.stop') ?? null;
      if (edge) { edge.time = 0; edge.fresh = true; }
      this.#startStop = edge; this.#moving = moving;
    }
    let edgeWeight = 0;
    const edge = this.#startStop;
    if (edge) {
      const u = edge.time / edge.duration;
      edgeWeight = (1 - Math.min(1, Math.max(0, (u - .6) / .4)) ** 2) * share;
      if (u >= 1) { this.#startStop = null; edgeWeight = 0; }
    }
    // Turning in place.
    const turnRate = Math.abs(this.turnRate), turnName = this.turnRate >= 0 ? 'cat.loco.turn_left' : 'cat.loco.turn_right';
    const turn = this.tracks.get(turnName);
    const turnWeight = turn ? Math.min(1, Math.max(0, (turnRate - .25) / .65)) * g[0]! * share : 0;
    const available = Math.max(0, share - edgeWeight), turnShare = Math.min(available, turnWeight);
    const base = available - turnShare;
    // Gaits share one phase so footfalls line up while blending.
    const gaits = this.#gaits; gaits[0] = walk; gaits[1] = trot; gaits[2] = gallop;
    let cycle = 0, moveWeight = 0;
    for (let i = 0; i < 3; i++) {
      const track = gaits[i], w = g[i + 1]!;
      if (!track || w <= 0) continue;
      cycle += w * track.duration / gaitTimeScale(s, track.bound.spec.rigSpeed); moveWeight += w;
    }
    const phaseStep = moveWeight > 0 ? dt / (cycle / moveWeight) : 0, phase = (this.#phase + phaseStep) % 1;
    for (let i = 0; i < 3; i++) {
      const track = gaits[i]; if (!track) continue;
      const w = g[i + 1]! * base;
      this.#step(track, phaseStep * track.duration, true, w);
      track.time = phase * track.duration;
      if (w > 0 && track.bound.spec.contacts) this.#addContacts(track.bound.spec.contacts, phase, w);
    }
    this.#phase = phase;
    if (idle) this.#step(idle, dt, true, g[0]! * base);
    if (edge && this.#startStop) {
      this.#step(edge, dt * gaitTimeScale(Math.max(s, .35), edge.bound.spec.rigSpeed || .35), false, edgeWeight);
      if (edge.bound.spec.contacts) this.#addContacts(edge.bound.spec.contacts, edge.time / edge.duration, edgeWeight);
    }
    if (turn && turnWeight > 0) {
      const radians = Math.abs(turn.bound.spec.rootRotationDeg || 90) * Math.PI / 180;
      this.#step(turn, turnRate * dt / radians * turn.duration, true, turnShare);
    }
  }

  #advanceLayers(dt: number): void {
    for (let i = this.#layers.length - 1; i >= 0; i--) {
      const layer = this.#layers[i]!, delta = layer.target - layer.weight, track = layer.track, spec = track.bound.spec;
      layer.weight += Math.sign(delta) * Math.min(Math.abs(delta), layer.rate * dt);
      if (!spec.loop && track.time >= track.duration) layer.target = 0;
      if (layer.weight <= 0 && layer.target <= 0) { this.#layers.splice(i, 1); track.time = 0; continue; }
      this.#step(track, dt, spec.loop, layer.weight);
    }
  }

  #addContacts(contacts: NonNullable<BoundClip['spec']['contacts']>, phase: number, weight: number): void {
    for (let i = 0; i < 4; i++) this.contacts[i] = this.contacts[i]! + stanceWeight(contacts[PAWS[i]!], phase) * weight;
    this.locoWeight += weight;
  }

  dispose(): void { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot()); }
}
