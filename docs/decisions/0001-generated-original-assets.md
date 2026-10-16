# ADR 0001 · Build deterministic original assets in CI

Accepted 2026-10-16 by Master; Engine review required before merge.

The initial cafe, hand and capsule cat are entirely deterministic geometry.
Their source generators and canonical skeleton are ordinary text. Build them
through `npm run assets` before checks and every production/release build,
rather than committing generated GLB files through LFS. The build validates
provenance, glTF correctness and geometry budgets; repeat runs must be identical.
The original small SoundFont is likewise generated from its sample-authoring
script, using Python and ffmpeg, before audio validation.

This avoids redundant binary history and supports the GitHub plugin's text
workflow without requiring local push credentials. Authored Blender, textures,
recordings and later model sources continue to use the existing LFS rules.
No renderer, phone budget or skeleton convention changes.
