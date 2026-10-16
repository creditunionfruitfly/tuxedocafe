# R1 Café refactor

Role: master
Status: In progress, owner-requested revision after M1 playtest

## Result

Replace the initial flat-color cafe presentation with fitted, textured geometry,
baked direct and indirect daylight and a first-person arm. Preserve the 150k cafe / 8k arm,
80 Phone draws and 20MB first-play budgets. This work does not start M2 cats.

## Role tasks

- Artist environment: continuous chair-back/seat supports, table pedestals and
  cat-perch posts; beveled joinery and detailed props; UV0 on every surface.
- Artist surfacing: generated original albedo textures, coherent PBR maps,
  material-scale UVs, sRGB albedo/non-color data, source prompts and provenance.
- Artist arm: continuous anatomical hand/wrist/forearm, canonical +Z fingers,
  existing wrist/finger rig and four poses, skin/sleeve customization.
- Artist lighting: actual offline ray-traced full diffuse irradiance bake on a
  non-overlapping second UV set; source signature prevents stale lightmaps.
- Engine: camera-attached forward-facing arm, bounded interaction reach,
  latched physical carry, proximity tap menus, calibrated floor-drag walking
  and double-click/tap jump-to with validated collision-free landings.
- Master: integrate the role work, validate budgets and desktop/Low phone
  screenshots, review independently, and publish through PRs targeting main.

## Control contract

`data/interaction.json` owns reach, gesture, movement and carry calibration.
WASD/arrows walk; floor dragging walks; right drag/two-finger drag look.
Double-click/tap jumps to a clear floor position within 5m when a walkable route
exists. Interactions require a reachable target; carrying remains attached to
the arm while moving, and filling requires the bowl at the tap and an explicit
menu action. Ordinary pointer movement cannot remotely transport a bowl.
Hold-toggle, left-hand layout, reduced motion and saved profiles remain working.

## Acceptance

1. Geometry tests verify structural joins, valid finite UVs and material maps.
2. Khronos validation has zero errors; counts and payload remain in budget.
3. Deterministic navigation/reach tests cover blocked and out-of-range targets,
   double-tap cancellation, carried-object persistence and valid placements.
4. Desktop and touch playtests walk to a bowl, carry it to the tap, fill it,
   return it, place it and pick it up again. No remote pickup/fill path remains.
5. Baked direct and indirect lighting and textures are visible on Desktop and Low phone;
   screenshots also show connected chairs/perches and the forward arm.
6. Assets, audio, check, build, PR CI, Pages and live browser tests pass.

The owner moved cafe texture/lightmap work forward from M3. Frozen milestone and
physical-device acceptance remain separate from this specific playtest revision.

The completed bake uses RGBM HDR plus calibrated SH9 room probes. Static
diffuse is evaluated once from the atlas; moving surfaces keep runtime direct
light and room bounce. The carry is calibrated to 1.32m high and .80m forward so the bowl rim
aligns with the attached hand rather than falling below the view.
