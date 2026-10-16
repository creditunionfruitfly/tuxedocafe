// Builds the Pages site: dist/ at the root, plus the newest snapshot of each
// milestone (its latest v0.<n>.x release) at m<n>/, and builds.json listing them.
// A snapshot that fails to download fails the deploy rather than vanish from it.
//
// Usage: node .github/scripts/assemble-site.mjs <dist> <out> [--no-snapshots]
// Needs the GitHub CLI with GH_TOKEN set, unless --no-snapshots is given.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dist, out, ...options] = process.argv.slice(2);

const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** The newest v0.<n>.<patch> tag for each milestone n, in milestone order. */
export function newestSnapshotTags(tagNames) {
  const newest = new Map();
  for (const tag of tagNames) {
    const match = /^v0\.(\d+)\.(\d+)$/.exec(tag);
    if (!match) continue;
    const milestone = Number(match[1]);
    const patch = Number(match[2]);
    const current = newest.get(milestone);
    if (!current || patch > current.patch) newest.set(milestone, { tag, patch });
  }
  return [...newest].sort(([a], [b]) => a - b).map(([milestone, { tag }]) => ({ milestone, tag }));
}

function main() {
  if (!dist || !out) {
    console.error('Usage: node .github/scripts/assemble-site.mjs <dist> <out> [--no-snapshots]');
    process.exit(2);
  }
  rmSync(out, { recursive: true, force: true });
  cpSync(dist, out, { recursive: true });
  const builds = [{ path: './', ...readJson(join(dist, 'version.json')) }];

  if (!options.includes('--no-snapshots')) {
    const releases = JSON.parse(run('gh', ['release', 'list', '--limit', '1000', '--exclude-drafts', '--json', 'tagName']));
    for (const { milestone, tag } of newestSnapshotTags(releases.map((release) => release.tagName))) {
      const zip = `site-m${milestone}.zip`;
      const downloads = mkdtempSync(join(tmpdir(), `m${milestone}-`));
      run('gh', ['release', 'download', tag, '--pattern', zip, '--dir', downloads]);
      const target = join(out, `m${milestone}`);
      mkdirSync(target, { recursive: true });
      run('unzip', ['-q', join(downloads, zip), '-d', target]);
      const info = readJson(join(target, 'version.json'));
      if (info.channel !== `m${milestone}`) {
        throw new Error(`${zip} from ${tag} was built for channel "${info.channel}", not "m${milestone}".`);
      }
      builds.push({ path: `m${milestone}/`, tag, ...info });
    }
  }

  writeFileSync(join(out, 'builds.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), builds }, null, 2)}\n`);
  console.log(`Assembled ${out}: ${builds.map((build) => build.path).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
