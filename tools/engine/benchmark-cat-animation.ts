/** CPU-only fixed-step benchmark on this host. Never a device or GPU benchmark. */
import { performance } from 'node:perf_hooks';
import { createResidentCat } from '../../src/cats/cat-instance.ts';
import { RESIDENTS } from '../../src/cats/builds.ts';
import { createRng } from '../../src/core/rng.ts';
import { productionKit } from '../../tests/unit/helpers/production-cat.ts';

const kit = await productionKit(), cats = RESIDENTS.map(data => createResidentCat(kit, data, { rng: createRng(data.id) }));
const results: { interval: number; cats: number; steps: number; meanCpuMsPerCat: number; p95CpuMsPerCat: number }[] = [];
for (const interval of [1, 3]) {
  for (const cat of cats) cat.animation.interval = interval;
  const times: number[] = [];
  for (let tick = 0; tick < 420; tick++) {
    const start = performance.now();
    for (const cat of cats) { cat.animation.drive(.58 * cat.build.scale, .12, 1 / 30); cat.animation.tick(1 / 30); cat.animation.render(.5); }
    if (tick >= 120) times.push((performance.now() - start) / cats.length);
  }
  times.sort((a, b) => a - b);
  results.push({ interval, cats: cats.length, steps: times.length, meanCpuMsPerCat: times.reduce((a, b) => a + b, 0) / times.length, p95CpuMsPerCat: times[Math.floor(times.length * .95)]! });
}
for (const cat of cats) cat.dispose();
console.log(JSON.stringify({ environment: `Node ${process.version}, CPU only, ${process.platform}/${process.arch}`, results }, null, 2));
