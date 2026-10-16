import { createRng } from '../../src/core/rng.ts';

/** The parts of data/economy.json the pacing simulation reads. */
export interface EconomyData {
  player: { walkSeconds: number };
  chores: Record<string, { pays: number; meanIntervalSeconds: number; taskSeconds: number; staffAfterSeconds: number }>;
  perks: Record<string, { cost: number }>;
  targets: { incomePerHour: number; choreShareOfTime: number; medianMinutesToAfford: Record<string, number> };
}

export interface SimOptions {
  runs: number;
  seed: string;
  /** Hours of play per run. */
  hours: number;
  /** Chance that the player finishes petting first, delaying a chore by 0–60 s. */
  pettingBias: number;
}

export interface SimResult {
  medianIncomePerHour: number;
  medianChoreShareOfTime: number;
  medianMissedShare: number;
  /** Median minutes until the player first holds enough C$ for each perk. */
  medianMinutesToAfford: Record<string, number>;
}

const median = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/**
 * A diligent player: chores appear at exponential intervals, the player walks
 * over and does each one unless staff got there first, and savings are never
 * spent. Seeded, so the same data and options always give the same numbers.
 */
export function simulateEconomy(data: EconomyData, options: SimOptions): SimResult {
  const horizon = options.hours * 3600;
  const incomes: number[] = [];
  const shares: number[] = [];
  const missedShares: number[] = [];
  const afford: Record<string, number[]> = Object.fromEntries(Object.keys(data.perks).map((perk) => [perk, []]));

  for (let run = 0; run < options.runs; run++) {
    const rng = createRng(`${options.seed}:${run}`);
    const events: { at: number; chore: string }[] = [];
    for (const [chore, spec] of Object.entries(data.chores)) {
      const stream = rng.fork(chore);
      for (let at = stream.exponential(spec.meanIntervalSeconds); at < horizon; at += stream.exponential(spec.meanIntervalSeconds)) {
        events.push({ at, chore });
      }
    }
    events.sort((a, b) => a.at - b.at);

    const delays = rng.fork('player');
    let freeAt = 0;
    let cash = 0;
    let choreSeconds = 0;
    let done = 0;
    let missed = 0;
    const firstAfford = new Map<string, number>();

    for (const { at, chore } of events) {
      const spec = data.chores[chore];
      if (spec === undefined) continue;
      let start = Math.max(at, freeAt);
      if (delays.next() < options.pettingBias) start += delays.range(0, 60);
      if (start - at > spec.staffAfterSeconds) {
        missed++;
        continue;
      }
      const duration = data.player.walkSeconds + spec.taskSeconds;
      freeAt = start + duration;
      choreSeconds += duration;
      done++;
      cash += spec.pays;
      for (const [perk, { cost }] of Object.entries(data.perks)) {
        if (!firstAfford.has(perk) && cash >= cost) firstAfford.set(perk, freeAt / 60);
      }
    }

    incomes.push(cash / options.hours);
    shares.push(choreSeconds / horizon);
    missedShares.push(done + missed > 0 ? missed / (done + missed) : 0);
    for (const [perk, minutes] of firstAfford) afford[perk]?.push(minutes);
  }

  return {
    medianIncomePerHour: median(incomes),
    medianChoreShareOfTime: median(shares),
    medianMissedShare: median(missedShares),
    medianMinutesToAfford: Object.fromEntries(Object.entries(afford).map(([perk, minutes]) => [perk, median(minutes)])),
  };
}
