export interface SavedState { schemaVersion: number; [key: string]: unknown }
export interface KeyStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type Migrations = Readonly<Record<number, (save: SavedState) => SavedState>>;
export function storageKey(channel: string, name: string): string { return `tuxedocafe:${channel}:${name}`; }
export function migrateSave(value: unknown, version: number, migrations: Migrations): SavedState {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value)) throw new Error('Unreadable save');
  let save = value as SavedState;
  if (!Number.isInteger(save.schemaVersion) || save.schemaVersion > version) throw new Error('Unsupported save version');
  while (save.schemaVersion < version) {
    const migration = migrations[save.schemaVersion];
    if (!migration) throw new Error('Missing migration');
    const next = migration(save);
    if (next.schemaVersion !== save.schemaVersion + 1) throw new Error('Invalid migration');
    save = next;
  }
  return save;
}
/** localStorage fallback stays usable when IndexedDB is blocked or unavailable. */
export class SaveStore<T extends SavedState> {
  #db: IDBDatabase | null = null;
  #memory = new Map<string, string>();
  readonly channel: string; readonly fallback: KeyStorage | null; readonly fresh: () => T; readonly migrations: Migrations; readonly notice: (text: string) => void;
  constructor(channel: string, fallback: KeyStorage | null, fresh: () => T, migrations: Migrations = {}, notice: (text: string) => void = () => {}) { this.channel = channel; this.fallback = fallback; this.fresh = fresh; this.migrations = migrations; this.notice = notice; }
  async open(): Promise<void> {
    try {
      this.#db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`tuxedocafe-${this.channel}`, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('saves');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Storage busy'));
      });
    } catch { this.#db = null; }
  }
  async load(name: string): Promise<T> {
    const key = storageKey(this.channel, name);
    let raw: string | null = null;
    try {
      if (this.#db) raw = await new Promise<string | null>((resolve, reject) => {
        const request = this.#db!.transaction('saves').objectStore('saves').get(name);
        request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
        request.onerror = () => reject(request.error);
      });
    } catch { /* A local copy is kept below. */ }
    try { raw ??= this.fallback?.getItem(key) ?? this.#memory.get(key) ?? null; } catch { raw ??= this.#memory.get(key) ?? null; }
    if (raw === null) return this.fresh();
    try { return migrateSave(JSON.parse(raw), this.fresh().schemaVersion, this.migrations) as T; }
    catch {
      this.#memory.set(`${key}:backup`, raw);
      try { this.fallback?.setItem(`${key}:backup`, raw); } catch { /* The memory backup is retained. */ }
      try { if (this.#db) this.#db.transaction('saves', 'readwrite').objectStore('saves').put(raw, `${name}:backup`); } catch { /* Backups also remain in memory. */ }
      this.notice('Your previous save was kept as a backup. A fresh visit is ready.');
      const fresh = this.fresh(); await this.save(name, fresh); return fresh;
    }
  }
  async save(name: string, value: T): Promise<void> {
    const raw = JSON.stringify(value); const key = storageKey(this.channel, name);
    this.#memory.set(key, raw);
    try { this.fallback?.setItem(key, raw); } catch { /* Memory works for this visit. */ }
    try {
      if (this.#db) await new Promise<void>((resolve, reject) => {
        const tx = this.#db!.transaction('saves', 'readwrite'); tx.objectStore('saves').put(raw, name);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
    } catch { /* Local fallback already saved. */ }
  }
}
export function browserStorage(): KeyStorage | null { try { return localStorage; } catch { return null; } }
