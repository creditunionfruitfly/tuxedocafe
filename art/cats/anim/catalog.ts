// The binding clip contract (data/animation-catalog.json) and the clip
// framework shared by every clip module.
import { readFileSync } from 'node:fs';
import type { Quaternion } from 'three';
import type { Body } from './body.ts';
import type { LegId, Measures, Pose, Rig } from './rig.ts';

export interface CatalogEvent { t: number; name: string }
export interface CatalogClip {
  name: string; layer: 'locomotion' | 'action' | 'additive'; loop: boolean; durationS: number;
  authoredSpeed?: number; contacts?: Partial<Record<LegId, number>>; dutyFactor?: number;
  events?: CatalogEvent[]; rootRotationDeg?: number; rootMotion?: boolean; heightM?: number;
  reachBone?: string; bones?: string; morphs?: string[]; notes: string; firstUsedIn?: string;
}
export interface CatalogExpression { name: string; morphs: string[]; durationS: number; notes: string }
export interface Catalog {
  fps: number; gaitThresholdsMps: { walkMax: number; trotMax: number };
  morphTargets: string[]; expressions: CatalogExpression[]; clips: CatalogClip[];
}

export const loadCatalog = (path = 'data/animation-catalog.json') => JSON.parse(readFileSync(path, 'utf8')) as Catalog;

/** Expand a catalog bone list such as "tail_07..tail_12", "ear_*" or "spine_04,neck_01,head". */
export function expandBones(spec: string, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const part of spec.split(',').map(s => s.trim())) {
    const range = /^(.*?)(\d+)\.\.(.*?)(\d+)$/.exec(part);
    if (range) {
      const [, prefix, from, , to] = range;
      for (let i = Number(from); i <= Number(to); i++) out.push(`${prefix}${String(i).padStart(from!.length, '0')}`);
    } else if (part.endsWith('*')) out.push(...names.filter(n => n.startsWith(part.slice(0, -1))));
    else out.push(part);
  }
  for (const n of out) if (!names.includes(n)) throw new Error(`catalog bone list names unknown bone ${n}`);
  return out;
}

export interface Ctx {
  rig: Rig; M: Measures; clip: CatalogClip; catalog: Catalog;
  /** Duration, frame count (frames = n + 1 including the end) and frame time. */
  T: number; n: number; dt: number;
  /** Deterministic per-clip seed. */
  seed: number;
}

export type Stance = Partial<Record<LegId, [number, number][]>>;

/** Floor height under (x, z) at time t, for ground-penetration checks (jumps change it). */
export type Terrain = (x: number, z: number) => number;

export interface TailSim { wBase: number; wTip: number; zeta: number }

export interface ClipSpec {
  name: string;
  /** Body per frame; t in seconds from 0 to T inclusive. */
  body?: (t: number, ctx: Ctx) => Body;
  /** Optional tail follow-through simulation over the body frames. */
  tailSim?: TailSim;
  /** Paw stance intervals in seconds (may run past T on loops), checked for slip and exported. */
  stance?: (ctx: Ctx) => Stance;
  /** In-place ground speed (rig m/s along -Z) for slip checks of planted paws. */
  groundSpeed?: (t: number, ctx: Ctx) => number;
  /** Floor model for ground checks (default flat at y = 0). */
  terrain?: (ctx: Ctx) => Terrain;
  /** Additive clips: bone offsets per frame, composed onto the reference pose. */
  additive?: { reference: string; offsets: (t: number, ctx: Ctx) => Record<string, Quaternion> };
  /** Extra extras (rigSpeed, strideFit...). */
  extras?: (ctx: Ctx) => Record<string, unknown>;
}

export interface Built {
  spec: ClipSpec; clip: CatalogClip; ctx: Ctx;
  frames: Pose[];
  /** Bones that get rotation tracks. */
  bones: number[];
  rootTranslation: boolean; rootRotation: boolean; pelvisTranslation: boolean;
  extras: Record<string, unknown>;
  stance: Stance;
  bodies: Body[] | null;
}
