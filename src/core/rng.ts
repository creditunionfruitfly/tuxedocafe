/**
 * Seeded random numbers (AGENTS rule 5: never Math.random in game code).
 *
 * sfc32 seeded through splitmix32: fast, 128-bit state, reproducible on every
 * platform. Fork a stream per system or per cat so adding a call in one place
 * never shifts the numbers another system sees:
 *
 *   const world = createRng('save:4f2a');
 *   const mochi = world.fork('cat:mochi');
 */
export interface Rng {
  /** The 32-bit seed this stream started from. */
  readonly seed: number;
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** A float in [min, max). */
  range(min: number, max: number): number;
  /** An exponentially distributed value with the given mean (waiting times). */
  exponential(mean: number): number;
  /** One item from a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** An independent child stream, derived from this seed and a label. */
  fork(label: string): Rng;
}

/** FNV-1a: turns any text into a 32-bit seed. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

class Sfc32 implements Rng {
  readonly seed: number;
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const mix = splitmix32(this.seed);
    this.#a = mix();
    this.#b = mix();
    this.#c = mix();
    this.#d = mix();
    for (let i = 0; i < 12; i++) this.next();
  }

  next(): number {
    const t = (((this.#a + this.#b) >>> 0) + this.#d) >>> 0;
    this.#d = (this.#d + 1) >>> 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) >>> 0;
    this.#c = ((this.#c << 21) | (this.#c >>> 11)) >>> 0;
    this.#c = (this.#c + t) >>> 0;
    return t / 4294967296;
  }

  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`int(${min}, ${max}) needs integers with min <= max`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  exponential(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() needs at least one item');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  fork(label: string): Rng {
    return new Sfc32(hashSeed(`${this.seed}:${label}`));
  }
}

/** A new stream from a number or any text, such as a save id. */
export function createRng(seed: number | string): Rng {
  return new Sfc32(typeof seed === 'string' ? hashSeed(seed) : seed);
}
