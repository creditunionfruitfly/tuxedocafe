// Fails when an asset under art/, audio/ or public/assets/ lacks a valid
// `<file>.prov.yaml` sidecar (AGENTS rule 8). Part of `npm run check`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import YAML from 'yaml';
import { ASSET_EXTENSIONS, checkSidecar } from './sidecar.ts';

const ROOTS = ['art', 'audio', 'public/assets'];
const SUFFIX = '.prov.yaml';

function walk(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}

const allowlist = YAML.parse(readFileSync('tools/provenance/allowlist.yaml', 'utf8')) as { licenses?: Record<string, string> };
const licenses = new Set(Object.keys(allowlist.licenses ?? {}));
const problems: string[] = [];
let assets = 0;

for (const file of ROOTS.flatMap((root) => walk(root))) {
  if (file.endsWith(SUFFIX)) {
    if (!existsSync(file.slice(0, -SUFFIX.length))) problems.push(`${file}: no asset next to this sidecar`);
    continue;
  }
  if (!ASSET_EXTENSIONS.has(extname(file).toLowerCase())) continue;
  assets++;
  const sidecar = `${file}${SUFFIX}`;
  if (!existsSync(sidecar)) {
    problems.push(`${file}: missing ${sidecar}`);
    continue;
  }
  for (const problem of checkSidecar(readFileSync(sidecar, 'utf8'), licenses)) problems.push(`${sidecar}: ${problem}`);
}

if (problems.length > 0) {
  console.error(`Provenance check failed:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  process.exit(1);
}
console.log(`Provenance OK: ${assets} asset${assets === 1 ? '' : 's'} checked against ${licenses.size} allowed licenses.`);
