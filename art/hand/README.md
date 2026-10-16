# Patron hand source

`generate.ts` builds a 2,280-triangle, wrist-pivoted skinned hand with 16 joints,
three articulations per digit, and a separate sleeve material. Axes are +Y up,
+Z toward fingertips. Skin and sleeve materials are named for customization.
Clips: `hand.open`, `hand.stroke`, `hand.grab`, `hand.point`.

The M1 hand is a proportionate placeholder for interaction authoring; fingers
have rigid segment weights, with continuity refinement left for a later art pass.
All geometry and pose data are original. Rebuild through `npm run assets`.
