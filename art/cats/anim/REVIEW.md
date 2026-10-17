# Cat animation library review

All 67 catalog clips are original deterministic procedural animation sampled at 30 Hz on the corrected 65-joint rig. No footage, motion capture or third-party animation was used. Texture and final runtime IK reviews are separate from the animation-library checks.

The authored tail uses a common anatomical frame; each segment's rest offset receives its own basis before converting cumulative bends back into local rotations. This prevents the curved bind tail from adding an unintended second curl. Greeting tips use damped follow-through. Downward jumps retain elevated counterbalance through landing so the tail clears the ledge behind the hind paws.

## Reproduce

```bash
npm run assets
npm run check
CAT_REPORT=/tmp/cat-animation-report.json node art/cats/anim/generate.ts
PREVIEW_MESH=/absolute/path/cat_master_lod0.glb PREVIEW_OUT=/tmp/cat-motion-review node art/cats/anim/preview/preview.ts
PREVIEW_MESH=/absolute/path/cat_master_lod0.glb PREVIEW_MOTION=cat.loco.walk,cat.loco.gallop PREVIEW_OUT=/tmp/cat-motion-review node art/cats/anim/preview/preview.ts
```

`CHROMIUM_PATH` can select a local Chromium. Omit `PREVIEW_MESH` for a rigid volume proxy; those images are pose diagnostics, not evidence of production skinning. `catalog1`–`catalog9` cover every clip with three phase samples. Named sheets add side, front and top views; optional MP4s capture actual rendered frames at 30 fps. Missing clips fail the preview.

## Numerical review, corrected rest rig

The build validates every sampled pose, catalog event/contact/root-motion extra, additive reference, loop seam, and all catalogued stance intervals. Expression export covers all eight expressions and all four clips that declare morph tracks. Key reduction permits at most 0.0012 rad rotation error and 0.2 mm translation error; the following stance numbers describe the original 30 Hz samples before reduction.

| Measurement | Result |
| --- | --- |
| Clips / sampled poses | 67 / 3,790 |
| GLB keys / bytes | 51,812 / 1,276,536 |
| Khronos validator errors | 0 |
| Maximum quaternion length error | 1.51e-14 |
| Maximum planted toe drift | 0.0097 mm, wake stretch LF |
| Minimum catalogued swing lift | 22.94 mm |
| Maximum loop seam before closing final key | 0.1363 degrees |
| Elbow/stifle interior range | 24.00–169.73 degrees |
| Carpal flexion range | -49.39–150.01 degrees |
| Hock flexion range | -5.73–156.26 degrees |
| Maximum scapula/hip rotation | 62.03 degrees |
| Maximum proximal slide | 25.23 mm |
| Maximum tail rotation, including base | 84.05 degrees |
| Maximum neighboring local tail rotation difference | 44.92 degrees |

These are rig-space engineering checks against authored envelopes, not a veterinary joint-range measurement. The build also checks digit flexion, floor clearance and anatomically correct elbow/knee bend sides.

| Gait | Touchdown phases | Duty factor | Catalog speed | Fitted ground speed |
| --- | --- | --- | --- | --- |
| Walk | LH 0, LF .25, RH .5, RF .75 | .62 | .7 m/s | .580 m/s |
| Trot | LH+RF 0, RH+LF .5 | .45 | 1.6 m/s | 1.371 m/s |
| Gallop | LH 0, RH .1, LF .45, RF .55 | .30 | 3.5 m/s | 3.332 m/s |
| Walk away | LH 0, LF .25, RH .5, RF .75 | .60 | .85 m/s | .575 m/s |

`extras.authoredSpeed` preserves the catalog contract. `extras.rigSpeed` records the shorter stride physically reachable on this cat. Runtime must retime by the speed ratio or use this fitted speed, otherwise navigation introduces skating. These gaits use a specific repeatable footfall pattern; real cats vary timing and gallop lead. Stalk and harness gait use slower, longer stance support. Start/stop record their speed ramps, and jumps retain root travel with contact/landing markers.

Additive keys store **reference pose × offset**. Subtract the frame named by `extras.additiveReference` (`clip@seconds`) exactly once before additive playback; absolute keys are not raw quaternion deltas. Tail-up/down layers share the same anatomical authoring frame as full-body clips.

## Reference provenance

Published descriptions and findings informed the authored poses and timing. No source figure or motion sequence was traced or downloaded as animation data. Exact timing, pose envelopes and overlap are original choices for this rig.

- Kappel et al., *Ethogram of the Domestic Cat* (2024), DOI [10.3390/pets1030021](https://www.mdpi.com/2813-9372/1/3/21): behavior units, grooming, resting, social and play postures.
- Reis et al., *How cats lap: water uptake by Felis catus* (2010), DOI [10.1126/science.1195421](https://pubmed.ncbi.nlm.nih.gov/21071630/) and [MIT's study description](https://news.mit.edu/2010/cat-lapping-1112): brief tongue contact and rapid lapping; the authored loop uses four laps/s.
- Humphrey et al., *The role of cat eye narrowing movements in cat–human communication* (2020), DOI [10.1038/s41598-020-73426-0](https://www.nature.com/articles/s41598-020-73426-0): eye narrowing/closure as positive communication; slow blink includes a held closure.
- [*Stabilization of cat paw trajectory during locomotion*](https://pmc.ncbi.nlm.nih.gov/articles/PMC4137248/) (2014): paw trajectory and stance-duty descriptions; regular walking duty values around .60–.64. Retrieval of the full PMC page encountered a CAPTCHA; only indexed abstract/results were available here.
- [*The cat step cycle: Hind limb joint angles and muscle lengths during unrestrained locomotion*](https://onlinelibrary.wiley.com/doi/10.1002/jmor.1051410102): the accessible abstract describes analysis of walking, trotting, galloping, jumping and landing in eleven adult cats. Detailed numerical joint tables were not available and are not claimed as the source of the authored limit values.
