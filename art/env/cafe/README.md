# Conservatory cafe source

`generate.ts` is the original, deterministic source. Run `npm run assets`.
The environment uses 93,920 triangles, meshopt-compressed geometry, shared
material batches and no downloaded textures. M3 adds baked lightmaps/probes.

Coordinates in meters: room x −5…5, z −5…3; entry (0, 1.6, 2.2).
Counter x −4.6…−1, z −4.65…−3.75; sink (−2, 1.1, −3.68).
Water bowl (1.4, 0, −0.7), food bowl (1.9, 0, −0.7), contact-point pivots.
Tables centered at (−2, .76, −.6) and (.5, .76, −3.1), radius .66.
Cat tree (3.7, 0, −2.2), three cushioned platforms.
Two litter trays at (4.25, 0, −3.6/−4.3), bin and scoop.

Static geometry is merged by material. Moving bowls and the scoop keep separate named nodes.
The planted courtyard adds depth beyond the window. Other nodes use world-space vertices with identity transforms. Neither geometry
nor lighting conveys a completed M2 cat simulation. All motifs are original.
