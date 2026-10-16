import { describe, expect, it } from 'vitest';
import { formatStamp, isNewerBuild, parseBuildInfo, type BuildInfo } from '../../src/core/build-info.ts';

const current: BuildInfo = {
  version: 'v0.0.0-3-gabc1234',
  commit: 'abc1234def',
  channel: 'main',
  builtAt: '2026-10-16T00:00:00.000Z',
  flags: [],
};

describe('build info', () => {
  it('formats the corner stamp', () => {
    expect(formatStamp(current)).toBe('v0.0.0-3-gabc1234 · main');
  });

  it('parses a version.json and rejects anything else', () => {
    expect(parseBuildInfo(JSON.parse(JSON.stringify(current)))).toEqual(current);
    expect(parseBuildInfo({ ...current, commit: '' })).toBeNull();
    expect(parseBuildInfo('nope')).toBeNull();
    expect(parseBuildInfo(null)).toBeNull();
  });

  it('keeps only string flags', () => {
    expect(parseBuildInfo({ ...current, flags: ['harness', 3, null] })?.flags).toEqual(['harness']);
  });

  it('spots a newer build on the same channel only', () => {
    expect(isNewerBuild(current, { ...current, commit: 'fff0000' })).toBe(true);
    expect(isNewerBuild(current, current)).toBe(false);
    expect(isNewerBuild(current, { ...current, channel: 'm3', commit: 'fff0000' })).toBe(false);
    expect(isNewerBuild(current, null)).toBe(false);
  });
});
