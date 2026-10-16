export function installKeys(action: (index: number) => void): { keys: Set<string>; dispose(): void } {
  const keys = new Set<string>();
  const down = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement).matches('input,select,textarea,button')) return;
    const key = event.key.toLowerCase(); if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','1','2','3','4'].includes(key)) event.preventDefault();
    keys.add(key); if (/^[1-4]$/.test(key) && !event.repeat) action(Number(key) - 1);
  };
  const up = (event: KeyboardEvent): void => { keys.delete(event.key.toLowerCase()); };
  const clear = (): void => keys.clear(); window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear); document.addEventListener('visibilitychange', clear);
  return { keys, dispose() { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); } };
}
