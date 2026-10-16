# Game data (Master)

Tuning lives here, not in code (AGENTS rule 6). Every file has a `version`; bump it when a field's meaning changes and migrate saves that depend on it.

| File | Holds | Read by |
| --- | --- | --- |
| `cats.json` | The resident cats: coat, age, personality, catnip and harness rules, hidden traits (0–1), petting-zone overrides, sleep hours, `voicePitch` for the shared cat sounds, `maxAffinityRange`, and a `model` block (build, overrides, eyes, leather, coat description and mask notes) | Cat AI, audio |
| `economy.json` | Chore payouts and timings, perk prices and durations, and the pacing `targets` that `npm run sim:economy` and `tests/sim/` check | Economy, the simulation |
| `chores.json` | Station thresholds and gesture settings | Chores |
| `animation-catalog.json` | The M2 clip contract: every clip's name, layer, loop, duration, `authoredSpeed`, paw contacts and events (`sfx:` events name audio event ids), the morph target list and expression curves | Artist (authoring), cat animation runtime |
| `cat-builds.json` | Bone groups and body builds (adult, chunky, kitten, lithe, compact, senior): uniform scale, per-group `length` and `girth`, static shape morphs | Cat instancing |
| `flags.json` | Feature flags for unfinished work: `{ "id", "milestone", "description" }`, all off by default | Flags (`?flags=`) |

**Hidden affinity caps.** The repository is public, so `cats.json` stores only a range per cat. Each save rolls the real cap, `Amax`, inside that range from the save's seed, so no player can look it up.
