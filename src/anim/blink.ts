import type { Rng } from '../core/rng.ts';

/**
 * Procedural blinks: one every 3–8 s (data/animation-catalog.json `blink`
 * notes), drawn from the cat's own seeded stream on the fixed step, so two
 * runs of the same save blink at the same moments at any frame rate.
 */
export class BlinkScheduler {
  readonly #rng: Rng;
  readonly minS: number; readonly maxS: number;
  #time = 0; #next: number;

  constructor(rng: Rng, minS = 3, maxS = 8) {
    this.#rng = rng; this.minS = minS; this.maxS = maxS;
    this.#next = rng.range(minS, maxS);
  }

  /** Seconds until the next blink. */
  get remaining(): number { return Math.max(0, this.#next - this.#time); }

  /** Returns true on the step a blink should start; `suppressed` (eyes closed, slow blink) postpones it. */
  advance(dt: number, suppressed = false): boolean {
    this.#time += dt;
    if (this.#time < this.#next) return false;
    this.#next = this.#time + this.#rng.range(this.minS, this.maxS);
    return !suppressed;
  }
}
