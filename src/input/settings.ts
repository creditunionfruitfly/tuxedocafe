export interface Settings { reducedMotion: boolean; catMode: boolean; leftHanded: boolean; holdToggle: boolean; holdMs: number; captions: boolean; tier: string; master: number; music: number; effects: number }
export const DEFAULT_SETTINGS: Settings = { reducedMotion: false, catMode: true, leftHanded: false, holdToggle: false, holdMs: 250, captions: true, tier: 'auto', master: .85, music: 1, effects: .8 };
export function cleanSettings(value: Partial<Settings>): Settings {
  const result = { ...DEFAULT_SETTINGS, ...value };
  result.catMode = value.catMode !== false;
  result.holdMs = Math.max(150, Math.min(1000, Number(result.holdMs) || 250));
  for (const key of ['master', 'music', 'effects'] as const) {
    result[key] = Math.max(0, Math.min(1, Number(result[key]) || 0));
  }
  return result;
}
