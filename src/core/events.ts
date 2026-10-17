export interface GameEvents {
  'notice': { text: string };
  'session': { playing: boolean };
  'profile': { name: string; pronouns: string; skin: string; sleeve: string };
  'settings': { reducedMotion: boolean; leftHanded: boolean; holdToggle: boolean; holdMs: number; captions: boolean; tier: string; music: number; effects: number };
  'action': { target: string; action: string };
  'hover': { target: string; x: number; y: number; actions: readonly string[] } | null;
  'chore:progress': { progress: number };
  'chore:done': { id: string };
  'player': { x: number; z: number };
  /** A clip event crossed on the fixed step; names starting `sfx:` are audio event ids (M2-5 plays them). */
  'cat:anim-event': { cat: string; clip: string; name: string };
}
export class EventBus<Events extends object = GameEvents> {
  #listeners = new Map<keyof Events, Set<(value: never) => void>>();
  on<K extends keyof Events>(type: K, listener: (value: Events[K]) => void): () => void {
    let listeners = this.#listeners.get(type);
    if (!listeners) { listeners = new Set(); this.#listeners.set(type, listeners); }
    listeners.add(listener as (value: never) => void);
    return () => this.off(type, listener);
  }
  off<K extends keyof Events>(type: K, listener: (value: Events[K]) => void): void {
    this.#listeners.get(type)?.delete(listener as (value: never) => void);
  }
  emit<K extends keyof Events>(type: K, value: Events[K]): void {
    this.#listeners.get(type)?.forEach(listener => listener(value as never));
  }
}
