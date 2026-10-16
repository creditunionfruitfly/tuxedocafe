# M1-5 Café blockout, hand and art pipeline

Role: artist
Status: Waiting on M0-6
Budget share: 1.5% of week A
Model tier: GPT-6 Sol
Depends on: M0-6 (and M0-4's conventions)

## Goal

Real, if rough, geometry for the café and the hand, plus a first `npm run assets` that optimizes and validates it, so M1's interactions run against true proportions.

## Read

- AGENTS.md (golden rules 1, 4 and 8) and `art/AGENTS.md`
- README: Asset pipeline spec, Rendering spec (café lighting), Hand and controls spec (hand poses), Performance budgets

## Files to touch

- `art/env/cafe/`: blockout source, either Blender or a generator script. Include the room, counter, tap and sink, two tables, a cat tree with three perches, the window sill, food and water bowls, two litter boxes, and the bin.
- `art/hand/`: a placeholder hand rigged at the wrist with open, stroke, grab and point poses.
- `tools/art/build-assets.ts`: replace the stub. It exports or optimizes to `public/assets/art/env_cafe.glb` and `hand.glb` (gltf-transform: weld, dedup, prune, quantize, meshopt), runs glTF-Validator (zero errors), checks triangle budgets (café 150k, hand 8k) and copies the sidecars.
- `.prov.yaml` sidecars for every source and output.

## Done when

- [ ] The engine can load both files through `assetUrl()` (the Engine Engineer wires them up in M1-3 or M1-6)
- [ ] Look-dev screenshots at Desktop default and Low phone in the pull request
- [ ] `npm run assets` is repeatable: a second run changes nothing

## Acceptance

```bash
npm run assets && npm run check
```
