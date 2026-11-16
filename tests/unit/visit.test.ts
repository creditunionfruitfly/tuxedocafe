import { expect, it } from 'vitest';
import { migrateSave } from '../../src/core/storage.ts';
import { cleanVisit, freshVisit, visitMigrations, type Visit } from '../../src/save/visit.ts';

it.each([[.6, 1], [.35, .35], [0, 0]])('migrates an old music setting of %s to %s', (music, expected) => {
  const visit = migrateSave(
    { schemaVersion: 1, settings: { music, effects: .5 }, waterDone: true },
    freshVisit().schemaVersion,
    visitMigrations,
  ) as Visit;
  expect(cleanVisit(visit)).toMatchObject({ settings: { master: .85, music: expected, effects: .5 }, waterDone: true });
});
