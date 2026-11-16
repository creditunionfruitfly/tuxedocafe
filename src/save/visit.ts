import { DEFAULT_SETTINGS, cleanSettings, type Settings } from '../input/settings.ts';
import type { Migrations, SavedState } from '../core/storage.ts';
export interface Profile { name: string; pronouns: string; skin: string; sleeve: string }
export interface Visit extends SavedState { schemaVersion: number; profile: Profile|null; settings: Settings; waterDone: boolean }
export function freshVisit(): Visit { return { schemaVersion:4, profile:null, settings:{...DEFAULT_SETTINGS}, waterDone:false }; }
export const visitMigrations: Migrations = {
  1: save => {
    const settings = save.settings as Partial<Settings> | undefined;
    const music = settings?.music;
    return { ...save, schemaVersion: 2, settings: { ...settings, music: music === undefined || music === .6 ? DEFAULT_SETTINGS.music : music } };
  },
  2: save => {
    const settings = save.settings as Partial<Settings> | undefined;
    return { ...save, schemaVersion: 3, settings: {
      ...settings,
      master: settings?.master === .85 ? DEFAULT_SETTINGS.master : settings?.master ?? DEFAULT_SETTINGS.master,
      effects: settings?.effects === .8 ? DEFAULT_SETTINGS.effects : settings?.effects ?? DEFAULT_SETTINGS.effects,
    } };
  },
  3: save => ({ ...save, schemaVersion: 4, settings: { ...cleanSettings((save.settings ?? {}) as Partial<Settings>), soundfont: 'aero' } }),
};
export function cleanVisit(value: Visit): Visit {
  const fresh=freshVisit();
  const p=value.profile;
  if(p && typeof p.name==='string' && p.name.trim() && typeof p.pronouns==='string' && /^#[\da-f]{6}$/i.test(p.skin) && /^#[\da-f]{6}$/i.test(p.sleeve)) fresh.profile={...p,name:p.name.trim().slice(0,24),pronouns:p.pronouns.slice(0,32)};
  fresh.settings=cleanSettings(value.settings??{});fresh.waterDone=value.waterDone===true;return fresh;
}
