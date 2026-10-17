// Renders review sheets of the master cat with headless Chromium (Playwright) and a local static
// server rooted at the repository. Usage:
//   node tools/art/review-cat.ts <glb> <out.png> [query]          one sheet, e.g. "views=face,side&mode=clay"
//   node tools/art/review-cat.ts --deliverables <outDir>           the M2-1 screenshot set (Desktop and Low phone)
// CHROMIUM_PATH selects the browser binary (Playwright's bundled Chromium otherwise).
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium } from '@playwright/test';

const root = resolve('.');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };

export interface Sheet { src: string; out: string; query: string }

export async function renderSheets(sheets: Sheet[]) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^([/\\])+/, '');
    const file = join(root, path);
    if (!file.startsWith(root) || path.includes('..')) { res.writeHead(403).end(); return; }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const sheet of sheets) {
      const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
      page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page] ${m.text()}`); });
      await page.goto(`http://127.0.0.1:${port}/tools/art/review/cat-review.html?src=/${sheet.src}&${sheet.query}`);
      await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true, undefined, { timeout: 240000 });
      const error = await page.evaluate(() => (window as unknown as { __error?: string }).__error);
      if (error) throw new Error(`${sheet.src}: ${error}`);
      mkdirSync(join(sheet.out, '..'), { recursive: true });
      await page.locator('canvas').screenshot({ path: sheet.out });
      writeFileSync(sheet.out+'.prov.yaml',`source: ${sheet.src}\ntool: three.js neutral studio renderer; Playwright Chromium\ndate: '2026-10-17'\nlicense: original\nauthor_role: artist\nnotes: Original generated asset review capture; ${sheet.query}\n`);
      console.log(`review: ${sheet.out}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

/** Desktop default (1280×720 class) and Low phone (60–75% render scale of a 844×390 landscape). */
export function deliverables(outDir: string): Sheet[] {
  const lod = (n: number) => `public/assets/art/cats/cat_master_lod${n}.glb`;
  const source = 'public/assets/art/cats/cat_master_source.glb';
  const sizes = [{ tag: 'desktop', w: 640, h: 440, lod: 0 }, { tag: 'lowphone', w: 300, h: 220, lod: 1 }];
  const sheets: Sheet[] = [];
  const pose = [
    'front_L_scapula:-12:0:0', 'front_L_upper:-28:0:0', 'front_L_fore:42:0:0', 'front_L_wrist:-38:0:0',
    'front_R_scapula:10:0:0', 'front_R_upper:30:0:0', 'front_R_fore:-6:0:0',
    'hind_L_thigh:-38:0:0', 'hind_L_shin:42:0:0', 'hind_L_hock:-30:0:0',
    'hind_R_thigh:26:0:0', 'hind_R_shin:-12:0:0',
    'spine_02:6:0:0', 'spine_03:-4:12:0', 'spine_04:0:10:0', 'neck_01:-14:12:0', 'neck_02:-10:10:0', 'head:12:16:6', 'jaw:22:0:0',
    'tail_01:-30:0:0', 'tail_02:-20:12:0', 'tail_03:-10:16:0', 'tail_04:10:16:0', 'tail_05:20:12:0', 'tail_06:22:8:0', 'tail_07:18:0:0', 'tail_08:12:0:0',
    'ear_L_01:-25:0:-20', 'ear_R_01:0:30:0',
  ].join(';');
  for (const s of sizes) {
    const q = (views: string, cols: number, extra = '') => `views=${views}&cols=${cols}&w=${s.w}&h=${s.h}${extra}`;
    sheets.push({ src: lod(s.lod), out: `${outDir}/${s.tag}-turntable.png`, query: q('front,threequarter,side,back,top,threequarterBack', 3) });
    sheets.push({ src: lod(s.lod), out: `${outDir}/${s.tag}-face.png`, query: q('face,faceThreeQuarter,faceSide,eyeClose', 2) });
    sheets.push({ src: lod(s.lod), out: `${outDir}/${s.tag}-mouth-open.png`, query: q('mouth,mouthSide', 2, '&morphs=mouthOpen:1&pose=jaw:30:0:0') });
    sheets.push({ src: lod(s.lod), out: `${outDir}/${s.tag}-paws.png`, query: q('paws,pawsHind,pawSole,pawFront', 2) });
    sheets.push({ src: lod(s.lod), out: `${outDir}/${s.tag}-pose.png`, query: q('threequarter,side,front,top', 2, `&pose=${pose}`) });
    sheets.push({ src: lod(s.lod), out: `${outDir}/${s.tag}-weights.png`, query: q('threequarter,side,front,under', 2, '&mode=weights') });
  }
  sheets.push({ src: lod(0), out: `${outDir}/desktop-expressions.png`, query: 'views=face,face,face,face,face,face&cols=3&w=420&h=360&morphs=blink_L:1;squint_R:1;whiskerForward:1;noseWrinkle:.8;earFlatten_L:1' });
  sheets.push({ src: lod(0), out: `${outDir}/desktop-lods.png`, query: 'views=threequarter&cols=1&w=640&h=440&mode=wire' });
  for (const n of [1, 2]) sheets.push({ src: lod(n), out: `${outDir}/desktop-lod${n}-wire.png`, query: 'views=threequarter,face&cols=2&w=640&h=440&mode=wire' });
  sheets.push({ src: lod(0), out: `${outDir}/desktop-lod0-wire.png`, query: 'views=threequarter,face&cols=2&w=640&h=440&mode=wire' });
  sheets.push({ src: source, out: `${outDir}/desktop-source.png`, query: 'views=threequarter,face&cols=2&w=640&h=440&mode=clay' });
  sheets.push({ src: lod(0), out: `${outDir}/desktop-uv-checker.png`, query: 'views=threequarter,threequarterBack,face,under&cols=2&w=640&h=440&mode=uv' });
  sheets.push({ src: lod(0), out: `${outDir}/desktop-fur-flow.png`, query: 'views=threequarter,threequarterBack,face,top&cols=2&w=640&h=440&mode=flow' });
  sheets.push({ src: lod(0), out: `${outDir}/desktop-fur-length.png`, query: 'views=threequarter,threequarterBack,face,under&cols=2&w=640&h=440&mode=length' });
  return sheets;
}

if (process.argv[1]?.endsWith('review-cat.ts')) {
  const [a, b, c] = process.argv.slice(2);
  if (a === '--deliverables') await renderSheets(deliverables(b ?? 'docs/screenshots/m2-1'));
  else if (a && b) await renderSheets([{ src: a, out: b, query: c ?? '' }]);
  else { console.error('usage: review-cat.ts <glb> <out.png> [query] | --deliverables <dir>'); process.exit(1); }
}
