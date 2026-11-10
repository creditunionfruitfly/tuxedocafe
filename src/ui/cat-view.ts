import type { EventBus } from '../core/events.ts';

/** Composited eyelids above the canvas and an exit that remains available in the dark. */
export function mountCatView(bus: EventBus): (closed: number, sleeping: boolean) => void {
  const lids = document.querySelector<HTMLElement>('#cat-eyelids')!;
  const exit = document.querySelector<HTMLButtonElement>('#cat-view-exit')!;
  const status = document.querySelector<HTMLElement>('#cat-view-status')!;
  const close = (): void => bus.emit('cat-view:exit', undefined);
  let name = '', lastClosed = -1, wasSleeping = false;
  bus.on('cat-view', value => {
    name = value?.name ?? '';
    if (value) document.body.dataset.catView = value.id; else delete document.body.dataset.catView;
    lids.hidden = exit.hidden = status.hidden = !value;
    lastClosed = -1; wasSleeping = false;
    if (value) { status.textContent = `Through ${name}’s eyes`; exit.focus({ preventScroll: true }); }
  });
  exit.onclick = close;
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || exit.hidden) return;
    event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) close();
  }, true);
  return (closed, sleeping) => {
    if (closed !== lastClosed) { lids.style.setProperty('--closed', String(closed)); lastClosed = closed; }
    if (sleeping !== wasSleeping) { status.textContent = sleeping ? `${name} is asleep` : `Through ${name}’s eyes`; wasSleeping = sleeping; }
  };
}
