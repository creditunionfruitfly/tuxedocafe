export const FIXED_STEP = 1 / 30;
/** Bounded accumulator. Rendering never changes simulation time. */
export class FixedLoop {
  #accumulator = 0;
  #previous: number | null = null;
  paused = false;
  readonly step: (seconds: number) => void;
  readonly render: (alpha: number) => void;
  constructor(step: (seconds: number) => void, render: (alpha: number) => void) { this.step = step; this.render = render; }
  frame(milliseconds: number): void {
    if (this.#previous === null || this.paused) { this.#previous = milliseconds; this.render(0); return; }
    this.#accumulator += Math.min(5 * FIXED_STEP, Math.max(0, (milliseconds - this.#previous) / 1000));
    this.#previous = milliseconds;
    let steps = 0;
    while (this.#accumulator + 1e-9 >= FIXED_STEP && steps < 5) {
      this.step(FIXED_STEP); this.#accumulator -= FIXED_STEP; steps++;
    }
    this.render(Math.max(0, this.#accumulator / FIXED_STEP));
  }
  reset(): void { this.#previous = null; this.#accumulator = 0; }
}
