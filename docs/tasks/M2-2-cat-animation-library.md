# M2-2 Cat animation library

Role: artist
Status: In progress (Claude Code session)
Budget share: outside the Codex allowance (Claude Code)
Model tier: highest available (motion quality)
Read: README Animation spec, Cats: behavior spec; M2-0; `data/animation-catalog.json` (the contract)

## Result

Every clip in `data/animation-catalog.json` (52 first-playable and additive clips plus the 15 perk
clips), authored on the shared skeleton at 30 fps, rich and behaviourally realistic: weight shifts,
overlapping action, follow-through, asymmetric timing and real gait footfall order rather than
equal sine waves.

## Deliverables

- `art/cats/anim/` generator source (procedural keyframes, deterministic, original) that
  `npm run assets` turns into `public/assets/art/cats/cat_anims.glb`: the skeleton plus bone tracks
  only, clip names exactly as catalogued. Locomotion is in place with `extras.authoredSpeed`;
  jumps keep root motion; contacts and events go in the clip's extras (and match the catalog).
- `public/assets/art/cats/cat_expressions.json`: morph-weight curves for the catalog `expressions`.
- Additive clips are authored as offsets from the reference pose noted in the file.
- Reference: there is no filmed footage in this session. Record in provenance that motion follows
  published feline gait and behaviour descriptions, with no third-party footage.
- Checks: every catalogued clip exists, durations match, loops close seamlessly, no NaNs, bone
  rotations stay within anatomical limits, planted paws do not slide during stance.

## Acceptance

```bash
npm run assets && npm run check
```
