/** Preview must already run. These are draw/download measurements on software WebGL, not phone frame timings. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.CAT_BENCH_URL ?? 'http://127.0.0.1:4173/tuxedocafe/';
const output = resolve(process.argv[2] ?? 'test-results/cat-benchmark'); mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const results = [];
try {
  for (const view of [
    { name: 'cafe-default-low', query: '?tier=low', phone: true, cafe: true },
    { name: 'cafe-residents-low', query: '?tier=low&flags=cats', phone: true, cafe: true },
    { name: 'studio-desktop', query: '?lookdev=cat&tier=desktop', phone: false, cafe: false },
    { name: 'studio-low', query: '?lookdev=cat&tier=low', phone: true, cafe: false },
  ]) {
    const context = await browser.newContext({ viewport: view.phone ? { width: 844, height: 390 } : { width: 1440, height: 960 }, deviceScaleFactor: 1, isMobile: view.phone, hasTouch: view.phone });
    const page = await context.newPage(), errors: string[] = [], files = new Map<string, number>(), transfers: Promise<void>[] = [];
    page.on('pageerror', error => errors.push(String(error))); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.url().startsWith(base)) transfers.push(response.body().then(bytes => { files.set(response.url().replace(base, ''), bytes.length); }).catch(() => {})); });
    await page.goto(`${base}${view.query}`); await page.waitForFunction(() => document.body.dataset.ready === 'true', undefined, { timeout: 90_000 });
    if (view.cafe) {
      await page.locator('#start').click(); await page.locator('#patron-name').fill('Studio visitor'); await page.getByRole('button', { name: 'Make yourself at home' }).click();
      await page.keyboard.down('ArrowDown'); await page.waitForTimeout(180); await page.keyboard.up('ArrowDown');
    }
    await page.waitForTimeout(500); await page.screenshot({ path: resolve(output, `${view.name}.png`) });
    const samples: { draws: number; triangles: number; softwareFrameMs: number }[] = [];
    if (view.cafe) await page.keyboard.down('ArrowRight');
    for (let i = 0; i < (view.cafe ? 42 : 4); i++) {
      samples.push(await page.locator('body').evaluate(body => ({ draws: Number(body.dataset.drawCalls), triangles: Number(body.dataset.triangles), softwareFrameMs: Number(body.dataset.frameMs) })));
      await page.waitForTimeout(100);
    }
    if (view.cafe) await page.keyboard.up('ArrowRight');
    if (view.cafe && view.name.includes('residents')) {
      // Use the public controls to approach the cats and repeat the camera sweep.
      const angles = (await page.locator('body').getAttribute('data-look'))!.split(',').map(Number);
      await page.mouse.move(420, 195); await page.mouse.down({ button: 'right' }); await page.mouse.move(420 + angles[0]! / .003, 195 + (angles[1]! + .65) / .003); await page.mouse.up({ button: 'right' });
      await page.keyboard.down('w'); await page.waitForTimeout(2000); await page.keyboard.up('w'); await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(output, `${view.name}-near.png`) }); await page.keyboard.down('ArrowRight');
      for (let i = 0; i < 42; i++) {
        samples.push(await page.locator('body').evaluate(body => ({ draws: Number(body.dataset.drawCalls), triangles: Number(body.dataset.triangles), softwareFrameMs: Number(body.dataset.frameMs) })));
        await page.waitForTimeout(100);
      }
      await page.keyboard.up('ArrowRight');
    }
    await Promise.all(transfers);
    const cats = [...files].filter(([path]) => path.includes('art/cats/'));
    results.push({ name: view.name, view: view.phone ? '844×390, DPR 1, software WebGL' : '1440×960, DPR 1, software WebGL', maxDraws: Math.max(...samples.map(sample => sample.draws)), maxTriangles: Math.max(...samples.map(sample => sample.triangles)), responseBodyBytes: [...files.values()].reduce((a, b) => a + b, 0), catAssetBytes: cats.reduce((sum, [, bytes]) => sum + bytes, 0), catAssets: cats.map(([path, bytes]) => ({ path, bytes })), errors, samples });
    await context.close();
  }
} finally { await browser.close(); }
writeFileSync(resolve(output, 'render-metrics.json'), `${JSON.stringify({ note: 'Response bodies are uncompressed application bytes; draw peaks cover a full yaw sweep at the spawn. SwiftShader timings are not representative of hardware.', results }, null, 2)}\n`);
console.log(JSON.stringify(results.map(result => ({ name: result.name, view: result.view, maxDraws: result.maxDraws, maxTriangles: result.maxTriangles, responseBodyBytes: result.responseBodyBytes, catAssetBytes: result.catAssetBytes, errors: result.errors })), null, 2));
if (results.some(result => result.errors.length)) process.exitCode = 1;
