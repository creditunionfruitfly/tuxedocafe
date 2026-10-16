import type { BuildInfo } from './build-info.ts';
import { isNewerBuild, parseBuildInfo } from './build-info.ts';
import { siteUrl } from './assets.ts';
export function mayReload(previous: string | null, commit: string): boolean { return previous !== commit; }
export function watchUpdates(info: BuildInfo, save: () => Promise<void>, notice: (reload: () => void) => void): () => void {
  const check = async (): Promise<void> => {
    try {
      const response = await fetch(siteUrl('version.json'), { cache: 'no-store' });
      const live = parseBuildInfo(await response.json());
      document.body.dataset.liveVersion = live ? (isNewerBuild(info, live) ? 'newer' : 'ok') : 'invalid';
      if (isNewerBuild(info, live)) notice(() => { void save().then(() => location.reload()); });
    } catch { document.body.dataset.liveVersion = 'unreachable'; }
  };
  const recover = (): void => {
    try {
      const key = `tuxedocafe:${info.channel}:reloaded`;
      if (!mayReload(sessionStorage.getItem(key), info.commit)) return;
      sessionStorage.setItem(key, info.commit); void save().then(() => location.reload());
    } catch { /* Recovery must never become a reload loop. */ }
  };
  window.addEventListener('vite:preloadError', recover); window.addEventListener('cafe:asset-error', recover);
  const interval = window.setInterval(() => { void check(); }, 300_000); void check();
  return () => { clearInterval(interval); window.removeEventListener('vite:preloadError', recover); window.removeEventListener('cafe:asset-error', recover); };
}
