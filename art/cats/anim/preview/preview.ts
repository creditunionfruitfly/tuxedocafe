// Local contact-sheet preview: binds cat_anims.glb onto the capsule rig
// diagnostic (cat_placeholder_lod0.glb) by bone name and renders key poses.
// Usage: node art/cats/anim/preview/preview.ts [sheet ...]
// Needs `npm run assets` first. CHROMIUM_PATH selects a local Chromium.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

interface Cell { clip: string; t: number; az?: number; el?: number; dist?: number; target?: [number, number, number]; label?: string; fov?: number; platform?: { h: number; z: number } }
interface Sheet { title: string; cols: number; cellW: number; cellH: number; cells: Cell[] }

const OUT = process.env.PREVIEW_OUT ?? 'docs/screenshots/m2-2';
const phases = (clip: string, T: number, n: number, extra: Partial<Cell> = {}) =>
  Array.from({ length: n }, (_, k) => ({ clip, t: (k / n) * T, ...extra, label: `${clip.replace('cat.', '')} ${(k / n).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}${extra.label ?? ''}` }));
const keys = (clip: string, times: number[], extra: Partial<Cell> = {}) => times.map(t => ({ clip, t, ...extra }));
const side = { az: 90, el: 3, dist: 2.35, target: [0, 0.24, -0.1] as [number, number, number] };
const threeQ = { az: 50, el: 18, dist: 2.3, target: [0, 0.2, -0.08] as [number, number, number] };
const front = { az: 0, el: 8, dist: 2.0, target: [0, 0.22, 0] as [number, number, number] };
const top = { az: 90, el: 75, dist: 2.2, target: [0, 0.1, -0.1] as [number, number, number] };

export const SHEETS: Record<string, Sheet> = {
  rig: { title: 'bind pose of the current skeleton', cols: 3, cellW: 420, cellH: 320,
    cells: [{ clip: 'rest', t: 0, ...side, label: 'rest side' }, { clip: 'rest', t: 0, ...threeQ, label: 'rest 3/4' }, { clip: 'rest', t: 0, ...front, label: 'rest front' }] },
  walk: { title: 'cat.loco.walk: side view, 8 phases (LH 0, LF .25, RH .5, RF .75); blue = left limbs', cols: 4, cellW: 360, cellH: 260,
    cells: [...phases('cat.loco.walk', 1.0, 8, side), ...phases('cat.loco.walk', 1.0, 4, { ...threeQ, label: ' 3/4' })] },
  trot: { title: 'cat.loco.trot: side view, 8 phases (LH+RF 0, RH+LF .5)', cols: 4, cellW: 360, cellH: 260,
    cells: [...phases('cat.loco.trot', 0.6, 8, side), ...phases('cat.loco.trot', 0.6, 4, { ...threeQ, label: ' 3/4' })] },
  gallop: { title: 'cat.loco.gallop: side view, 8 phases (LH 0, RH .1, LF .45, RF .55)', cols: 4, cellW: 360, cellH: 260,
    cells: [...phases('cat.loco.gallop', 0.4, 8, side), ...phases('cat.loco.gallop', 0.4, 4, { ...threeQ, label: ' 3/4' })] },
  loco: { title: 'idle, walk away, turns, start, stop', cols: 4, cellW: 340, cellH: 250,
    cells: [...keys('cat.loco.idle', [0, 1.3, 2.6], side), ...keys('cat.loco.idle', [2.0], front),
      ...phases('cat.react.walk_away', 1.0, 4, side),
      ...keys('cat.loco.turn_left', [0.2, 0.4, 0.6, 0.8], top), ...keys('cat.loco.start', [0.1, 0.25, 0.4, 0.5], side), ...keys('cat.loco.stop', [0.1, 0.25, 0.4, 0.5], side)] },
  sitdown: { title: 'cat.rest.sit_down: stand to sit (settle at 1.0 s)', cols: 4, cellW: 360, cellH: 280,
    cells: [...keys('cat.rest.sit_down', [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1.0, 1.2], side)] },
  rest: { title: 'sit idle, loaf, lie side, sprawl, sleep curl', cols: 3, cellW: 460, cellH: 300,
    cells: [...keys('cat.rest.sit_idle', [0], side), ...keys('cat.rest.sit_idle', [1], front), ...keys('cat.rest.sit_idle', [1], threeQ),
      ...keys('cat.rest.loaf', [0], side), ...keys('cat.rest.loaf', [3], threeQ), ...keys('cat.rest.loaf', [3], front),
      ...keys('cat.rest.lie_side', [0], threeQ), ...keys('cat.rest.lie_side', [0], top), ...keys('cat.rest.sprawl', [0], threeQ),
      ...keys('cat.rest.sprawl', [0], top), ...keys('cat.rest.sleep_curl', [0], threeQ), ...keys('cat.rest.sleep_curl', [4], top)] },
  wake: { title: 'wake stretch, yawn (over sit), roll over', cols: 4, cellW: 340, cellH: 250,
    cells: [...keys('cat.rest.wake_stretch', [0, 0.5, 0.8, 1.2, 1.6, 2.0, 2.4, 3.0], side), ...keys('cat.rest.yawn', [0.2, 0.6, 1.0], side),
      ...keys('cat.play.roll_over', [0.3, 0.6, 0.9, 1.2, 1.6], threeQ)] },
  care: { title: 'groom face, groom flank, eat, drink, paw water, knead', cols: 4, cellW: 340, cellH: 250,
    cells: [...keys('cat.care.groom_face', [0.2, 0.8, 1.5, 2.3], threeQ), ...keys('cat.care.groom_flank', [0.3, 1.5], threeQ), ...keys('cat.care.groom_flank', [0.8], top),
      ...keys('cat.care.eat_crouch', [0.4], side), ...keys('cat.care.eat_crouch', [1.0], threeQ), ...keys('cat.care.drink_lap', [0.1], side), ...keys('cat.care.drink_lap', [0.5], front),
      ...keys('cat.care.paw_water', [0.4, 0.9, 1.5], threeQ), ...keys('cat.care.knead', [0.2, 1.0], side)] },
  care2: { title: 'litter dig, squat, cover, scratch post', cols: 4, cellW: 340, cellH: 250,
    cells: [...keys('cat.care.litter_dig', [0.3, 0.8, 1.3, 2.0], threeQ), ...keys('cat.care.litter_squat', [0, 2], side),
      ...keys('cat.care.litter_cover', [0.4, 1.0, 1.6, 2.2], threeQ), ...keys('cat.care.scratch_post', [0.2, 0.7, 1.2, 1.7], side)] },
  jumps: { title: 'jump up low / high (root motion), jump down low / high, land', cols: 5, cellW: 300, cellH: 280,
    cells: [...keys('cat.move.jump_up_low', [0.15, 0.32, 0.45, 0.6, 0.9], { az: 90, el: 4, dist: 2.6, target: [0, 0.4, 0.25], platform: { h: 0.45, z: 0.32 } }),
      ...keys('cat.move.jump_up_high', [0.3, 0.58, 0.75, 0.95, 1.3], { az: 90, el: 4, dist: 3.6, target: [0, 0.75, 0.25], platform: { h: 1.2, z: 0.32 } }),
      ...keys('cat.move.jump_down_low', [0.15, 0.3, 0.42, 0.55, 0.8], { az: 90, el: 4, dist: 2.6, target: [0, -0.1, 0.25] }),
      ...keys('cat.move.jump_down_high', [0.3, 0.5, 0.65, 0.8, 1.1], { az: 90, el: 4, dist: 3.6, target: [0, -0.5, 0.25] }),
      ...keys('cat.move.land', [0, 0.1, 0.2, 0.3, 0.5], side)] },
  play: { title: 'pounce (root motion), bat left/right, swat, hiss, flinch', cols: 4, cellW: 340, cellH: 250,
    cells: [...keys('cat.play.pounce', [0.2, 0.4, 0.55, 0.65], { ...side, dist: 2.2, target: [0, 0.2, 0.25] }), ...keys('cat.play.bat_left', [0.15, 0.3], threeQ), ...keys('cat.play.bat_right', [0.3], threeQ), ...keys('cat.react.swat', [0.25], threeQ),
      ...keys('cat.react.hiss', [0.1, 0.4, 0.8], side), ...keys('cat.react.hiss', [0.5], front), ...keys('cat.react.flinch_startle', [0.1, 0.25, 0.5, 0.7], side)] },
  social: { title: 'head rub, tail-up greeting, slow blink, additive layers', cols: 4, cellW: 340, cellH: 250,
    cells: [...keys('cat.social.head_rub', [0.2, 0.5, 0.8, 1.1], threeQ), ...keys('cat.social.tail_up_greeting', [0.3, 0.9], side), ...keys('cat.social.slow_blink', [0.9], side),
      ...keys('cat.layer.tail_up', [0], side), ...keys('cat.layer.tail_low', [0], side), ...keys('cat.layer.tail_lash', [0, 0.2, 0.4, 0.6], { ...top }), ...keys('cat.layer.ears_back', [0.5], front), ...keys('cat.layer.lean_in', [0.7], side)] },
  perks: { title: 'perk clips (M5/M6)', cols: 5, cellW: 300, cellH: 240,
    cells: [...keys('cat.perk.catnip_sniff', [1.2], side), ...keys('cat.perk.catnip_lick', [0.6], threeQ), ...keys('cat.perk.catnip_roll', [0.8, 1.5, 2.3], threeQ),
      ...keys('cat.perk.catnip_zoom', [0.1, 0.25], side), ...keys('cat.perk.laser_stalk', [0.4, 1.4], side), ...keys('cat.perk.laser_butt_wiggle', [0.5], side),
      ...keys('cat.perk.laser_pounce', [0.3, 0.45], side), ...keys('cat.perk.toy_catch', [0.6], threeQ), ...keys('cat.perk.feather_bat', [0.2], front),
      ...keys('cat.perk.feather_leap', [0.5], side), ...keys('cat.perk.feather_catch', [0.6], threeQ), ...keys('cat.perk.harness_freeze', [1.0], side), ...keys('cat.perk.harness_low_walk', [0.3], side),
      ...keys('cat.perk.harness_flop', [1.5], threeQ), ...keys('cat.perk.harness_sniff', [0.8], side)] },
};

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
function serve() {
  const root = resolve('.');
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = url === '/' ? join(root, 'art/cats/anim/preview/preview.html')
      : url.startsWith('/three/') ? join(root, 'node_modules/three', url.slice(7))
      : url.startsWith('/assets/') ? join(root, 'public/assets', url.slice(8)) : '';
    if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (!file || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise<{ port: number; close: () => void }>(ok => server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    ok({ port: typeof addr === 'object' && addr ? addr.port : 0, close: () => server.close() });
  }));
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SHEETS);
const { port, close } = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/${process.env.PREVIEW_MESH === '0' ? '?mesh=0' : ''}`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true, null, { timeout: 60000 });
  mkdirSync(OUT, { recursive: true });
  const available = new Set((await page.evaluate(() => (window as unknown as { clipInfo: () => { name: string }[] }).clipInfo())).map(c => c.name));
  for (const name of names) {
    const sheet = SHEETS[name];
    if (!sheet) throw new Error(`unknown sheet ${name}`);
    const cells = sheet.cells.filter(c => c.clip === 'rest' || available.has(c.clip));
    if (!cells.length) { console.log(`${name}: no clips yet`); continue; }
    await page.evaluate(s => (window as unknown as { renderSheet: (s: unknown) => Promise<boolean> }).renderSheet(s), { ...sheet, cells });
    await page.locator('#wrap').screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${OUT}/${name}.png (${cells.length} cells)`);
  }
  if (errors.length) throw new Error(`preview page errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  close();
}
