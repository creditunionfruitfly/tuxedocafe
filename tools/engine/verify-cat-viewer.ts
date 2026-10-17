/** Prove a standalone export boots from file:// and exercises the production UI without network. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const file = resolve(process.argv[2] ?? 'cat-viewer.html'), output = resolve(process.argv[3] ?? 'test-results/offline-viewer'); mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }), errors: string[] = [], network: string[] = [], residents = [];
try {
  page.on('pageerror', error => errors.push(String(error))); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.goto(pathToFileURL(file).href); await page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 90_000 });
  assert.equal(await page.locator('body').getAttribute('data-cat-source'), 'master'); assert.equal(await page.locator('#cat-clips button').count(), 67);
  assert.equal(await page.locator('body').getAttribute('data-stand-ins'), '0');
  const ids = await page.locator('#cat-resident option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)); assert.equal(ids.length, 8);
  for (const id of ids) {
    await page.locator('#cat-resident').selectOption(id); await page.waitForFunction(expected => document.body.dataset.surfaceResident === expected, id); await page.locator('#cat-clips [data-clip="cat.rest.sit_idle"]').click(); await page.locator('#cat-play').click();
    await page.locator('#cat-time').evaluate(element => { (element as HTMLInputElement).value = '.75'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.screenshot({ path: resolve(output, `${id}.png`) });
    residents.push({ id, source: await page.locator('body').getAttribute('data-cat-source'), bones: await page.locator('body').getAttribute('data-bones'), draws: await page.locator('body').getAttribute('data-draw-calls') });
  }
  await page.locator('#cat-clips [data-clip="cat.loco.walk"]').click(); await page.locator('#cat-ground').selectOption('step'); await page.locator('#cat-skeleton').check(); await page.locator('#cat-wireframe').check(); await page.locator('#cat-clay').check();
  await page.locator('#cat-play').click(); await page.locator('#cat-time').evaluate(element => { (element as HTMLInputElement).value = '.5'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.body.dataset.animationTime === '0.5000'); await page.screenshot({ path: resolve(output, 'walk-step-ik.png') });
  await page.locator('#cat-ground').selectOption('slope'); await page.locator('#cat-look').check(); await page.locator('#cat-ik').uncheck(); await page.screenshot({ path: resolve(output, 'slope-look.png') });
  await page.locator('#cat-files').setInputFiles(['cat_master_lod0.glb', 'cat_master_lod1.glb', 'cat_master_lod2.glb', 'cat_anims.glb', 'cat_expressions.json'].map(name => resolve('public/assets/art/cats', name)));
  await page.waitForFunction(() => document.body.dataset.importStatus === 'loaded', undefined, { timeout: 90_000 });
  assert.match(await page.locator('#cat-import-status').innerText(), /0 stand-ins/);
  assert.equal(await page.locator('body').getAttribute('data-bones'), '65');
  const bad = resolve(output, 'invalid.glb'); writeFileSync(bad, 'not a GLB');
  await page.locator('#cat-files').setInputFiles(bad);
  await page.waitForFunction(() => document.body.dataset.importStatus === 'error');
  assert.match(await page.locator('#cat-import-status').innerText(), /Could not load/);
  await page.locator('#cat-resident').selectOption(ids[0]!);
  await page.waitForFunction(expected => document.body.dataset.surfaceResident === expected, ids[0]);
  assert.equal(await page.locator('body').getAttribute('data-stand-ins'), '0');
  await page.locator('#cat-files').setInputFiles(resolve('public/assets/art/cats/cat_expressions.json'));
  await page.waitForFunction(() => document.body.dataset.importStatus === 'loaded');
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify({ expressions: [{ name: 'blink', durationS: .2, curves: { blink_L: [[0, 0], [.1, 1], [.2, 0]] } }] })], 'cat_expressions.json', { type: 'application/json' }));
    document.querySelector('#cat-viewer')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.waitForFunction(() => document.body.dataset.importStatus === 'loaded');
  await page.locator('#cat-clips [data-clip="cat.rest.sit_idle"]').click();
  await page.screenshot({ path: resolve(output, 'reloaded-after-invalid.png') });
  assert.deepEqual(errors, []); assert.deepEqual(network, []);
  const report = { file, source: 'master', clips: 67, residents, errors, network, controls: ['resident', 'clip', 'pause', 'scrub', 'step', 'slope', 'skeleton', 'wireframe', 'clay', 'look', 'IK', 'local file picker', 'drag and drop', 'bad-file recovery'] };
  writeFileSync(resolve(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
