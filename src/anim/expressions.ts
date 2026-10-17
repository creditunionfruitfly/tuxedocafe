import type { Catalog } from './catalog.ts';

/**
 * Facial expression curves (blink, slow blink, squint, ears flat, whiskers,
 * snarl, flehmen) driving morph targets by name. The Artist's
 * public/assets/art/cats/cat_expressions.json supplies the curves; any
 * expression it lacks (or the whole file, before M2-2 lands) falls back to a
 * shape synthesized from the catalog's duration and notes.
 */
export interface MorphCurve { readonly morph: number; readonly times: Float64Array; readonly values: Float64Array }
export interface ExpressionCurve { readonly name: string; readonly durationS: number; readonly curves: readonly MorphCurve[] }
export interface ExpressionLibrary { readonly morphNames: readonly string[]; readonly byName: ReadonlyMap<string, ExpressionCurve>; readonly clips: ReadonlyMap<string, ExpressionCurve> }

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Normalized (time, weight) keys for the catalog expressions when no authored curve exists. */
const DEFAULT_SHAPES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  blink: [[0, 0], [.32, 1], [.45, 1], [1, 0]],
  slow_blink: [[0, 0], [.28, 1], [.56, 1], [1, 0]],
  squint_content: [[0, 0], [.2, .6], [.8, .6], [1, 0]],
};
const GENERIC_SHAPE: readonly (readonly [number, number])[] = [[0, 0], [.25, 1], [.75, 1], [1, 0]];

function keysFrom(raw: unknown, durationS: number, fps: number): [Float64Array, Float64Array] | null {
  let times: number[] = [], values: number[] = [];
  if (Array.isArray(raw) && raw.every(v => typeof v === 'number')) {
    values = raw as number[]; times = values.map((_, i) => i / fps);
  } else if (Array.isArray(raw) && raw.every(v => Array.isArray(v) && v.length >= 2)) {
    for (const pair of raw as unknown[][]) { times.push(Number(pair[0])); values.push(Number(pair[1])); }
  } else if (isRecord(raw)) {
    const t = raw.times ?? raw.t, v = raw.values ?? raw.weights ?? raw.w;
    if (Array.isArray(t) && Array.isArray(v)) { times = t.map(Number); values = v.map(Number); }
  }
  const n = Math.min(times.length, values.length);
  if (!n || !times.slice(0, n).every(Number.isFinite) || !values.slice(0, n).every(Number.isFinite)) return null;
  const out: [Float64Array, Float64Array] = [new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) { out[0][i] = Math.min(durationS, Math.max(0, times[i]!)); out[1][i] = Math.min(1, Math.max(0, values[i]!)); }
  return out;
}

function shapeCurve(morph: number, durationS: number, shape: readonly (readonly [number, number])[]): MorphCurve {
  return { morph, times: Float64Array.from(shape, k => k[0] * durationS), values: Float64Array.from(shape, k => k[1]) };
}

/** Accepts `{ expressions: [{ name, durationS, fps, curves: { morph: curve } }] }`, a name-keyed map, or null. */
export function parseExpressions(json: unknown, catalog: Catalog): ExpressionLibrary {
  const morphNames = catalog.morphTargets, byName = new Map<string, ExpressionCurve>();
  const entries: Raw[] = [];
  const list = isRecord(json) ? json.expressions ?? json : null;
  if (Array.isArray(list)) entries.push(...list.filter(isRecord));
  else if (isRecord(list)) for (const [name, value] of Object.entries(list)) if (isRecord(value)) entries.push({ name, ...value });
  const fileFps = isRecord(json) && typeof json.fps === 'number' ? json.fps : catalog.fps;
  for (const entry of entries) {
    if (typeof entry.name !== 'string') continue;
    const spec = catalog.expressions.find(e => e.name === entry.name);
    const durationS = typeof entry.durationS === 'number' && entry.durationS > 0 ? entry.durationS : spec?.durationS ?? 1;
    const fps = typeof entry.fps === 'number' && entry.fps > 0 ? entry.fps : fileFps;
    const source = entry.curves ?? entry.tracks ?? entry.morphs;
    const curves: MorphCurve[] = [];
    if (isRecord(source)) for (const [morphName, raw] of Object.entries(source)) {
      const morph = morphNames.indexOf(morphName), keys = keysFrom(raw, durationS, fps);
      if (morph >= 0 && keys) curves.push({ morph, times: keys[0], values: keys[1] });
    }
    if (curves.length) byName.set(entry.name, { name: entry.name, durationS, curves });
  }
  for (const spec of catalog.expressions) {
    if (byName.has(spec.name)) continue;
    const shape = DEFAULT_SHAPES[spec.name] ?? GENERIC_SHAPE;
    byName.set(spec.name, { name: spec.name, durationS: spec.durationS, curves: spec.morphs.map(m => morphNames.indexOf(m)).filter(m => m >= 0).map(m => shapeCurve(m, spec.durationS, shape)) });
  }
  const clips = new Map<string, ExpressionCurve>();
  if (isRecord(json) && isRecord(json.clips)) for (const [name, entry] of Object.entries(json.clips)) {
    if (!isRecord(entry) || !isRecord(entry.curves)) continue;
    const durationS = typeof entry.durationS === 'number' ? entry.durationS : catalog.byName.get(name)?.durationS ?? 1;
    const curves: MorphCurve[] = [];
    for (const [morphName, raw] of Object.entries(entry.curves)) {
      const morph = morphNames.indexOf(morphName), keys = keysFrom(raw, durationS, fileFps);
      if (morph >= 0 && keys) curves.push({ morph, times: keys[0], values: keys[1] });
    }
    clips.set(name, { name, durationS, curves });
  }
  return { morphNames, byName, clips };
}

/** Linear interpolation over sorted keys, clamped at both ends. */
export function sampleCurve(curve: MorphCurve, time: number): number {
  const t = curve.times, v = curve.values, n = t.length;
  if (!n) return 0;
  if (time <= t[0]!) return v[0]!;
  if (time >= t[n - 1]!) return v[n - 1]!;
  let i = 1;
  while (i < n - 1 && t[i]! < time) i++;
  const span = t[i]! - t[i - 1]!;
  return span > 0 ? v[i - 1]! + (v[i]! - v[i - 1]!) * (time - t[i - 1]!) / span : v[i]!;
}

const SLOTS = 6;

/** Plays expressions on one cat; weights combine by maximum per morph. */
export class ExpressionPlayer {
  readonly library: ExpressionLibrary;
  readonly #curves: (ExpressionCurve | null)[] = new Array<ExpressionCurve | null>(SLOTS).fill(null);
  readonly #time = new Float64Array(SLOTS);
  readonly #weight = new Float64Array(SLOTS);
  readonly #rate = new Float64Array(SLOTS);

  constructor(library: ExpressionLibrary) { this.library = library; }

  /** Starts (or restarts) an expression; `durationS` stretches it (a clip's length). */
  play(name: string, weight = 1, durationS?: number): boolean {
    const curve = this.library.byName.get(name); if (!curve) return false;
    let slot = this.#curves.indexOf(curve);
    if (slot < 0) slot = this.#curves.indexOf(null);
    if (slot < 0) { slot = 0; for (let i = 1; i < SLOTS; i++) if (this.#time[i]! > this.#time[slot]!) slot = i; }
    this.#curves[slot] = curve; this.#time[slot] = 0; this.#weight[slot] = weight;
    this.#rate[slot] = durationS && durationS > 0 ? curve.durationS / durationS : 1;
    return true;
  }

  isPlaying(name: string): boolean { return this.#curves.some(c => c?.name === name); }

  advance(dt: number): void {
    for (let i = 0; i < SLOTS; i++) {
      const curve = this.#curves[i]; if (!curve) continue;
      this.#time[i] = this.#time[i]! + dt * this.#rate[i]!;
      if (this.#time[i]! > curve.durationS) this.#curves[i] = null;
    }
  }

  /** Max-combines the active weights into `out` (catalog morph order). */
  accumulate(out: Float64Array): void {
    for (let i = 0; i < SLOTS; i++) {
      const curve = this.#curves[i]; if (!curve) continue;
      for (let k = 0; k < curve.curves.length; k++) {
        const morph = curve.curves[k]!;
        out[morph.morph] = Math.max(out[morph.morph]!, sampleCurve(morph, this.#time[i]!) * this.#weight[i]!);
      }
    }
  }
}
