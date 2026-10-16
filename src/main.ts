import buildInfo from 'virtual:build-info';
import { formatStamp } from './core/build-info.ts';
import { FixedLoop } from './core/loop.ts';
import { parseFlags } from './core/flags.ts';
import { watchUpdates } from './core/update-check.ts';
import { TierBenchmark, chooseTier, parseTier, probeDevice } from './core/tiers.ts';
import { createRenderer } from './render/renderer.ts';
import { createCafe } from './scenes/cafe.ts';
import { installOrientation } from './input/orientation.ts';
const body = document.body;
const stamp = document.querySelector<HTMLElement>('#build-stamp'); if (stamp) stamp.textContent = formatStamp(buildInfo);
body.dataset.flags = [...parseFlags(buildInfo.flags, location.search)].join(',');
try {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const display = createRenderer(canvas); const { scene, camera } = createCafe();
  const probe = probeDevice(display.renderer.getContext() as WebGL2RenderingContext);
  const override = parseTier(new URLSearchParams(location.search).get('tier')); if (override) display.configure(override);
  const benchmark = new TierBenchmark(); let benchmarkDone = !!override; let previous = 0;
  const loop = new FixedLoop(() => {}, () => {
    camera.aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1); camera.updateProjectionMatrix();
    display.renderer.render(scene, camera); body.dataset.ready = 'true';
  });
  installOrientation(paused => { loop.paused = paused; loop.reset(); });
  display.renderer.setAnimationLoop(time => {
    if (!benchmarkDone) { const result = benchmark.update(time); if (result !== null) { display.configure(chooseTier(probe, result)); benchmarkDone = true; body.dataset.benchmarkMs = result.toFixed(1); } }
    if (previous) display.adapt(time - previous); previous = time; loop.frame(time);
  });
} catch {
  document.querySelector<HTMLElement>('#unsupported')?.removeAttribute('hidden'); body.dataset.ready = 'unsupported';
}
watchUpdates(buildInfo, () => Promise.resolve(), reload => { const button = document.querySelector<HTMLButtonElement>('#update'); if (button) { button.hidden = false; button.onclick = reload; } });
