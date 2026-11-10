import type { Rng } from '../core/rng.ts';

export type BlinkMood = 'relaxed' | 'alert' | 'asleep';
const MIN_GAP = 4, LID_TRAVEL = .4;
const ease = (value: number): number => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };

/** A single eye cue cadence on the brain's fixed step. Observation never changes the cadence. */
export class CatBlink {
  readonly #rng: Rng;
  #mood: BlinkMood | null = null;
  #time = 0; #next = Infinity; #last = -Infinity; #slow = false;
  #sleepEdge = -Infinity; #sleepFrom = 0;
  constructor(rng: Rng) { this.#rng = rng; }
  get sleeping(): boolean { return this.#mood === 'asleep'; }

  /** Returns true when a natural slow blink should also play on the visible cat. */
  step(dt: number, mood: BlinkMood, social: boolean): boolean {
    this.#time += dt;
    if (mood !== this.#mood) {
      if (this.sleeping || mood === 'asleep') {
        this.#sleepFrom = this.closed(); this.#sleepEdge = this.#time;
        if (this.sleeping) this.#last = Math.max(this.#last, this.#time - MIN_GAP + LID_TRAVEL);
      }
      this.#mood = mood; this.#schedule();
    }
    if (this.sleeping || this.#time - this.#last < MIN_GAP || (!social && this.#time < this.#next)) return false;
    this.#last = this.#time; this.#slow = social || mood === 'relaxed'; this.#schedule();
    return this.#slow && !social;
  }

  /** Continuous lid closure, optionally sampled between fixed steps for a smooth presentation. */
  closed(lead = 0): number {
    const time = this.#time + lead, sleepAge = time - this.#sleepEdge;
    if (this.sleeping || sleepAge < LID_TRAVEL) {
      return this.#sleepFrom + (Number(this.sleeping) - this.#sleepFrom) * ease(sleepAge / LID_TRAVEL);
    }
    const age = time - this.#last, travel = this.#slow ? LID_TRAVEL : .1, hold = this.#slow ? .3 : 0;
    return ease(Math.min(age, 2 * travel + hold - age) / travel);
  }

  #schedule(): void {
    this.#next = this.#time + (this.sleeping ? Infinity : this.#mood === 'relaxed' ? this.#rng.range(6, 12) : this.#rng.range(8, 20));
  }
}
