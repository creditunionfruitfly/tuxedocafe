# Game data (Master)

Tuning lives here, not in code (AGENTS rule 6). Every file has a `version`; bump it when a field's meaning changes and migrate saves that depend on it.

| File | Holds | Read by |
| --- | --- | --- |
| `cats.json` | The resident cats: coat, age, personality, catnip and harness rules, hidden traits (0–1), petting-zone overrides, sleep hours, `voicePitch` for the shared cat sounds, and `maxAffinityRange` | Cat AI, audio |
| `economy.json` | Chore payouts and timings, perk prices and durations, and the pacing `targets` that `npm run sim:economy` and `tests/sim/` check | Economy, the simulation |
| `chores.json` | Station thresholds and gesture settings | Chores |
| `flags.json` | Feature flags for unfinished work: `{ "id", "milestone", "description" }`, all off by default | Flags (`?flags=`) |

**Hidden affinity caps.** The repository is public, so `cats.json` stores only a range per cat. Each save rolls the real cap, `Amax`, inside that range from the save's seed, so no player can look it up.
