# First-person hand and forearm

`generate.ts` authors a continuous palm, wrist and tapered forearm with sewn
finger and thumb openings, blended phalanx weights, anatomical webbing,
dorsal tendons, knuckles and individually crowned nails. A rounded cuff and
creased cloth sleeve cover the forearm through the elbow. It never uses
floating capsules for individual finger segments.

The wrist remains the origin, +Y is the back of the hand and +Z points toward
the fingertips. The forearm and sleeve extend toward −Z, reaching 35.5 cm
behind the wrist. The palm is approximately 7.5 cm wide and the full middle
finger reach is 16.6 cm from the wrist. Camera placement rotates +Z into camera
−Z so the arm points away from the player. Runtime mirrors the whole model for
the left-hand accessibility setting.

The existing 16 joints retain their names, order and translations-only rest
convention. Clips remain `hand.open`, `hand.stroke`, `hand.grab`, `hand.point`.
All three surfaces are closed oriented manifolds, checked by the generator;
the skin surface is one connected component across every palm/digit seam.

Each surface has UV0, base color, packed roughness and tangent-space normal
maps from the original material system. The named `skin` and `sleeve`
materials remain tintable; `nails` is a separate neutral keratin surface.
Texture provenance is recorded with the material sources. Rebuild via
`npm run assets`; the hand, nails and full sleeve share the 8k-triangle budget.
