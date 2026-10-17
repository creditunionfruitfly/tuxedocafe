# 0003: Correct the cat skeleton rest transforms

- Status: accepted, implementation already present in the M2 master mesh draft
- Decision: Artist + Engine
- Artist sign-off: M2 mesh Artist and M2 animation Artist, 2026-10-17 (parallel production review)
- Engine sign-off: M2 runtime Architect, 2026-10-17

The capsule diagnostic rig's original rest offsets produced an oversized torso and legs which could not support the intended adult cat proportions. The master mesh uses the corrected parent-local rest positions recorded in `art/rig/skeleton.json`: an approximately 0.30 m shoulder height, flexible five-link spine, anatomical fore/hind leg bends and a continuous twelve-link tail.

Keep all 65 bone names, parent relationships and skeleton order unchanged. The skeleton JSON remains the authoritative bind contract; all LODs and animation source files must be rebuilt against the same revision. Existing GLBs from the capsule rest revision are diagnostics and cannot be mixed into the master mesh production set.

The runtime derives segment lengths, bend planes, paw offsets, look axes and secondary link tips from each loaded bind pose. Resident build deformation is applied before those measurements. Clip translation offsets retarget relative to source and resident rest transforms. Tests read the skeleton contract rather than embedding the former rest coordinates. Bone rotations stay compatible only when both exports share the same local frames; a future orientation change must retarget them explicitly.

No name/order migration is needed and no save format changes. Measured `rigSpeed` in clip extras records stride fitting to this corrected rig; playback uses the requested speed divided by `rigSpeed` while gait selection retains the catalog thresholds. Additive clips are converted relative to their named `clip@seconds` reference before layering.
