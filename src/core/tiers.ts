export type Tier = 'high' | 'desktop' | 'phone' | 'low';
export interface Probe { mobile: boolean; memory: number; cores: number; samples: number }
export const TIER_CONFIG = {
  high: { min: 1, max: 1, target: 60, shadows: true },
  desktop: { min: .85, max: 1, target: 60, shadows: true },
  phone: { min: .7, max: .9, target: 60, shadows: false },
  low: { min: .6, max: .75, target: 30, shadows: false },
} as const;
export function parseTier(value: string | null): Tier | null { return value === 'high' || value === 'desktop' || value === 'phone' || value === 'low' ? value : null; }
export function chooseTier(probe: Probe, milliseconds: number): Tier {
  if (milliseconds > 25 || probe.memory < 3 || probe.cores < 4) return 'low';
  if (milliseconds > 19) return 'low';
  if (probe.mobile) return 'phone';
  return probe.memory >= 8 && probe.cores >= 8 && probe.samples >= 4 && milliseconds <= 17 ? 'high' : 'desktop';
}
export function probeDevice(context: WebGL2RenderingContext): Probe {
  const device = navigator as Navigator & { deviceMemory?: number };
  return { mobile: matchMedia('(pointer: coarse)').matches, memory: device.deviceMemory ?? 4, cores: device.hardwareConcurrency || 4, samples: Number(context.getParameter(context.MAX_SAMPLES)) };
}
/** Two seconds of actual scene frames, dropping compilation/warmup samples. */
export class TierBenchmark {
  #start = 0; #last = 0; #samples: number[] = [];
  update(time: number): number | null {
    if (!this.#start) { this.#start = this.#last = time; return null; }
    const delta = time - this.#last; this.#last = time;
    if (time - this.#start > 250 && delta > 0) this.#samples.push(delta);
    if (time - this.#start < 2000) return null;
    this.#samples.sort((a, b) => a - b);
    return this.#samples[Math.floor(this.#samples.length * .75)] ?? 33;
  }
}
