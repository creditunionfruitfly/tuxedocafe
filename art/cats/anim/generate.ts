// Entry point run by `npm run assets`: builds every catalogued clip on the
// shared skeleton, validates the library and writes cat_anims.glb plus
// cat_expressions.json (and their provenance sidecars).
//   CAT_CLIPS=a,b   build only these clips (plus their additive references); development only
//   CAT_SKELETON=…  build against another skeleton file (same names and order)
//   CAT_NOFAIL=1    report validation problems without failing; development only
//   CAT_OUT_DIR=…   write the outputs elsewhere; development only
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type BuiltClip, buildClip } from './build.ts';
import { type ClipSpec, loadCatalog } from './catalog.ts';
import { writeAnimations } from './export.ts';
import { inspectExport } from './inspect-export.ts';
import { makeExpressions } from './expressions.ts';
import { loadRig } from './rig.ts';
import { validate } from './validate.ts';
import { locoClips } from './clips/loco.ts';
import { restClips } from './clips/rest.ts';
import { careClips } from './clips/care.ts';
import { moveClips } from './clips/move.ts';
import { playClips } from './clips/play.ts';
import { layerClips } from './clips/layers.ts';
import { perkClips } from './clips/perks.ts';

// CAT_OUT_DIR redirects the outputs (development previews against another skeleton); the build uses the default.
const OUT_DIR = process.env.CAT_OUT_DIR ?? 'public/assets/art/cats';
export const OUT_GLB = `${OUT_DIR}/cat_anims.glb`;
export const OUT_EXPRESSIONS = `${OUT_DIR}/cat_expressions.json`;

export const allSpecs: ClipSpec[] = [...locoClips, ...restClips, ...careClips, ...moveClips, ...playClips, ...layerClips, ...perkClips];

export async function makeCatAnims() {
  const rig = loadRig(), catalog = loadCatalog();
  const specs = new Map(allSpecs.map(s => [s.name, s]));
  if (specs.size !== allSpecs.length) throw new Error('cat animation: duplicate clip generators');
  for (const name of specs.keys()) if (!catalog.clips.some(c => c.name === name)) throw new Error(`cat animation: ${name} is not in the catalog`);
  const only = process.env.CAT_CLIPS ? new Set(process.env.CAT_CLIPS.split(',')) : null;
  const needed = new Set<string>();
  if (only) for (const name of only) {
    needed.add(name);
    const ref = specs.get(name)?.additive?.reference.split('@')[0];
    if (ref) needed.add(ref);
  }
  // Full-body clips first: additive clips reference their frames.
  const order = [...catalog.clips].sort((a, b) => Number(a.layer === 'additive') - Number(b.layer === 'additive'));
  const done = new Map<string, BuiltClip>();
  for (const clip of order) {
    const spec = specs.get(clip.name);
    if (!spec) throw new Error(`cat animation: no generator for catalogued clip ${clip.name}`);
    if (only && !needed.has(clip.name)) continue;
    done.set(clip.name, buildClip(rig, catalog, clip, spec, done));
  }
  const built = catalog.clips.map(c => done.get(c.name)).filter(b => b !== undefined);
  const summary = validate(rig, only ? { ...catalog, clips: built.map(b => b.clip) } : catalog, built);
  if (process.env.CAT_REPORT) writeFileSync(process.env.CAT_REPORT, `${JSON.stringify({ summary, clips: built.map(b => ({ name: b.clip.name, frames: b.frames.length, seam: b.seam, ...b.extras })) }, null, 2)}\n`);
  const glb = await writeAnimations(rig, built, OUT_GLB);
  writeFileSync(`${OUT_GLB}.prov.yaml`, sidecar('cat_anims.glb: the 65-joint shared skeleton (rest pose from art/rig/skeleton.json) and one bone-track animation per catalogued clip'));
  const expressions = makeExpressions(catalog);
  mkdirSync(dirname(OUT_EXPRESSIONS), { recursive: true });
  writeFileSync(OUT_EXPRESSIONS, `${JSON.stringify(expressions)}\n`);
  writeFileSync(`${OUT_EXPRESSIONS}.prov.yaml`, sidecar('cat_expressions.json: morph-weight curves for every catalogued expression and for clips that list morphs'));
  const exported = await inspectExport(OUT_GLB);
  if (exported.failures.length) throw new Error(`Compressed cat animation audit failed:\n  - ${exported.failures.join('\n  - ')}`);
  console.log(`${OUT_GLB}: ${built.length} clips, ${glb.keys} keys, ${glb.bytes} bytes, validator 0 errors; ` +
    `max planted slip ${(summary.maxSlip * 1000).toFixed(2)} mm (${summary.maxSlipClip}), max loop seam ${(summary.maxSeam * 180 / Math.PI).toFixed(3)}°, ` +
    `min swing lift ${(summary.minSwingLift * 1000).toFixed(1)} mm`);
  const fitted = built.filter(b => typeof b.extras.strideFit === 'number' && (b.extras.strideFit as number) < 1);
  for (const b of fitted) {
    const fit = b.extras.strideFit as number, rigSpeed = b.extras.rigSpeed as number;
    const target = b.clip.authoredSpeed ?? Math.round(rigSpeed / fit * 1000) / 1000;
    console.warn(`${b.clip.name}: this skeleton reaches ${(fit * 100).toFixed(0)}% of the designed stride; planted paws slide at rigSpeed ${rigSpeed} m/s instead of ${target} m/s`);
  }
  return { summary, glb, built };
}

export const sidecar = (what: string) => `source: art/cats/anim/generate.ts
tool: original procedural keyframe generator (TypeScript, three.js math, glTF Transform, meshoptimizer)
date: '2026-10-17'
license: original
author_role: artist
notes: >-
  ${what}. Motion is authored procedurally from published descriptions of
  feline gait and behaviour (footfall order, duty factors, gait speeds, joint
  ranges, postures); there was no filmed reference footage and no third-party
  footage, motion capture or animation data was used. Exact phase timings,
  joint envelopes and anticipation/follow-through are original author choices,
  constrained for this rig rather than digitized measurements from those papers.
references:
  - https://www.mdpi.com/2813-9372/1/3/21
  - https://pubmed.ncbi.nlm.nih.gov/21071630/
  - https://news.mit.edu/2010/cat-lapping-1112
  - https://www.nature.com/articles/s41598-020-73426-0
  - https://pmc.ncbi.nlm.nih.gov/articles/PMC4137248/
  - https://onlinelibrary.wiley.com/doi/10.1002/jmor.1051410102
`;

if (process.argv[1]?.endsWith('generate.ts')) await makeCatAnims();
