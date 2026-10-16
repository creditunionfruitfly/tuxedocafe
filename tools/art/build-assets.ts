// npm run assets: art/ → public/assets/art/ (Blender export, gltf-transform, KTX2, glTF-Validator).
// Stub from task M0-1. The Artist replaces it once the first .blend source lands (tasks M0-3, M1-5).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sources(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (name.endsWith('.blend')) found.push(path);
  }
  return found;
}

const blends = sources('art');
if (blends.length === 0) {
  console.log('No .blend sources under art/ yet, so there is nothing to build.');
} else {
  console.error(`Found ${blends.length} .blend source(s), but the art pipeline isn't built yet. See docs/tasks/M1-5-cafe-blockout.md.`);
  process.exit(1);
}
