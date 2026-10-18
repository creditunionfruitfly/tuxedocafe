import type { Jukebox } from '../audio/music.ts';

/** A small glass pill under Settings: previous, play or pause, next, and the current cue's title. */
export function mountMusicPill(jukebox: Jukebox): void {
  const pill = document.querySelector<HTMLElement>('#music-pill')!, title = pill.querySelector<HTMLElement>('[data-title]')!, toggle = pill.querySelector<HTMLButtonElement>('[data-toggle]')!;
  const render = (): void => { title.textContent = jukebox.track.title; title.title = jukebox.track.mood; toggle.textContent = jukebox.playing ? '❚❚' : '▶'; toggle.setAttribute('aria-label', jukebox.playing ? 'Pause music' : 'Play music'); };
  const run = (action: () => Promise<void>): void => { const done = action(); render(); void done.catch(error => { jukebox.playing = false; render(); console.warn('Music could not start', error); }); };
  pill.querySelector<HTMLButtonElement>('[data-previous]')!.onclick = () => run(() => jukebox.previous());
  pill.querySelector<HTMLButtonElement>('[data-next]')!.onclick = () => run(() => jukebox.next());
  toggle.onclick = () => run(() => jukebox.toggle());
  pill.hidden = false; render();
}
