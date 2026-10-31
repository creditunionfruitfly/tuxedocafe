import type { EventBus } from '../core/events.ts';
import type { RadialItem } from '../interaction/closeup.ts';

/** A round, see-through Frutiger Aero menu beside the close-up cat (mirrored for left hands); hold items report press and release (or toggle in hold-toggle mode). */
export function mountRadialMenu(bus: EventBus, toggle: () => boolean): { readonly open: boolean; select(index: number): void } {
  const element = document.querySelector<HTMLElement>('#radial-menu')!;
  let items: readonly RadialItem[] = [], held = '';
  const release = (): void => { if (held) bus.emit('radial:hold', { id: held, down: false }); held = ''; };
  const press = (item: RadialItem): void => {
    if (item.disabled) { bus.emit('notice', { text: `${item.label} is coming in a later update.` }); return; }
    if (!item.hold) { release(); bus.emit('radial:select', { id: item.id }); return; }
    const was = held; release();
    if (!toggle() || was !== item.id) { held = item.id; bus.emit('radial:hold', { id: item.id, down: true }); }
  };
  bus.on('radial', value => {
    release(); element.replaceChildren(); element.hidden = !value; items = value?.items ?? [];
    if (!value) return;
    const title = document.createElement('strong'); title.textContent = value.title; element.append(title);
    items.forEach((item, index) => {
      const button = document.createElement('button'), angle = -Math.PI / 2 + index * 2 * Math.PI / items.length;
      button.type = 'button'; button.textContent = item.label; button.disabled = false; button.dataset.id = item.id;
      if (item.disabled) button.classList.add('soon');
      button.style.setProperty('--x', `${Math.cos(angle)}`); button.style.setProperty('--y', `${Math.sin(angle)}`);
      button.title = `${index + 1}`;
      button.onpointerdown = event => { event.stopPropagation(); press(item); };
      button.onpointerup = button.onpointerleave = button.onpointercancel = () => { if (!toggle() && held === item.id) release(); };
      button.onclick = event => { if (event.detail === 0) press(item); };
      element.append(button);
    });
  });
  return { get open() { return !element.hidden; }, select(index) { const item = items[index]; if (item) press(item); } };
}
