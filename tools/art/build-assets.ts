import { makePlaceholderCat } from './make-placeholder-cat.ts';
import { makeCafe } from '../../art/env/cafe/generate.ts';
import { makeHand } from '../../art/hand/generate.ts';
import { makeMasterCat } from '../../art/cats/master/generate.ts';

await makePlaceholderCat();
await makeCafe();
await makeHand();
await makeMasterCat();
