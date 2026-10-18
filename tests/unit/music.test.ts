import { expect, it, vi } from 'vitest';
import music from '../../audio/music.json' with { type: 'json' };

vi.mock('spessasynth_lib/dist/spessasynth_processor.min.js?url', () => ({ default: 'processor.js' }));
vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
const { Jukebox } = await import('../../src/audio/music.ts');

it('cycles the style-guide cues and drives the engine without loading it before a gesture', async () => {
  const engine = { play: vi.fn(), pause: vi.fn(), volume: vi.fn() }, load = vi.fn(async () => engine);
  const jukebox = new Jukebox(.6, load);
  expect(load).not.toHaveBeenCalled(); expect(jukebox.track.title).toBe('Morning Light');
  await jukebox.toggle(); expect(jukebox.playing).toBe(true); expect(engine.play).toHaveBeenCalledTimes(1); expect(engine.volume).toHaveBeenCalledWith(.6);
  await jukebox.next(); expect(jukebox.track.id).toBe('day');
  await jukebox.previous(); await jukebox.previous(); expect(jukebox.track.id).toBe(music.tracks.at(-1)?.id);
  await jukebox.toggle(); expect(engine.pause).toHaveBeenCalled(); expect(jukebox.playing).toBe(false);
  await jukebox.setVolume(2); expect(engine.volume).toHaveBeenLastCalledWith(1);
  expect(load).toHaveBeenCalledTimes(1);
});
it('keeps every cue inside the style guide tempo range and on neighbouring keys', () => {
  for (const track of music.tracks) { expect(track.bpm).toBeGreaterThanOrEqual(68); expect(track.bpm).toBeLessThanOrEqual(100); expect([53, 55, 60, 62]).toContain(track.key); }
});
