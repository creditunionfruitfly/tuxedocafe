import { execFileSync } from 'node:child_process';
import { makePlaceholderCat } from './make-placeholder-cat.ts';
import { makeCafe } from '../../art/env/cafe/generate.ts';
import { makeHand } from '../../art/hand/generate.ts';
import { makeCatTextures } from '../../art/cats/textures/generate.ts';

await makePlaceholderCat();
await makeCafe();
await makeHand();
// The Artist's hashed checkpoint is the current cat canon: master LODs, clips and resident maps.
execFileSync(process.execPath, ['tools/art/restore-cat-archive.ts', 'art/cats/checkpoints/latest/manifest.json'], { stdio: 'inherit' });
await makeCatTextures();
