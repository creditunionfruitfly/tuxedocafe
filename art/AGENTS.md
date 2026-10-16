# art/: Artist conventions

- Sources live here, in Git LFS. Engine-ready output goes to `public/assets/art/` through `npm run assets`; never hand-edit the output.
- Layout: `cats/<cat-id>/`, `env/cafe/`, `env/sidewalk/`, `hand/`, `rig/skeleton.json`, `ui/`, and `STYLE.md`.
- Names (README, Asset pipeline spec): `cat_<id>_lod<0-2>.glb`, `hand.glb`, `env_cafe.glb`, `env_sidewalk.glb`; clips are `cat.<category>.<name>`.
- glTF 2.0 in meters, +Y up, facing +Z. Cats pivot at the floor, the hand at the wrist, props at their contact point.
- Budgets: cats 30k, 12k and 4k triangles; the hand 8k; the café 150k; the sidewalk 100k. Texture sizes per README.
- Every source and output file has a `<file>.prov.yaml` whose license is in `tools/provenance/allowlist.yaml`.
- Bone names and order come only from `rig/skeleton.json`; changing them needs an ADR.
- Runtime files go only under `public/assets/`. Anything else under `public/` would ship as an LFS pointer from CI.
- Generator prompts never name another work, artist or brand.
- Every pull request shows look-dev screenshots at Desktop default and Low phone.
