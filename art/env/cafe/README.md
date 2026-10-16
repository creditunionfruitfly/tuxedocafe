# Conservatory cafe source

`generate.ts` is the original, deterministic source. Run `npm run assets`.
The environment uses 126,836 triangles, meshopt-compressed geometry and 57 shared
material batches, below the 150k-triangle and 80-draw Phone limits before the hand.
Every emitted surface has a material and finite meter-scaled UV0; static surfaces
receive a separate UV1 atlas for the offline daylight bake. Original oak, fabric,
stone, sisal and metal surface maps replace flat-color shading. Run the source
build to print the exact triangle and byte budgets; the cafe hard limit is 150k.

Coordinates in meters: room x −5…5, z −5…3; entry (0, 1.6, 2.2).
Counter x −4.6…−1, z −4.65…−3.75; sink (−2, 1.1, −3.68).
Water bowl (1.4, 0, −0.7), food bowl (1.9, 0, −0.7), contact-point pivots.
Tables centered at (−2, .76, −.6) and (.5, .76, −3.1), radius .66.
Cat tree (3.7, 0, −2.2), three cushioned platforms. The main sisal post reaches
1.745 m, overlapping the top deck underside at 1.730 m. The short post reaches
.605 m, overlapping the low deck underside at .580 m. Upholstered cushions and
their piping overlap their wooden decks, rather than hovering above them.
Two litter trays at (4.25, 0, −3.6/−4.3), bin and scoop.

Static geometry is merged by material. Moving bowls and the scoop keep separate named nodes.
The planted courtyard adds depth beyond the window. Other nodes use world-space vertices with identity transforms. Neither geometry
nor lighting conveys a completed M2 cat simulation. All motifs are original.

R1 joinery uses closed bentwood chair backs, inset padded panels and continuous
rear legs that pass through the seat shell into the back. Seat piping, brass
stretchers and foot glides retain detail close to the player. Each table has a
mounting socket joining its pedestal to the top and its weighted foot. The tap
is a single swept goose-neck tube joined to the base and nozzle, with a lever
and aerator. The banquette back meets its seat; shelf brackets, leaf petioles,
espresso controls and its drip grate finish the supporting geometry.
Painted fixtures use `paintLagoon` / `paintTeal`, separate from the identically
colored upholstery. Foliage uses its own vein textures. Oak grain follows the
long plank axis on floors and the vertical axis on the slats and chair supports.

`geometry-qa.ts` checks actual transformed member bounds before material
batching, verifies posts terminate inside deck footprints, and rejects absent or
non-finite UVs. These assertions run with `npm run assets`. Real plank expansion
seams, upholstery seams, cup openings and designed spaces between furniture are
intentional; structural gaps at load-bearing joins are rejected.

Daylight is generated offline through `tools/art/bake-cafe.ts` and
`tools/art/bake-cafe.py`. `ART_BAKE_EXPORT=/tmp/cafe-input.json npm run assets`
exports source geometry for a new bake; normal builds require its matching
geometry signature. Moving bowls and the scoop stay out of the static lightmap.
