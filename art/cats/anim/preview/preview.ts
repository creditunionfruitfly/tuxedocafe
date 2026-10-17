// Development contact sheets for the cat animation library (not part of the build).
//   node art/cats/anim/preview/preview.ts [sheet ...]
// Renders cat_anims.glb (PREVIEW_GLB, default the built library) on a volumetric proxy cat with Playwright and
// writes PNGs to PREVIEW_OUT (default: the OS temp dir). CHROMIUM_PATH selects a local Chromium.
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { loadCatalog } from '../catalog.ts';
import { chromium } from '@playwright/test';

interface Cell {
  clip: string; t: number; az?: number; el?: number; dist?: number; target?: [number, number, number]; label?: string; fov?: number;
  ortho?: number; travel?: boolean; follow?: boolean; followRoot?: boolean; platform?: { h: number; z: number }; scaled?: boolean;
}
interface Sheet { motion?: boolean; title: string; cols: number; cellW: number; cellH: number; cells: Cell[] }

const OUT = process.env.PREVIEW_OUT ?? join(tmpdir(), 'cat-anim-preview');
const GLB = process.env.PREVIEW_GLB ?? 'public/assets/art/cats/cat_anims.glb';
const MESH = process.env.PREVIEW_MESH; // optional production skinned GLB, same bind rig
const side: Partial<Cell> = { az: 90, el: 2, dist: 3, ortho: 0.62, target: [0, 0.15, 0.02] };
const threeQ: Partial<Cell> = { az: 52, el: 16, dist: 2.2, fov: 20, target: [0, 0.13, 0] };
const front: Partial<Cell> = { az: 8, el: 8, dist: 2.2, fov: 20, target: [0, 0.14, 0] };
const top: Partial<Cell> = { az: 90, el: 80, dist: 2.4, fov: 20, target: [0, 0.05, 0] };
const at = (clip: string, times: number[], extra: Partial<Cell> = {}, tag = ''): Cell[] =>
  times.map(t => ({ clip, t, ...extra, label: `${clip.replace('cat.', '')} t=${t.toFixed(2)}${tag}` }));
const phases = (clip: string, T: number, n: number, extra: Partial<Cell> = {}, tag = '') =>
  at(clip, Array.from({ length: n }, (_, i) => (i / n) * T), extra, tag);

export const SHEETS: Record<string, Sheet> = {
  walk: { title: 'cat.loco.walk: side, 8 phases of one cycle (contacts LH 0, LF .25, RH .5, RF .75), then 3/4', cols: 4, cellW: 400, cellH: 280,
    cells: [...phases('cat.loco.walk', 1, 8, side), ...phases('cat.loco.walk', 1, 4, threeQ, ' 3/4')] },
  trot: { title: 'cat.loco.trot: side, 8 phases (diagonal pairs LH+RF 0, RH+LF .5), then 3/4', cols: 4, cellW: 400, cellH: 280,
    cells: [...phases('cat.loco.trot', 0.6, 8, side), ...phases('cat.loco.trot', 0.6, 4, threeQ, ' 3/4')] },
  gallop: { title: 'cat.loco.gallop: side, 8 phases (LH 0, RH .1, LF .45, RF .55), then 3/4', cols: 4, cellW: 400, cellH: 280,
    cells: [...phases('cat.loco.gallop', 0.4, 8, { ...side, ortho: 0.7 }), ...phases('cat.loco.gallop', 0.4, 4, threeQ, ' 3/4')] },
  loco: { title: 'idle, start, stop, turn left, walk away', cols: 4, cellW: 360, cellH: 260,
    cells: [...at('cat.loco.idle', [0, 1.0, 2.2], side), ...at('cat.loco.idle', [2.2], front, ' front'),
      ...at('cat.loco.start', [0.1, 0.25, 0.4, 0.5], side), ...at('cat.loco.stop', [0.05, 0.2, 0.35, 0.5], side),
      ...at('cat.loco.turn_left', [0.2, 0.4, 0.6, 0.8], { ...top, travel: false }), ...phases('cat.react.walk_away', 1, 4, side)] },
  sitdown: { title: 'cat.rest.sit_down: stand to sit (settle 1.0 s), then sit idle', cols: 4, cellW: 360, cellH: 280,
    cells: [...at('cat.rest.sit_down', [0, 0.2, 0.45, 0.65, 0.85, 1.2], side), ...at('cat.rest.sit_idle', [1.5], threeQ, ' 3/4'), ...at('cat.rest.sit_idle', [3], front, ' front')] },
  loaf: { title: 'cat.rest.loaf and cat.rest.sleep_curl', cols: 3, cellW: 420, cellH: 300,
    cells: [...at('cat.rest.loaf', [0], side), ...at('cat.rest.loaf', [1.5], threeQ, ' 3/4'), ...at('cat.rest.loaf', [3], front, ' front'),
      ...at('cat.rest.sleep_curl', [0], threeQ, ' 3/4'), ...at('cat.rest.sleep_curl', [2], top, ' top'), ...at('cat.rest.sleep_curl', [4], side)] },
  curl: { title: 'cat.rest.sleep_curl: production skin, side and top at a full breath', cols: 3, cellW: 440, cellH: 310,
    cells: [...at('cat.rest.sleep_curl', [0, 3.75, 7.5], threeQ), ...at('cat.rest.sleep_curl', [7.5], side),
      ...at('cat.rest.sleep_curl', [7.5], front), ...at('cat.rest.sleep_curl', [7.5], top)] },
  lying: { title: 'cat.rest.lie_side and cat.rest.sprawl', cols: 4, cellW: 360, cellH: 260,
    cells: [...at('cat.rest.lie_side', [0], threeQ, ' 3/4'), ...at('cat.rest.lie_side', [1], top, ' top'), ...at('cat.rest.sprawl', [0], threeQ, ' 3/4'), ...at('cat.rest.sprawl', [1], top, ' top')] },
  wake: { title: 'cat.rest.wake_stretch: loaf, downward-dog stretch (0.8), hind-leg stretch (2.0), stand', cols: 4, cellW: 380, cellH: 270,
    cells: at('cat.rest.wake_stretch', [0, 0.4, 0.85, 1.2, 1.6, 2.1, 2.4, 3.0], side) },
  groom: { title: 'cat.care.groom_face and cat.care.groom_flank', cols: 4, cellW: 360, cellH: 280,
    cells: [...at('cat.care.groom_face', [0.4, 0.75, 0.95], threeQ), ...at('cat.care.groom_face', [2.3], { ...threeQ, az: -40 }), ...at('cat.care.groom_flank', [0.3, 0.7], threeQ), ...at('cat.care.groom_flank', [0.5], top, ' top'), ...at('cat.care.groom_flank', [1.0], front, ' front')] },
  eat: { title: 'cat.care.eat_crouch and cat.care.drink_lap', cols: 4, cellW: 360, cellH: 260,
    cells: [...at('cat.care.eat_crouch', [0.2, 1.0], side), ...at('cat.care.eat_crouch', [1.0], threeQ, ' 3/4'), ...at('cat.care.eat_crouch', [0.2], front, ' front'),
      ...at('cat.care.drink_lap', [0.0, 0.12], side), ...at('cat.care.drink_lap', [0.5], threeQ, ' 3/4'), ...at('cat.care.drink_lap', [0.5], front, ' front')] },
  jumps: { title: 'jump up low / high (root motion), jump down low / high, land', cols: 5, cellW: 320, cellH: 300,
    cells: [...at('cat.move.jump_up_low', [0.2, 0.36, 0.52, 0.66, 0.9], { az: 90, el: 3, dist: 4, ortho: 1.0, target: [0, 0.32, 0.3], follow: false, travel: false, platform: { h: 0.45, z: 0.24 }, scaled: false }),
      ...at('cat.move.jump_up_high', [0.4, 0.65, 0.82, 0.97, 1.3], { az: 90, el: 3, dist: 5, ortho: 1.8, target: [0, 0.75, 0.3], follow: false, travel: false, platform: { h: 1.2, z: 0.27 }, scaled: false }),
      ...at('cat.move.jump_down_low', [0.08, 0.2, 0.32, 0.45, 0.8], { az: 90, el: 3, dist: 4, ortho: 1.0, target: [0, -0.1, 0.35], follow: false, travel: false, platform: { h: -0.45, z: 0.17 }, scaled: false }),
      ...at('cat.move.jump_down_high', [0.1, 0.3, 0.5, 0.7, 1.1], { az: 90, el: 3, dist: 5, ortho: 1.9, target: [0, -0.45, 0.4], follow: false, travel: false, platform: { h: -1.2, z: 0.17 }, scaled: false }),
      ...at('cat.move.land', [0, 0.08, 0.16, 0.3, 0.5], side)] },
  pounce: { title: 'cat.play.pounce (root motion): crouch, butt wiggle, spring (0.46), pin (0.6)', cols: 4, cellW: 380, cellH: 270,
    cells: at('cat.play.pounce', [0.1, 0.25, 0.38, 0.5, 0.56, 0.62, 0.8, 1.2], { ...side, ortho: 0.8, target: [0, 0.15, 0.2], travel: false }) },
  hiss: { title: 'cat.react.hiss, cat.react.flinch_startle, cat.react.swat', cols: 4, cellW: 360, cellH: 270,
    cells: [...at('cat.react.hiss', [0.1, 0.3, 0.8], side), ...at('cat.react.hiss', [0.5], front, ' front'),
      ...at('cat.react.flinch_startle', [0.1, 0.6], side), ...at('cat.react.swat', [0.12, 0.25], threeQ, ' 3/4')] },
  social: { title: 'cat.social.head_rub, tail_up_greeting; bat left / right', cols: 4, cellW: 360, cellH: 270,
    cells: [...at('cat.social.head_rub', [0.3, 0.65, 1.0], front, ' front'), ...at('cat.social.head_rub', [0.65], threeQ, ' 3/4'),
      ...at('cat.social.tail_up_greeting', [0.35, 1.0], side), ...at('cat.play.bat_left', [0.2], front, ' front'), ...at('cat.play.bat_right', [0.2], threeQ, ' 3/4')] },
  roll: { title: 'cat.play.roll_over and cat.perk.catnip_roll', cols: 5, cellW: 320, cellH: 260,
    cells: [...at('cat.play.roll_over', [0.25, 0.5, 0.9, 1.2, 1.8], threeQ), ...at('cat.perk.catnip_roll', [0.3, 0.6, 1.2, 1.9, 2.8], threeQ)] },
  layers: { title: 'additive layers (shown on their reference pose)', cols: 4, cellW: 340, cellH: 250,
    cells: [...at('cat.layer.tail_up', [0.5], side), ...at('cat.layer.tail_low', [0.5], side), ...at('cat.layer.tail_lash', [0, 0.2], top, ' top'),
      ...at('cat.layer.ears_forward', [0.5], front, ' front'), ...at('cat.layer.ears_back', [0.5], front, ' front'), ...at('cat.layer.lean_in', [0.4], front, ' front'), ...at('cat.rest.yawn', [0.7], threeQ, ' 3/4')] },
  perks: { title: 'perk clips (M5/M6)', cols: 5, cellW: 320, cellH: 240,
    cells: [...at('cat.perk.catnip_sniff', [0.5, 1.4], side), ...at('cat.perk.catnip_lick', [0.5], threeQ), ...at('cat.perk.catnip_zoom', [0.15], side),
      ...at('cat.perk.laser_stalk', [0.5], side), ...at('cat.perk.laser_butt_wiggle', [0.5], threeQ), ...at('cat.perk.laser_pounce', [0.32, 0.6], { ...side, travel: false }),
      ...at('cat.perk.toy_catch', [0.8], threeQ), ...at('cat.perk.feather_bat', [0.17], front), ...at('cat.perk.feather_leap', [0.6], { ...side, ortho: 0.9, target: [0, 0.3, 0] }),
      ...at('cat.perk.feather_catch', [0.32], threeQ), ...at('cat.perk.harness_freeze', [1.2], side), ...at('cat.perk.harness_low_walk', [0.3], side),
      ...at('cat.perk.harness_flop', [1.5], threeQ), ...at('cat.perk.harness_sniff', [0.8], side)] },
};

// Every catalogued clip gets three samples: anticipation, strongest action and recovery.
const catalog = loadCatalog();
for (let i = 0; i < catalog.clips.length; i += 8) {
  const chunk = catalog.clips.slice(i, i + 8);
  SHEETS[`catalog${i / 8 + 1}`] = { title: `Catalog review ${i + 1}–${i + chunk.length} / ${catalog.clips.length}`, cols: 3, cellW: 400, cellH: 270,
    cells: chunk.flatMap(c => {
      const view: Partial<Cell> = { ...threeQ, followRoot: true };
      if (c.heightM !== undefined) { view.platform = { h: c.heightM, z: 0 }; view.ortho = 1.0; }
      if (c.name === 'cat.care.scratch_post') { view.target = [0, 0.3, 0]; view.ortho = 0.85; }
      if (c.name === 'cat.perk.feather_leap') { view.target = [0, 0.4, 0]; view.ortho = 1.15; }
      return at(c.name, [0.18, 0.5, 0.82].map(f => c.durationS * f), view);
    }) };
}

// Review the three adjacent exported frames around each audit peak on the actual skin.
if (process.env.PREVIEW_AUDIT) {
  const audit = JSON.parse(readFileSync(process.env.PREVIEW_AUDIT, 'utf8')) as { results: { clip: string; t: number; degreesPerFrame: number; bone: string }[] };
  for (const [i, peak] of audit.results.filter(r => r.degreesPerFrame > 35).entries()) {
    const clip = catalog.clips.find(c => c.name === peak.clip)!;
    const times = [peak.t - 2 / 30, peak.t - 1 / 30, peak.t, peak.t + 1 / 30].map(t => Math.max(0, Math.min(clip.durationS - 0.00001, t)));
    const view: Partial<Cell> = clip.heightM !== undefined
      ? { target: [0, clip.heightM > 0 ? clip.heightM * 0.65 : clip.heightM * 0.55, 0.3], ortho: Math.abs(clip.heightM) + 0.7, followRoot: false, travel: false }
      : { followRoot: true };
    SHEETS[`audit${i + 1}`] = { title: `${peak.clip}: ${peak.bone}, ${peak.degreesPerFrame.toFixed(1)} degrees per frame`, cols: 4, cellW: 360, cellH: 280,
      cells: [...at(peak.clip, times, { ...side, ...view }), ...at(peak.clip, times, { ...threeQ, ...view })] };
  }
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
function serve() {
  const root = resolve('.');
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = url === '/mesh.glb' && MESH ? resolve(MESH) : url === '/' ? join(root, 'art/cats/anim/preview/preview.html')
      : url === '/anims.glb' ? resolve(GLB)
      : url === '/expressions.json' ? resolve(dirname(GLB), 'cat_expressions.json')
      : url.startsWith('/three/') ? join(root, 'node_modules/three', url.slice(7)) : '';
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
const names = wanted.length ? wanted : process.env.PREVIEW_MOTION ? [] : Object.keys(SHEETS);
const { port, close } = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1300 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/${MESH ? '?mesh=1' : ''}`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true, null, { timeout: 60000 });
  mkdirSync(OUT, { recursive: true });
  const prefix = process.env.PREVIEW_PREFIX ?? '';
  for (const name of names) {
    const sheet = SHEETS[name];
    if (!sheet) throw new Error(`unknown sheet ${name}`);
    await page.evaluate(s => (window as unknown as { renderSheet: (s: unknown) => Promise<boolean> }).renderSheet(s), sheet);
    await page.locator('#wrap').screenshot({ path: `${OUT}/${prefix}${name}.png` });
    console.log(`${OUT}/${prefix}${name}.png (${sheet.cells.length} cells)`);
  }
  // Optional deterministic 30 fps motion review. ffmpeg only encodes captured rendered frames.
  for (const name of (process.env.PREVIEW_MOTION ?? '').split(',').filter(Boolean)) {
    const clip = catalog.clips.find(c => c.name === name);
    if (!clip) throw new Error(`unknown motion clip ${name}`);
    const framesDir = join(OUT, name); mkdirSync(framesDir, { recursive: true });
    const seconds = clip.loop ? Math.max(3, 3 * clip.durationS) : clip.durationS + 0.5;
    for (let f = 0; f < Math.ceil(seconds * 30); f++) {
      const t = clip.loop ? f / 30 % clip.durationS : Math.min(f / 30, clip.durationS - 0.00001);
      const sheet: Sheet = { title: `${name} — 30 fps`, motion: true, cols: 1, cellW: 960, cellH: 600,
        cells: [{ clip: name, t, ...threeQ, followRoot: true }] };
      await page.evaluate(s => (window as unknown as { renderSheet: (s: unknown) => Promise<boolean> }).renderSheet(s), sheet);
      await page.locator('#wrap').screenshot({ path: join(framesDir, `${String(f).padStart(4, '0')}.png`) });
    }
    const encoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '30', '-i', join(framesDir, '%04d.png'), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', join(OUT, `${name}.mp4`)], { encoding: 'utf8' });
    if (encoded.status !== 0) throw new Error(`ffmpeg: ${encoded.stderr}`);
    console.log(join(OUT, `${name}.mp4`));
  }
  if (errors.length) throw new Error(`preview page errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  close();
}
