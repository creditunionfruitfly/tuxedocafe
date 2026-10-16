export interface Settings { reducedMotion: boolean; leftHanded: boolean; holdToggle: boolean; holdMs: number; captions: boolean; tier: string; music: number; effects: number }
export const DEFAULT_SETTINGS: Settings = { reducedMotion: false, leftHanded: false, holdToggle: false, holdMs: 250, captions: true, tier: 'auto', music: .6, effects: .8 };
export function cleanSettings(value: Partial<Settings>): Settings {
  const result = { ...DEFAULT_SETTINGS, ...value };
  result.holdMs = Math.max(150, Math.min(1000, Number(result.holdMs) || 250));
  result.music = Math.max(0, Math.min(1, Number(result.music) || 0)); result.effects = Math.max(0, Math.min(1, Number(result.effects) || 0));
  return result;
}
