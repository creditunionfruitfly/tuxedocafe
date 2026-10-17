import buildsJson from '../../data/cat-builds.json' with { type: 'json' };
import catsJson from '../../data/cats.json' with { type: 'json' };

/**
 * Body builds (data/cat-builds.json) merged with each resident's `model`
 * block (data/cats.json): scale multiplies, group overrides replace the
 * build's value field by field, morphs merge.
 */
export interface GroupParams { readonly length: number; readonly girth: number }
export interface BuildSpec { readonly scale?: number; readonly groups?: Readonly<Record<string, Partial<GroupParams>>>; readonly morphs?: Readonly<Record<string, number>> }
export interface BuildData { readonly groups: Readonly<Record<string, readonly string[]>>; readonly builds: Readonly<Record<string, BuildSpec>> }
export interface CatModel {
  readonly build: string; readonly scale?: number;
  readonly overrides?: Readonly<Record<string, Partial<GroupParams>>>;
  readonly morphs?: Readonly<Record<string, number>>;
  readonly eyes?: { readonly iris?: string; readonly limbal?: string; readonly pupil?: string };
  readonly leather?: { readonly nose?: string; readonly pads?: string };
  readonly coat?: { readonly pattern?: string; readonly palette?: Readonly<Record<string, string>>; readonly sheen?: number };
}
export interface ResidentCatData { readonly id: string; readonly name: string; readonly age?: string; readonly model: CatModel }
export interface ResolvedBuild {
  readonly cat: string; readonly build: string; readonly scale: number;
  readonly groups: Readonly<Record<string, GroupParams>>;
  readonly morphs: Readonly<Record<string, number>>;
}

export const BUILDS = buildsJson as unknown as BuildData;
export const RESIDENTS = catsJson.cats as unknown as readonly ResidentCatData[];

const positive = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

export function resolveBuild(cat: Pick<ResidentCatData, 'id' | 'model'>, data: BuildData = BUILDS): ResolvedBuild {
  const name = data.builds[cat.model.build] ? cat.model.build : 'adult';
  const build = data.builds[name] ?? {};
  const groups: Record<string, GroupParams> = {};
  for (const group of Object.keys(data.groups)) {
    const base = build.groups?.[group], override = cat.model.overrides?.[group];
    groups[group] = {
      length: positive(override?.length, positive(base?.length, 1)),
      girth: positive(override?.girth, positive(base?.girth, 1)),
    };
  }
  return {
    cat: cat.id, build: name, scale: positive(build.scale, 1) * positive(cat.model.scale, 1), groups,
    morphs: { ...build.morphs, ...cat.model.morphs },
  };
}

/** Bone name → group name. */
export function groupOfBone(data: BuildData = BUILDS): Map<string, string> {
  const map = new Map<string, string>();
  for (const [group, bones] of Object.entries(data.groups)) for (const bone of bones) map.set(bone, group);
  return map;
}

export function residentById(id: string): ResidentCatData | undefined { return RESIDENTS.find(cat => cat.id === id); }
