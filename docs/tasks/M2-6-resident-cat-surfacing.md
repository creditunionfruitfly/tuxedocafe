# M2-6 Resident cat surfacing and review

Role: artist
Status: In progress
Budget share: M2; exact usage unavailable in this environment
Read: README Rendering spec, Asset pipeline spec, Resident cats and Performance budgets;
M2-1, M2-2, M2-3, M2-4; data/cats.json; art/cats/master/notes/

## Result

Finish the shared master mesh and animation handoff from PRs #28–#30, then give
all eight residents their own generated coat and eye maps. Keep an untextured
clay review mode. The behavior and welfare engine remains the following phase.

## Texture contract

Runtime files live under `public/assets/art/cats/textures/` and are decoded from
checked-in original texture sources by `art/cats/textures/generate.ts`.

- `<id>/body-2048.jpg`: Desktop sRGB coat albedo on the verified shared body atlas.
- `<id>/body-1024.jpg`: Phone sRGB coat albedo on the same atlas.
- `<id>/coat.png`: linear RGBA white spotting, tabby/rosettes, orange/black split,
  and normalized fur length. Preserve the chart-specific fur direction.
- `<id>/eye.png`: 512 px sRGB iris, centered at (.5,.5), limbus radius .42;
  radial front-cap UV on separate spherical eyeballs. No painted corneal glints.
- `shared/fur-normal.png`: OpenGL tangent-space microstructure, linear data.
- `shared/fur-roughness.png`: linear roughness. Estimated maps are documented
  as estimates, never as measured scans.
- `shared/strand.png`: 256 px strand reference for the later fur-shell renderer.

The atlas includes the required hidden seams, mouth, pads and inner-ear charts.
White non-fur pixels preserve anatomical vertex tint on merged lower LODs.
Texture preparation records native generation size, resampling, chart padding,
image prompts, source identity and provenance. No third-party art is introduced.

## Review and delivery

The Engine upgrades both `/?lookdev=cat` and the out-of-band viewer to preview
actual meshes, all catalogued clips, residents, LODs, IK and material modes.
The standalone viewer bundles its runtime and assets for use without CI or a CDN.
Refresh the attached viewer artifact after validating its actual production assets.

Acceptance: asset generation, typecheck/lint, provenance, complete clip and rig
validation, all resident/LOD deformation checks, motion review, Desktop and Low
renders, budget measurements, browser tests and reviewed PRs. Record hardware
frame-time measurements only when actual hardware was tested.
