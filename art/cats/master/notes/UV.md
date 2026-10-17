# Master cat UV0

The atlas is shared by all three LODs. LOD1/2 simplify the already split LOD0
surface with UVs as preservation attributes; they never re-unwrap or repack.
`atlas.json` contains exact positions, indices, UVs, per-face chart and surface
IDs, packed rectangles, and measured texels per metre for reproducible painting.

PNG row zero corresponds to glTF UV v=0. Load generated maps with
`texture.flipY=false`. Coordinates in `atlas.json` and guide images use that
same convention. Body maps are 2048² desktop and 1024² phone. Gutters are six
desktop pixels on each side of a chart; extend painted colours into gutters
before mip generation. Charts use uniform area density before packing.

Chart names: head, muzzle, ear_L/R, torso, foreleg_L/R, hindleg_L/R,
frontpaw_L/R, hindpaw_L/R, tail, mouthUpper, mouthLower, clawSheath. Material
boundaries create additional islands within those chart names. Hidden cuts run
along the ventral torso, medial limbs and underside of the tail; head cuts
connect the neck opening to muzzle/eye/ear boundaries. Every inner boundary is
connected to the outer boundary before a conformal disk parameterization.
Uniform-area scaling, rotation and shelf packing preserve positive UV winding.

`uv_template.png` colours anatomical charts. `uv_surface.png` stores exact
integer IDs in R (0 fur, 1 nose, 2 pads, 3 inner ear, 4 mouth) and chart ID in G;
alpha is zero outside the surface. `uv_position.png` and `uv_normal.png` encode
object-space positions/normals; use the decode formulas in `atlas.json`.
The JSON geometry is authoritative when higher precision is needed.

Eye UV0 is a separate polar front cap: optical-axis centre (0.5,0.5), iris
limbus radius .42 at angular radius 1.0 radian. The hidden rear globe maps
through the outer .42–.50 annulus. Each eye has its own rigid eye-joint weights.
LOD2 batches both globes in one primitive without changing either eye's UVs or
weights. The cornea dome is separate on LOD0/1 and omitted on LOD2.
