# Master cat build and visual QA

Run `npm run assets` at the repository root to recreate the three runtime GLBs,
the review-only high-density GLB, atlas guides, and `cat_master_qa.json`. The
source sculpt cache (`cat_master_source.bin`) is optional and self-invalidates
when its input source changes; `CAT_REBUILD_SOURCE=1 npm run assets` extracts the
sculpt from the original procedural field. Generated GLBs, PNG guides and
screenshots have provenance sidecars. They are build products, not edited source.

Run `node tools/art/check-cat-weights.ts` for semantic weights, bind matrices,
morph names, blink clearance and budgets. Run
`CHROMIUM_PATH=<chromium> node tools/art/review-cat.ts --deliverables art/cats/master/notes/screenshots`
for the Desktop and Low phone look-dev set. Face and closed-blink close-ups are
also captured with `views=face,eyeClose,mouth,mouthSide` and
`morphs=blink_L:1;blink_R:1` respectively. The review page accepts
`clip=cat.loco.walk&at=.28` and `anim=/public/assets/art/cats/cat_anims.glb`
to sample authored animation on the actual skinned mesh.

The 2026-10-17 build passed glTF-Validator with zero errors/warnings per GLB.
The original high-density sculpt has 222,429 review triangles. Runtime totals
include all body and detail meshes:

| LOD | Triangles | Limit | Draws | GLB bytes | Body vertices |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 28,701 | 30,000 | 13 | 1,453,624 | 13,368 |
| 1 | 11,680 | 12,000 | 9 | 750,596 | 5,807 |
| 2 | 3,736 | 4,000 | 2 | 423,964 | 2,360 |

All three files contain the same 65 joint names/order and inverse bind matrices,
four normalized influences per body vertex, and fourteen named morph targets.
The body is one connected manifold with two eyelid boundary loops; its source
has zero non-manifold edges, vertices or inverted face windings. There are 42
packed UV islands and 2,572.65 atlas pixels per metre at 2048 resolution.
LOD1/2 UVs inherit LOD0 coordinates. The body atlas and semantic surface guide
are stable across the final facial color/fairing changes.

The screenshot set covers turntable, face, mouth, paws, weight colors, extreme
rig pose, UV checker, flow/length attributes, source sculpt and wireframes.
The eye lids visibly close over separate globes. Walk, sit, curl and yawn
deformation can be rendered from the animation GLB; clip quality is owned by
the animation task. The source orbit has a pronounced lower rim at close range,
and the small nostrils remain angular under extreme zoom. Further anatomical
re-sculpting would require re-unwrapping, so it needs coordination with the
resident coat textures that use this atlas.
