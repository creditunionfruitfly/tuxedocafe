import { makePlaceholderCat } from './make-placeholder-cat.ts';
import { makeCafe } from '../../art/env/cafe/generate.ts';
import { makeHand } from '../../art/hand/generate.ts';
import { makeCatAnims } from '../../art/cats/anim/generate.ts';

await makePlaceholderCat();
await makeCafe();
await makeHand();
await makeCatAnims();
