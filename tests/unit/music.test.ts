import { expect, it, vi } from 'vitest';
import music from '../../audio/music.json' with { type: 'json' };
import { AudioMixer } from '../../src/audio/mixer.ts';

vi.mock('spessasynth_lib/dist/spessasynth_processor.min.js?url', () => ({ default: 'processor.js' }));
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
const { Jukebox } = await import('../../src/audio/music.ts');

it('cycles the style-guide cues and drives the engine without loading it before a gesture', async () => {
  const engine = { play: vi.fn(), pause: vi.fn(), volume: vi.fn(), soundfont: vi.fn(async () => {}) }, load = vi.fn(async () => engine);
  const jukebox = new Jukebox(.6, new AudioMixer(.85), load);
  expect(load).not.toHaveBeenCalled(); expect(jukebox.track.title).toBe('Morning Light');
  await jukebox.toggle(); expect(jukebox.playing).toBe(true); expect(engine.play).toHaveBeenCalledTimes(1); expect(engine.volume).toHaveBeenCalledWith(.6, jukebox.track.gainDb);
  await jukebox.next(); expect(jukebox.track.id).toBe('day');
  await jukebox.previous(); await jukebox.previous(); expect(jukebox.track.id).toBe(music.tracks.at(-1)?.id);
  await jukebox.toggle(); expect(engine.pause).toHaveBeenCalled(); expect(jukebox.playing).toBe(false);
  await jukebox.setVolume(2); expect(engine.volume).toHaveBeenLastCalledWith(1, jukebox.track.gainDb);
  expect(load).toHaveBeenCalledTimes(1);
});
it('appends Cafe Garage and Cat Lounge after Late Night Jazz', () => {
  const lateNight = music.tracks.findIndex((track) => track.id === 'late_night_jazz');
  expect(lateNight).toBeGreaterThanOrEqual(0);
  expect(music.tracks.slice(lateNight + 1, lateNight + 3).map((track) => track.id)).toEqual(['cafe_garage', 'cat_lounge']);
});
it('keeps each arrangement tempo range and neighbouring keys', () => {
  const ranges: Record<string, number[]> = { uk_garage: [128, 132], liquid_dnb: [168, 176] };
  for (const track of music.tracks) {
    const range = ranges[track.arrangement ?? ''] ?? [68, 100];
    expect(track.bpm).toBeGreaterThanOrEqual(range[0]!);
    expect(track.bpm).toBeLessThanOrEqual(range[1]!);
    if (track.arrangement === 'uk_garage') expect(track.id).toBe('cafe_garage');
    expect([53, 55, 60, 62]).toContain(track.key);
  }
});

it('selects C64 lazily, switches back while paused, and preserves the volume', async () => {
  const engine = { play: vi.fn(), pause: vi.fn(), volume: vi.fn(), soundfont: vi.fn(async () => {}) };
  const load = vi.fn(async () => engine);
  const jukebox = new Jukebox(.7, new AudioMixer(1), load);
  await jukebox.setSoundfont('c64');
  expect(load).not.toHaveBeenCalled();
  await jukebox.play();
  expect(load).toHaveBeenCalledWith('c64');
  expect(engine.volume).toHaveBeenLastCalledWith(.7, jukebox.track.c64GainDb);
  await jukebox.toggle();
  await jukebox.setSoundfont('aero');
  expect(jukebox.playing).toBe(false);
  expect(engine.play).toHaveBeenCalledTimes(1);
  expect(engine.soundfont).toHaveBeenLastCalledWith('aero');
  expect(engine.volume).toHaveBeenLastCalledWith(.7, jukebox.track.gainDb);
});

it('recovers from a failed bank load and serializes rapid changes', async () => {
  const engine = { play: vi.fn(), pause: vi.fn(), volume: vi.fn(), soundfont: vi.fn(async () => {}) };
  const jukebox = new Jukebox(1, new AudioMixer(1), async () => engine);
  await jukebox.play();
  engine.soundfont.mockRejectedValueOnce(new Error('download failed'));
  await expect(jukebox.setSoundfont('c64')).rejects.toThrow('download failed');
  expect(jukebox.soundfont).toBe('aero');
  await jukebox.setSoundfont('c64');
  await Promise.all([jukebox.setSoundfont('aero'), jukebox.setSoundfont('c64'), jukebox.setSoundfont('aero')]);
  expect(jukebox.soundfont).toBe('aero');
  expect(engine.soundfont).toHaveBeenLastCalledWith('aero');
});

it('does not start playback when paused during initialization', async () => {
  const engine = { play: vi.fn(), pause: vi.fn(), volume: vi.fn(), soundfont: vi.fn(async () => {}) };
  let resolveLoading!: (value: typeof engine) => void;
  const loading = new Promise<typeof engine>(resolve => { resolveLoading = resolve; });
  const jukebox = new Jukebox(1, new AudioMixer(1), () => loading);
  const play = jukebox.play();
  await Promise.resolve();
  const pause = jukebox.toggle();
  resolveLoading(engine);
  await Promise.all([play, pause]);
  expect(jukebox.playing).toBe(false);
  expect(engine.play).not.toHaveBeenCalled();
});
