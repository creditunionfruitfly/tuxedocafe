import { Matrix4, Quaternion, Sphere, Vector3, type PerspectiveCamera, type Ray } from 'three';
import cats from '../../data/cats.json' with { type: 'json' };
import type { EventBus } from '../core/events.ts';
import type { Reaction, Zone } from '../cats/brain.ts';
import type { Resident } from '../cats/resident.ts';

export interface RadialItem { id: string; label: string; disabled?: boolean; hold?: boolean }
const ZONES: readonly { id: Zone; label: string }[] = [{ id: 'cheeks', label: 'Cheeks' }, { id: 'chin', label: 'Chin' }, { id: 'head', label: 'Between the ears' }, { id: 'back', label: 'Back' }, { id: 'belly', label: 'Belly' }, { id: 'tailBase', label: 'Base of the tail' }];
const PERKS = ['Catnip', 'Laser', 'Feather wand', 'Harness walk'];
const MAIN: readonly RadialItem[] = [{ id: 'pet', label: 'Pet' }, { id: 'blink', label: 'Slow blink' }, { id: 'play', label: 'Play' }, { id: 'perks', label: 'Perks' }, { id: 'leave', label: 'Leave' }];
const CAPTION: Record<Reaction, string> = { content: 'Purring, leaning into your hand.', warning: 'Tail lashing, ears turning back. Time to stop.', over: 'A swat! That was too much.' };
const REACH = 6, EASE = .6;
const nameOf = (id: string): string => cats.cats.find(cat => cat.id === id)?.name ?? id;

/**
 * Tap a cat for a close-up: the camera eases in, the cat decides on its own terms whether to stay,
 * and a round menu offers petting by zone, a slow blink, play and the (coming) perks.
 */
export class CloseUp {
  target: Resident | null = null;
  readonly #bus: EventBus; readonly #reducedMotion: () => boolean;
  #blend = 0; #leaving = 0; #zone: Zone | null = null; #reaction: Reaction | null = null;
  readonly #sphere = new Sphere(); readonly #hit = new Vector3(); readonly #pos = new Vector3(); readonly #look = new Vector3(); readonly #quat = new Quaternion(); readonly #m = new Matrix4(); readonly #up = new Vector3(0, 1, 0);
  constructor(bus: EventBus, reducedMotion: () => boolean) {
    this.#bus = bus; this.#reducedMotion = reducedMotion;
    bus.on('radial:select', ({ id }) => this.#select(id));
    bus.on('radial:hold', ({ id, down }) => this.#hold(id as Zone, down));
  }
  /** The nearest resident a tap ray hits, within a few metres. */
  pick(ray: Ray, residents: readonly Resident[]): Resident | null {
    let best: Resident | null = null, distance = REACH;
    for (const cat of residents) {
      const s = cat.root.scale.x; this.#sphere.center.copy(cat.root.position).y += .18 * s; this.#sphere.radius = .24 * s;
      if (ray.intersectSphere(this.#sphere, this.#hit)) { const d = this.#hit.distanceTo(ray.origin); if (d < distance) { distance = d; best = cat; } }
    }
    return best;
  }
  enter(cat: Resident, patron: { x: number; z: number }): void {
    this.target = cat; this.#leaving = 0; this.#zone = null; this.#reaction = null;
    const name = nameOf(cat.id);
    if (cat.brain.engage(patron)) { this.#bus.emit('notice', { text: `${name} settles down with you.` }); this.#menu(MAIN); }
    else { this.#bus.emit('notice', { text: `${name} isn't in the mood and wanders off.` }); this.#leaving = 1.6; }
  }
  exit(): void { this.target?.brain.disengage(); this.target = null; this.#zone = null; this.#bus.emit('radial', null); }
  step(dt: number, patron: { x: number; z: number }): void {
    this.#blend = this.#reducedMotion() ? (this.target ? 1 : 0) : Math.max(0, Math.min(1, this.#blend + (this.target ? dt : -dt) / EASE));
    const cat = this.target;
    if (!cat) return;
    if (this.#leaving > 0) { if ((this.#leaving -= dt) <= 0) this.exit(); return; }
    if (!cat.brain.engaged) { this.#bus.emit('radial', null); this.#leaving = 1.4; return; }
    if (!this.#zone) return;
    const reaction = cat.brain.pet(this.#zone, dt, patron);
    if (reaction !== this.#reaction) { this.#reaction = reaction; this.#bus.emit('notice', { text: CAPTION[reaction] }); }
    if (reaction === 'over') { this.#zone = null; this.#bus.emit('radial', null); this.#leaving = 1.4; }
  }
  /** Eases the patron's camera toward a low, close view of the cat's face. */
  apply(camera: PerspectiveCamera): void {
    const cat = this.target ?? null;
    if (this.#blend <= 0 || !cat) return;
    const s = cat.root.scale.x, p = cat.root.position, dx = camera.position.x - p.x, dz = camera.position.z - p.z, d = Math.hypot(dx, dz) || 1, e = this.#blend * this.#blend * (3 - 2 * this.#blend);
    this.#pos.set(p.x + dx / d * .8 * s, p.y + .48 * s + .08, p.z + dz / d * .8 * s); this.#look.set(p.x, p.y + .24 * s, p.z);
    this.#quat.setFromRotationMatrix(this.#m.lookAt(this.#pos, this.#look, this.#up));
    camera.position.lerp(this.#pos, e); camera.quaternion.slerp(this.#quat, e);
  }
  #menu(items: readonly RadialItem[]): void { this.#bus.emit('radial', { title: nameOf(this.target?.id ?? ''), items }); }
  #select(id: string): void {
    const brain = this.target?.brain;
    if (!brain) return;
    if (id === 'pet') this.#menu([...ZONES.map(zone => ({ ...zone, hold: true })), { id: 'back', label: 'Back' }]);
    else if (id === 'perks') this.#menu([...PERKS.map(label => ({ id: `perk:${label}`, label, disabled: true })), { id: 'back', label: 'Back' }]);
    else if (id === 'back') { this.#hold(this.#zone ?? 'back' as Zone, false); this.#menu(MAIN); }
    else if (id === 'blink') this.#bus.emit('notice', { text: brain.slowBlink() ? `${nameOf(this.target!.id)} blinks slowly back.` : 'No blink back yet. Trust takes time.' });
    else if (id === 'play') { brain.playWith(); this.#bus.emit('notice', { text: 'A quick game with your hand.' }); }
    else if (id === 'leave') this.exit();
  }
  #hold(zone: Zone, down: boolean): void {
    if (down) { this.#zone = zone; this.#reaction = null; return; }
    if (this.#zone) this.target?.brain.stopPetting();
    this.#zone = null;
  }
}
