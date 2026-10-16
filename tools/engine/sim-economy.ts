// npm run sim:economy [-- --runs 2000 --hours 3 --seed tuxedo --bias 0.5]
// Replays economy pacing against data/economy.json and compares it with the targets there.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { simulateEconomy, type EconomyData } from './economy-sim.ts';

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '2000' },
    hours: { type: 'string', default: '3' },
    seed: { type: 'string', default: 'tuxedo' },
    bias: { type: 'string', default: '0' },
  },
});

const data = JSON.parse(readFileSync('data/economy.json', 'utf8')) as EconomyData;
const result = simulateEconomy(data, {
  runs: Number(values.runs),
  hours: Number(values.hours),
  seed: values.seed,
  pettingBias: Number(values.bias),
});

const t = data.targets;
const row = (label: string, value: number, target: number, unit = ''): string =>
  `${label.padEnd(26)} ${value.toFixed(1).padStart(6)}${unit}   target ${target.toFixed(1)}${unit}`;

console.log(`Economy pacing: ${values.runs} runs of ${values.hours} h, seed "${values.seed}", petting bias ${values.bias}`);
console.log(row('Income (C$ per hour)', result.medianIncomePerHour, t.incomePerHour));
console.log(row('Time on chores', result.medianChoreShareOfTime * 100, t.choreShareOfTime * 100, '%'));
console.log(`${'Chores left to staff'.padEnd(26)} ${(result.medianMissedShare * 100).toFixed(1).padStart(6)}%`);
for (const [perk, minutes] of Object.entries(result.medianMinutesToAfford)) {
  console.log(row(`Minutes to afford ${perk}`, minutes, t.medianMinutesToAfford[perk] ?? Number.NaN));
}
