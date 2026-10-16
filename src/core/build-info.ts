/**
 * The build stamp written to `version.json` at build time and baked into the
 * bundle as `virtual:build-info` (see tools/engine/vite-build-info.ts).
 */
export interface BuildInfo {
  /** `git describe --tags --always --dirty`, e.g. `v0.0.0-12-gabc1234`. */
  readonly version: string;
  /** Full commit hash from `git rev-parse HEAD`. */
  readonly commit: string;
  /** `main`, `m<n>` for a milestone snapshot, `pr` in CI, or `dev`. */
  readonly channel: string;
  /** ISO 8601 build time. */
  readonly builtAt: string;
  /** Ids of every flag defined in data/flags.json when the build ran. */
  readonly flags: readonly string[];
}

/** The short line shown in the corner and, later, in Settings → About. */
export function formatStamp(info: BuildInfo): string {
  return `${info.version} · ${info.channel}`;
}

/** Reads an unknown JSON value as a BuildInfo, or returns null if it isn't one. */
export function parseBuildInfo(value: unknown): BuildInfo | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const isString = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
  if (!isString(v.version) || !isString(v.commit) || !isString(v.channel) || !isString(v.builtAt)) {
    return null;
  }
  const flags = Array.isArray(v.flags) ? v.flags.filter(isString) : [];
  return { version: v.version, commit: v.commit, channel: v.channel, builtAt: v.builtAt, flags };
}

/** True when the live `version.json` describes a different build of the same channel. */
export function isNewerBuild(current: BuildInfo, live: BuildInfo | null): boolean {
  return live !== null && live.channel === current.channel && live.commit !== current.commit;
}
