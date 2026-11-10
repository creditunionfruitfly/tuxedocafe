import type { Settings } from '../input/settings.ts';

export interface GameEvents {
  'notice': { text: string };
  'session': { playing: boolean };
  'profile': { name: string; pronouns: string; skin: string; sleeve: string };
  'settings': Settings;
  'action': { target: string; action: string };
  'hover': { target: string; x: number; y: number; actions: readonly string[] } | null;
  'chore:progress': { progress: number };
  'chore:done': { id: string };
  'player': { x: number; z: number };
  'radial': { title: string; center?: boolean; items: readonly { id: string; label: string; disabled?: boolean; hold?: boolean }[] } | null;
  'radial:select': { id: string };
  'radial:hold': { id: string; down: boolean };
  'cat-view': { id: string; name: string } | null;
  'cat-view:exit': undefined;
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
