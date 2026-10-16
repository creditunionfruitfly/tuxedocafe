# M2-1 Master cat mesh, eyes and LODs (untextured)

Role: artist
Status: In progress (Claude Code session; texture generation offline)
Budget share: outside the Codex allowance (Claude Code)
Model tier: highest available (anatomy, topology and skinning)
Read: README Animation spec, Rendering spec, Asset pipeline spec, Performance budgets; art/STYLE.md; M2-0; data/animation-catalog.json (morph list); data/cat-builds.json

## Result

One professional-quality, anatomically continuous, untextured adult master cat on the shared
65-bone skeleton, at three LODs, that every resident cat instances. It must read as a complete,
convincing cat from every direction with its base surface alone (M3 adds fur).

## Deliverables

- `art/cats/master/` generator source (procedural, deterministic, original) that `npm run assets`
  turns into `public/assets/art/cats/cat_master_lod0.glb` (≤ 30k triangles), `_lod1` (≤ 12k) and
  `_lod2` (≤ 4k). Budgets count every mesh in the file. Optionally a high-density source
  (`cat_master_source.glb`, 150k–300k triangles) for review only; the game never loads it.
- Nodes: `cat_body` (skinned, morphs), `cat_eye_L` / `cat_eye_R` (separate UV-mapped spheres bound
  rigidly to `eye_L` / `eye_R`), `cat_cornea_L` / `cat_cornea_R` (clear domes), mouth interior
  (gums, teeth, tongue), claws, whiskers. LOD2 may merge or drop small parts but keeps the eyes.
- **Open eyes:** the body has real eyelid apertures (an open hole ringed by upper and lower lid
  loops with thickness and a tear-duct corner) so the separate eyeball shows through. No painted
  eyes and no sealed sockets. Blink morphs close the lids over the eyeball without intersecting it.
- Skin: four normalized influences maximum, identical bind pose for all LODs, the exact joint
  order of `art/rig/skeleton.json`. Paw pads stay planted through shoulder and hip extremes.
- Morph targets on `cat_body`, named exactly as `data/animation-catalog.json` `morphTargets`
  (expressions plus the build shapes `bodyFat`, `bodyLean`, `headKitten`), on every LOD.
- UV0: a non-overlapping body atlas for the fur coat (charts for head, muzzle, ears, torso, legs,
  paws, tail) with roughly uniform texel density, seams in hidden places. Eyes: spherical UV with
  the iris and pupil centred at (0.5, 0.5). Custom per-vertex attributes for M3 fur: `_FURFLOW`
  (unit tangent of fur direction, nose to tail and down the legs) and `_FURLENGTH` (0–1 default
  length mask).
- Untextured materials with neutral base colours by surface: `cat_fur`, `cat_nose_leather`,
  `cat_paw_pads`, `cat_inner_ear`, `cat_mouth`, `cat_teeth`, `cat_claw`, `cat_eye`, `cat_cornea`,
  `cat_whisker`. A procedural (code-drawn, original) placeholder eye texture is allowed.
- Notes under `art/cats/master/notes/`: `UV.md` (atlas layout, chart list, texel density, seam
  placement, eye UV convention), `NORMALS.md` (smoothing groups, split normals, normal-map
  baking guidance and tangent space), `PROMPTS.md` (image-generation prompts for every texture:
  strand noise, flow map guidance, body base and RGBA masks per resident cat, eyes per cat, paw
  pads, nose leather, inner ear), and `RENDERING.md` (how this mesh supports each Rendering spec
  item: fur shells, fur cards, coat masks, eyes, wrap and rim shading, ear thickness, outlines,
  contact shadows).
- Provenance sidecars for every source and output; turntable and pose test screenshots.

## Skeleton

Names and order never change. If the rest positions in `skeleton.json` do not fit the spec
(0.30 m adult shoulder height, 0.45–0.55 m trunk), correct the rest positions in an ADR under
`docs/decisions/` and say so in the PR. The Engine derives all lengths from the bind pose.

## Acceptance

```bash
npm run assets && npm run check
```

Plus the asset checks (budgets, joint order, inverse bind matrices, normalized ≤ 4 weights,
required morphs) and screenshots at Desktop default and Low phone.
