import { expect, it } from 'vitest';
import { migrateSave } from '../../src/core/storage.ts';
import { cleanVisit, freshVisit, visitMigrations, type Visit } from '../../src/save/visit.ts';

it.each([[.6, 1], [.35, .35], [0, 0]])('migrates an old music setting of %s to %s', (music, expected) => {
  const visit = migrateSave(
    { schemaVersion: 1, settings: { music, effects: .5 }, waterDone: true },
    freshVisit().schemaVersion,
    visitMigrations,
  ) as Visit;
  expect(cleanVisit(visit)).toMatchObject({ settings: { master: 1, music: expected, effects: .5 }, waterDone: true });
});

it.each([[.85, .8, 1, 1], [.4, .3, .4, .3], [0, 0, 0, 0]])('migrates master %s and effects %s', (master, effects, expectedMaster, expectedEffects) => {
  const visit = migrateSave({ schemaVersion: 2, settings: { master, effects, music: .5 } }, freshVisit().schemaVersion, visitMigrations) as Visit;
  expect(cleanVisit(visit).settings).toMatchObject({ master: expectedMaster, effects: expectedEffects, music: .5 });
});

it('defaults older visits to Aero and retains a saved C64 choice', () => {
  const migrated = migrateSave({ schemaVersion: 3, settings: { master: .5, music: 0 } }, freshVisit().schemaVersion, visitMigrations) as Visit;
  expect(cleanVisit(migrated).settings).toMatchObject({ soundfont: 'aero', master: .5, music: 0 });
  const visit = freshVisit();
  visit.settings.soundfont = 'c64';
  expect(cleanVisit(visit).settings.soundfont).toBe('c64');
});
