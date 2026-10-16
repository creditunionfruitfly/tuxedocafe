export function installOrientation(pause: (paused: boolean) => void): () => void {
  const overlay = document.querySelector<HTMLElement>('#rotate');
  const update = (): void => {
    const portrait = innerHeight > innerWidth; if (overlay) overlay.hidden = !portrait;
    pause(portrait || document.hidden);
  };
  const fullscreen = (): void => {
    if (!matchMedia('(pointer: coarse)').matches) return;
    void (async () => {
      try {
        await document.documentElement.requestFullscreen?.();
        await (screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> }).lock?.('landscape');
      } catch { /* The rotate overlay handles browsers without orientation lock. */ }
    })();
  };
  window.addEventListener('resize', update); document.addEventListener('visibilitychange', update);
  document.addEventListener('pointerdown', fullscreen, { once: true }); update();
  return () => { window.removeEventListener('resize', update); document.removeEventListener('visibilitychange', update); document.removeEventListener('pointerdown', fullscreen); };
}
