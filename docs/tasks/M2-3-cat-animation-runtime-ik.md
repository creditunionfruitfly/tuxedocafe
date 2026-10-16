# M2-3 Cat animation runtime, IK and instancing

Role: engine
Status: In progress (Claude Code session)
Budget share: outside the Codex allowance (Claude Code)
Model tier: highest available (IK and runtime architecture)
Read: README Animation spec, Architecture; M2-0 (Rig and animation contract); `data/animation-catalog.json`;
`data/cat-builds.json`; `data/cats.json` (`model` blocks); `src/AGENTS.md`

## Result

A cat rig runtime that plays every catalogued clip through the full stack, in order: locomotion
blend (idle, walk, trot, gallop with turn, start and stop; gait thresholds from the catalog),
full-body actions, additive layers, look-at, analytic two-bone leg IK with pelvis height
adjustment and paw planting on steps and slopes, CCD spine and neck with per-link limits, then
damped secondary springs for the tail and ears. Fixed 30 Hz simulation with interpolated render
poses; distant cats update animation and IK at a reduced rate without changing decisions.

## Deliverables

- `src/anim/`: mixer stack, layer weights, locomotion blend by speed with `authoredSpeed`
  rescaled by each cat's scale and leg length, two-bone IK, CCD IK, look-at, springs, expression
  curves driving morph targets (`cat_expressions.json`), and clip events surfaced as typed bus
  events (`sfx:` events are emitted for the behavior phase; nothing plays sound yet).
- `src/cats/`: instantiate a resident cat from `data/cats.json` + `data/cat-builds.json` on the
  shared master mesh (`cat_master_lod0-2.glb`) and `cat_anims.glb`, applying build `scale`,
  group `length` and `girth` (girth never propagates to children) and static morphs; LOD
  selection by distance and tier.
- `/?lookdev=cat` upgraded: master cat with a clip picker, LOD switch, resident-cat picker, IK
  and skeleton toggles. Unfinished in-game cat spawning stays behind a flag in `data/flags.json`
  (Master adds the flag).
- Unit tests for every module, including IK: reachable and unreachable targets, straight limbs,
  pole changes, step up and down, slopes; no NaNs, flipped joints or sliding planted pads.
  Deterministic replay at 30, 60 and 144 render fps. A smoke assertion for the lookdev cat.

## Acceptance

```bash
npm run assets && npm run check && npm run build && npm run test:e2e
```
