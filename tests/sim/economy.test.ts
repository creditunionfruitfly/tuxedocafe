import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { simulateEconomy, type EconomyData } from '../../tools/engine/economy-sim.ts';

// Guards the pacing in README's "Chores, C$ and perks" against data/economy.json.
// If a deliberate rebalance moves these, update the targets in economy.json and the README together.
const data = JSON.parse(readFileSync('data/economy.json', 'utf8')) as EconomyData;
const result = simulateEconomy(data, { runs: 400, hours: 3, seed: 'ci', pettingBias: 0 });

describe('economy pacing', () => {
  it('pays a diligent player close to the target income', () => {
    expect(result.medianIncomePerHour).toBeGreaterThan(data.targets.incomePerHour * 0.9);
    expect(result.medianIncomePerHour).toBeLessThan(data.targets.incomePerHour * 1.1);
  });

  it('keeps chores to roughly a quarter of play time', () => {
    expect(result.medianChoreShareOfTime).toBeGreaterThan(0.2);
    expect(result.medianChoreShareOfTime).toBeLessThan(0.3);
  });

  it('puts every perk within 20% of its target time to afford', () => {
    for (const [perk, target] of Object.entries(data.targets.medianMinutesToAfford)) {
      const minutes = result.medianMinutesToAfford[perk];
      expect(minutes, perk).toBeGreaterThan(target * 0.8);
      expect(minutes, perk).toBeLessThan(target * 1.2);
    }
  });

  it('is deterministic for a seed', () => {
    expect(simulateEconomy(data, { runs: 20, hours: 1, seed: 'repeat', pettingBias: 0.5 })).toEqual(
      simulateEconomy(data, { runs: 20, hours: 1, seed: 'repeat', pettingBias: 0.5 }),
    );
  });
});
