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
The original high-density sculpt has 222,425 review triangles. Runtime totals
include all body and detail meshes:

| LOD | Triangles | Limit | Draws | GLB bytes | Body vertices |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 28,699 | 30,000 | 13 | 1,447,164 | 13,379 |
| 1 | 11,679 | 12,000 | 9 | 745,684 | 5,801 |
| 2 | 3,736 | 4,000 | 2 | 422,588 | 2,360 |

All three files contain the same 65 joint names/order and inverse bind matrices,
four normalized influences per body vertex, and fourteen named morph targets.
The body is one connected manifold with two eyelid boundary loops; its source
has zero non-manifold edges, vertices or inverted face windings. There are 42
packed UV islands and 2,628.02 atlas pixels per metre at 2048 resolution.
LOD1/2 UVs inherit LOD0 coordinates. The body atlas and semantic surface guide
are frozen by the committed `atlas.json`; the face and source guides were
regenerated after revising the eyelid orbit and closed-rest chin.

The screenshot set covers turntable, face, mouth, paws, weight colors, extreme
rig pose, UV checker, flow/length attributes, source sculpt and wireframes.
The eyelids visibly close over separate globes. The neutral clay close-up has
a narrow lip seam with no exposed teeth; the labeled 30-degree jawOpen clay
comparison exposes modeled gums, canines and tongue. The nose nostril cuts
remain angular under extreme zoom, and the rest bind pose leaves the hind paws
above the floor; the locomotion and rest clips supply their grounded poses.
Walk, sit, curl and yawn deformation is rendered from the animation GLB; clip
quality is owned by the animation task. Any further anatomical re-sculpting
requires coat reprojection onto a new atlas.
