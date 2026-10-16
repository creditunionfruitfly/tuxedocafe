import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import type { BuildInfo } from '../../src/core/build-info.ts';

const VIRTUAL_ID = 'virtual:build-info';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

function git(args: string[]): string | undefined {
  try {
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function flagIds(path = 'data/flags.json'): string[] {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { flags?: { id?: unknown }[] };
    return (data.flags ?? []).map((flag) => flag.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/**
 * The build stamp. `--tags --always` works before the first tag; the commit
 * comes from `git rev-parse HEAD`, not GITHUB_SHA, which stays at main's tip
 * during a rollback (README, Playtest builds and CI/CD).
 */
export function readBuildInfo(channel: string): BuildInfo {
  return {
    version: git(['describe', '--tags', '--always', '--dirty']) ?? 'unknown',
    commit: git(['rev-parse', 'HEAD']) ?? 'unknown',
    channel,
    builtAt: new Date().toISOString(),
    flags: flagIds(),
  };
}

/** Emits version.json, serves it in dev, and exposes it as `virtual:build-info`. */
export function buildInfo(options: { base: string; channel: string }): Plugin {
  const info = readBuildInfo(options.channel);
  const json = `${JSON.stringify(info, null, 2)}\n`;
  return {
    name: 'tuxedo:build-info',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      return id === RESOLVED_ID ? `export default ${JSON.stringify(info)};` : undefined;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path === `${options.base}version.json` || path === '/version.json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(json);
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: json });
    },
  };
}
