# Surface normals and tangent space

The body is one manifold volume with genuine eyelid openings. Anatomical fields
are blended before extraction; torso, head, limbs, paw lobes and tail are not
intersecting runtime capsules. Surface-net vertices are projected to that field,
manifold defects repaired, and inverted folds relaxed and reprojected.

Area-weighted vertex normals are welded by position across UV/material splits,
so an atlas seam does not create a lighting seam. Morph normal deltas are
computed from the fully displaced surface for each of the fourteen targets.
The eyelid lining, mouth, ear shell and pads retain physical thickness rather
than relying on double-sided shading. Independent eye/cornea normals are smooth.

The exporter preserves Float32 metre-space positions, inverse binds, four
normalized skin weights, morph deltas and custom fur attributes. Only base
normals, UVs, colour and joint component width are quantized before meshopt
compression. Position quantization is deliberately excluded because it rewrites
inverse bind matrices separately for meshes and LODs.

Normal maps should be tangent-space +X right, +Y up, +Z outward. Bake against
this exact UV0 using MikkTSpace-compatible tangents (three.js can derive them
for its standard derivative-based normal mapping). Do not bake a directional
light, ambient occlusion or cornea highlight into fur normal maps. Dilate within
each chart before mip generation and inspect seams in the UV checker view.

`_FURFLOW` is a unit object-space tangent, orthogonal to the authored normal;
`_FURLENGTH` is the normalized default length mask. M3 must skin flow vectors as
directions, renormalize, and project onto the deformed tangent plane.
