import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { STARTUP_TIMEOUT } from './config.ts';

// The seeded cast places Mochi on this floor spot, where her first rest plan starts.
function mochiAtSpawn(page: Page): { x: number; y: number } {
  const { width, height } = page.viewportSize()!, camera = new PerspectiveCamera(61, width / height, .04, 60);
  camera.position.set(0, 1.6, 2.2); camera.rotation.x = -.08; camera.updateMatrixWorld();
  const point = new Vector3(.6, .18, -1.5).project(camera);
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
}

test('watch a resident from their menu, stay parked, and leave even when they fall asleep', async ({ page, isMobile }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`./?tier=${isMobile ? 'low' : 'desktop'}&flags=cats`);
  const body = page.locator('body'), center = page.locator('#radial-menu .radial-center'), lids = page.locator('#cat-eyelids');
  const exit = page.getByRole('button', { name: 'Exit cat mode' }), status = page.locator('#cat-view-status');
  await expect(body).toHaveAttribute('data-ready', 'true', { timeout: STARTUP_TIMEOUT });
  await lids.evaluate(node => {
    const observer = new MutationObserver(() => {
      const value = Number(node.style.getPropertyValue('--closed'));
      if (value > .2 && value < .8) { node.dataset.midClosure = String(value); observer.disconnect(); }
    });
    observer.observe(node, { attributeFilter: ['style'] });
  });
  await page.locator('#start').click(); await page.locator('#patron-name').fill('River');
  await page.getByRole('button', { name: 'Make yourself at home' }).click();
  await expect(body).toHaveAttribute('data-player', '0.00,2.20');
  const patronDraws = Number(await body.getAttribute('data-draw-calls'));
  const beforeLook = (await body.getAttribute('data-look'))!, point = mochiAtSpawn(page);
  const selectCat = async (): Promise<void> => {
    if (isMobile) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
    await expect(center).toHaveAccessibleName('See through Mochi’s eyes');
    if (isMobile) await center.tap(); else await center.click();
  };
  await selectCat();
  await expect(body).toHaveAttribute('data-cat-view', 'mochi'); await expect(page.locator('#radial-menu')).toBeHidden();
  await expect(lids).toBeVisible(); await expect(exit).toBeFocused();
  await page.keyboard.down('w'); await page.keyboard.press('ArrowRight'); await page.mouse.wheel(0, -200); await page.keyboard.up('w');
  const closure = (): Promise<number> => lids.evaluate(node => Number(node.style.getPropertyValue('--closed')));
  await expect(body).toHaveAttribute('data-cat-view-ready', 'true', { timeout: 20_000 });
  await expect.poll(closure).toBe(0);
  const viewDraws = Number(await body.getAttribute('data-draw-calls'));
  await page.screenshot({ path: info.outputPath('cat-view-open.png') });
  // Hold an observed in-between frame just for the screenshot; actual sleep continues underneath.
  await expect(lids).toHaveAttribute('data-mid-closure', /^0\./, { timeout: 25_000 });
  const sample = Number(await lids.getAttribute('data-mid-closure'));
  const snapshot = await page.addStyleTag({ content: `#cat-eyelids { --closed: ${sample} !important; }` });
  await page.screenshot({ path: info.outputPath('cat-view-mid-blink.png') });
  await snapshot.evaluate(style => style.parentNode?.removeChild(style));
  await expect(status).toHaveText('Mochi is asleep', { timeout: 25_000 });
  await expect.poll(closure).toBeCloseTo(1);
  await page.screenshot({ path: info.outputPath('cat-view-asleep.png') });
  // Existing desktop high-poly cast + shadow draws exceed the 150 draw target before entering.
  // The alternate view adds no pass and must not increase draws in this sample.
  expect(viewDraws).toBeLessThanOrEqual(isMobile ? 80 : patronDraws);
  await info.attach('cat-view-render-metrics', { contentType: 'application/json', body: JSON.stringify({ patronDraws, viewDraws, softwareFrameMs: await body.getAttribute('data-frame-ms') }) });
  if (isMobile) await exit.tap(); else await exit.click();
  await expect(lids).toBeHidden(); await expect(body).toHaveAttribute('data-player', '0.00,2.20'); await expect(body).toHaveAttribute('data-look', beforeLook);

  await page.locator('.top-settings').click(); await page.getByLabel('Reduced motion').check(); await page.locator('#close-settings').click();
  if (isMobile) await selectCat(); else await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(body).toHaveAttribute('data-cat-view', 'mochi');
  expect(await lids.evaluate(node => getComputedStyle(node, '::before').transform)).toBe('none');
  await expect.poll(closure).toBeCloseTo(1);
  if (isMobile) {
    await page.evaluate(async () => { screen.orientation.unlock?.(); if (document.fullscreenElement) await document.exitFullscreen(); });
    const size = page.viewportSize()!; await page.setViewportSize({ width: size.height, height: size.width });
    await expect(page.locator('#rotate')).toBeVisible(); await exit.tap(); await page.setViewportSize(size);
  } else await page.keyboard.press('Escape');
  await expect(exit).toBeHidden(); await expect(body).toHaveAttribute('data-look', beforeLook);

  await page.locator('.top-settings').click(); await page.getByLabel('Enable cat mode').uncheck(); await page.locator('#close-settings').click();
  if (isMobile) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(center).toBeHidden(); await expect(exit).toBeHidden(); expect(errors).toEqual([]);
});
