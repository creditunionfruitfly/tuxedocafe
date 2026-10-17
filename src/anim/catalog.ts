import catalogJson from '../../data/animation-catalog.json' with { type: 'json' };

/**
 * The M2 clip contract (data/animation-catalog.json), normalized for the runtime.
 * glTF clip extras override catalog fields clip by clip (parseClipSpec), so an
 * Artist's export can refine contacts or events without a code change.
 */
export type ClipLayer = 'locomotion' | 'action' | 'additive';
export type PawId = 'LF' | 'RF' | 'LH' | 'RH';
/** Leg order used everywhere in src/anim: front left, front right, hind left, hind right. */
export const PAWS: readonly PawId[] = ['LF', 'RF', 'LH', 'RH'];
/** Stance windows in clip phase (0–1): [touchdown, lift-off), lift-off may exceed 1 (wraps). */
export type StanceWindows = readonly (readonly [number, number])[];
export interface ClipEvent { readonly t: number; readonly name: string }
export type AdditiveReference =
  | { readonly kind: 'rest' }
  | { readonly kind: 'clip'; readonly clip: string; readonly time: number };
export interface ClipSpec {
  readonly name: string;
  readonly layer: ClipLayer;
  readonly loop: boolean;
  readonly durationS: number;
  /** m/s at adult scale for in-place locomotion; 0 otherwise. */
  readonly authoredSpeed: number;
  /** Per-paw stance windows, or null when the clip carries no contact data. */
  readonly contacts: Readonly<Partial<Record<PawId, StanceWindows>>> | null;
  readonly events: readonly ClipEvent[];
  readonly morphs: readonly string[];
  readonly rootMotion: boolean;
  readonly rootRotationDeg: number;
  readonly reachBone: string | null;
  readonly additiveReference: AdditiveReference;
}
export interface ExpressionSpec { readonly name: string; readonly morphs: readonly string[]; readonly durationS: number }
export interface GaitThresholds { readonly walkMax: number; readonly trotMax: number }
export interface Catalog {
  readonly fps: number;
  readonly gaitThresholds: GaitThresholds;
  readonly stackOrder: readonly string[];
  readonly morphTargets: readonly string[];
  readonly expressions: readonly ExpressionSpec[];
  readonly clips: readonly ClipSpec[];
  readonly byName: ReadonlyMap<string, ClipSpec>;
}

const DEFAULT_DUTY = 0.6;
type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const wrap01 = (value: number): number => value - Math.floor(value);

/** Accepts `0.25` (touchdown, lift-off from the duty factor), `[down, up]` or `[[down, up], …]`. */
export function normalizeContacts(raw: unknown, dutyFactor: number | null): ClipSpec['contacts'] {
  if (!isRecord(raw)) return null;
  const duty = Math.min(.98, Math.max(.05, dutyFactor ?? DEFAULT_DUTY));
  const result: Partial<Record<PawId, StanceWindows>> = {};
  let any = false;
  for (const paw of PAWS) {
    const value = raw[paw];
    const pairs: [number, number][] = [];
    const push = (down: number, up: number): void => {
      const start = wrap01(down); let length = up - down;
      if (!(length > 0)) length = wrap01(length) || duty;
      pairs.push([start, start + Math.min(length, .999)]);
    };
    if (typeof value === 'number' && Number.isFinite(value)) push(value, value + duty);
    else if (Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number')) push(value[0] as number, value[1] as number);
    else if (Array.isArray(value)) for (const item of value) if (Array.isArray(item) && item.length === 2) push(num(item[0], 0), num(item[1], duty));
    if (pairs.length) { pairs.sort((a, b) => a[0] - b[0]); result[paw] = pairs; any = true; }
  }
  return any ? result : null;
}

export function normalizeEvents(raw: unknown, duration: number): ClipEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: ClipEvent[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.name !== 'string') continue;
    events.push({ t: Math.min(duration, Math.max(0, num(item.t, 0))), name: item.name });
  }
  return events.sort((a, b) => a.t - b.t);
}

/** `"rest"`/`"bind"` (default), a clip name, or `{ clip, frame | time }`. */
export function parseAdditiveReference(raw: unknown, fps: number): AdditiveReference {
  if (typeof raw === 'string') {
    if (raw === '' || raw === 'rest' || raw === 'bind' || raw === 'bindPose') return { kind: 'rest' };
    return { kind: 'clip', clip: raw, time: 0 };
  }
  if (isRecord(raw) && typeof raw.clip === 'string' && raw.clip !== 'rest' && raw.clip !== 'bind') {
    return { kind: 'clip', clip: raw.clip, time: Math.max(0, typeof raw.time === 'number' ? raw.time : num(raw.frame, 0) / fps) };
  }
  return { kind: 'rest' };
}

const LAYERS: readonly ClipLayer[] = ['locomotion', 'action', 'additive'];

/** Merge one clip's fields: `override` (glTF extras) wins over `base` (catalog) field by field. */
export function parseClipSpec(name: string, base: Raw | null, override: Raw | null, fps: number, actualDuration = 0): ClipSpec {
  const pick = (key: string): unknown => override && override[key] !== undefined ? override[key] : base?.[key];
  const layerValue = pick('layer');
  const layer = LAYERS.includes(layerValue as ClipLayer) ? layerValue as ClipLayer : 'action';
  const durationS = actualDuration > 0 ? actualDuration : Math.max(1 / fps, num(pick('durationS'), 1));
  const duty = typeof pick('dutyFactor') === 'number' ? pick('dutyFactor') as number : null;
  const morphs = pick('morphs');
  return {
    name, layer, durationS,
    loop: pick('loop') === true,
    authoredSpeed: Math.max(0, num(pick('authoredSpeed'), 0)),
    contacts: normalizeContacts(pick('contacts'), duty),
    events: normalizeEvents(pick('events'), durationS),
    morphs: Array.isArray(morphs) ? morphs.filter((m): m is string => typeof m === 'string') : [],
    rootMotion: pick('rootMotion') === true,
    rootRotationDeg: num(pick('rootRotationDeg'), 0),
    reachBone: typeof pick('reachBone') === 'string' ? pick('reachBone') as string : null,
    additiveReference: parseAdditiveReference(pick('additiveReference'), fps),
  };
}

export function parseCatalog(json: unknown): Catalog {
  if (!isRecord(json) || !Array.isArray(json.clips)) throw new Error('animation-catalog.json needs a clips array');
  const fps = num(json.fps, 30);
  const thresholds = isRecord(json.gaitThresholdsMps) ? json.gaitThresholdsMps : {};
  const clips = json.clips.filter(isRecord).filter(c => typeof c.name === 'string').map(c => parseClipSpec(c.name as string, c, null, fps));
  const expressions = (Array.isArray(json.expressions) ? json.expressions : []).filter(isRecord).filter(e => typeof e.name === 'string').map(e => ({
    name: e.name as string,
    morphs: Array.isArray(e.morphs) ? e.morphs.filter((m): m is string => typeof m === 'string') : [],
    durationS: Math.max(1 / fps, num(e.durationS, .5)),
  }));
  return {
    fps,
    gaitThresholds: { walkMax: num(thresholds.walkMax, 1.1), trotMax: num(thresholds.trotMax, 2.2) },
    stackOrder: Array.isArray(json.stackOrder) ? json.stackOrder.filter((s): s is string => typeof s === 'string') : [],
    morphTargets: Array.isArray(json.morphTargets) ? json.morphTargets.filter((m): m is string => typeof m === 'string') : [],
    expressions, clips, byName: new Map(clips.map(clip => [clip.name, clip])),
  };
}

/** The raw catalog entry for a clip (for merging with glTF extras). */
export function rawCatalogClip(name: string, json: unknown = catalogJson): Raw | null {
  if (!isRecord(json) || !Array.isArray(json.clips)) return null;
  return json.clips.find((c): c is Raw => isRecord(c) && c.name === name) ?? null;
}

export const CATALOG: Catalog = parseCatalog(catalogJson);

/** Smooth 0→1 stance weight at a clip phase: ramps in before touchdown and out after lift-off. */
export function stanceWeight(windows: StanceWindows | undefined, phase: number, blendIn = .06, blendOut = .04): number {
  if (!windows) return 0;
  const p = wrap01(phase);
  let best = 0;
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i]!, down = window[0], up = window[1];
    for (let shift = -1; shift <= 1; shift++) {
      const d = down + shift, u = up + shift;
      let w = 0;
      if (p >= d && p < u) w = 1;
      else if (p < d && p >= d - blendIn) w = 1 - (d - p) / blendIn;
      else if (p >= u && p < u + blendOut) w = 1 - (p - u) / blendOut;
      if (w > best) best = w;
    }
  }
  return best * best * (3 - 2 * best);
}
