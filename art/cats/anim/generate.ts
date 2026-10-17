// Entry point run by `npm run assets`: builds every catalogued clip on the
// shared skeleton, validates the library and writes cat_anims.glb plus
// cat_expressions.json (and their provenance sidecars).
import { writeFileSync } from 'node:fs';
import { buildClip } from './build.ts';
import { type Built, type ClipSpec, loadCatalog } from './catalog.ts';
import { writeAnimations } from './export.ts';
import { loadRig } from './rig.ts';
import { validate } from './validate.ts';
import { locoClips } from './clips/loco.ts';
import { restClips } from './clips/rest.ts';

export const OUT_GLB = 'public/assets/art/cats/cat_anims.glb';
export const OUT_EXPRESSIONS = 'public/assets/art/cats/cat_expressions.json';

const allSpecs: ClipSpec[] = [...locoClips, ...restClips];

export async function makeCatAnims() {
  const rig = loadRig(), catalog = loadCatalog();
  const specs = new Map(allSpecs.map(s => [s.name, s]));
  const only = process.env.CAT_CLIPS ? new Set(process.env.CAT_CLIPS.split(',')) : null;
  const order = [...catalog.clips].sort((a, b) => Number(a.layer === 'additive') - Number(b.layer === 'additive'));
  const done = new Map<string, Built & { seam: { rot: number; pos: number } }>();
  for (const clip of order) {
    const spec = specs.get(clip.name);
    if (!spec) { if (only) continue; throw new Error(`cat animation: no generator for catalogued clip ${clip.name}`); }
    if (only && !only.has(clip.name) && !(clip.name === 'cat.loco.idle' || clip.name === 'cat.rest.sit_idle')) continue;
    done.set(clip.name, buildClip(rig, catalog, clip, spec, done));
  }
  for (const name of specs.keys()) if (!catalog.clips.some(c => c.name === name)) throw new Error(`cat animation: ${name} is not in the catalog`);
  const built = catalog.clips.map(c => done.get(c.name)).filter(b => b !== undefined);
  const summary = validate(rig, only ? { ...catalog, clips: built.map(b => b.clip) } : catalog, built);
  const glb = await writeAnimations(rig, built, OUT_GLB);
  writeFileSync(`${OUT_GLB}.prov.yaml`, sidecar('cat_anims.glb: 65-joint skeleton and one bone-track animation per catalogued clip'));
  console.log(`${OUT_GLB}: ${built.length} clips, ${glb.keys} keys, ${glb.bytes} bytes, validator 0 errors; ` +
    `max planted slip ${(summary.maxSlip * 1000).toFixed(2)} mm (${summary.maxSlipClip}), max loop seam ${(summary.maxSeam * 180 / Math.PI).toFixed(3)}°`);
  return { summary, glb };
}

export const sidecar = (what: string) => `source: art/cats/anim/generate.ts
tool: original procedural keyframe generator (TypeScript, three.js math, glTF Transform, meshoptimizer)
date: '2026-10-16'
license: original
author_role: artist
notes: >-
  ${what}. Motion follows published descriptions of feline gait and behaviour
  (footfall order, duty factors, gait speeds, postures); no filmed or third-party
  footage was used.
`;

if (process.argv[1]?.endsWith('generate.ts')) await makeCatAnims();
