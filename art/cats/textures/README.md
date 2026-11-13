# Resident coat and eye textures

Seventeen original built-in image-generation runs created eight iris maps,
eight coat atlases and one shared fur microstructure source. Exact templates and
resident variables are in `eye-prompts.json`, `body-prompts.json` and
`fur-micro-prompt.json`. The cat identities, colors and lengths follow
`data/cats.json`; no third-party artwork was used.

The tool returned 1254 × 1254 native images. The desktop 2048² body copies are
technical resamples, not native 2K generation. Phone bodies are 1024², irises
512², shared normals 512², roughness and strand reference 256².
Encoded source chunks include byte counts, SHA256 hashes and provenance.
`generate.ts` verifies and decodes these files without network or Python in CI.
`prepare.py` is the authoring path; its NumPy/SciPy/Pillow dependencies are not
runtime dependencies. The café uses JPEG and PNG maps for the original cast
and loads Juniper's GPU-ready body, normal and iris maps on demand.

## Mochi's coat and face

Mochi's body maps use the current master UV0 atlas from
`art/cats/checkpoints/latest/atlas.json.json`. The white blaze follows the nose
bridge and tapers between the eyes. White spotting in the red mask channel
includes the blaze, two small muzzle patches, chin and chest bib, and socks.
The pink split between the charcoal nose lobes is leather pigment in the albedo.

`mochi/body-{2048,1024}.ktx2` and `mochi/eye-512.ktx2` use sRGB ETC1S.
`mochi/coat-{2048,1024}.ktx2`, `mochi/flow-1024.ktx2`, and
`mochi/strand-256.ktx2` use linear UASTC. All have full mip chains. The flow
map stores a rest-space tangent in RGB. Remap to `[-1, 1]`, normalize and
skin the direction with the rest of the surface. The strand map tiles in both
axes with fibers running in V. Sample the red channel for density.

## Juniper's coat and eyes

The ten runtime maps under `juniper/` preserve the current-master and shared
KTX2 files from `Juniper_Body_Review.zip` byte for byte. The body and estimated
tangent-space normal use 2048² textures on desktop and 1024² on phones. The
left iris is amber and the right iris is ice blue, both at 512². The low LOD
selects the iris from the eye joint on the single batched globe mesh.

Inspect the coat with `?lookdev=cat&cat=juniper` and the face with
`?lookdev=cat&cat=juniper&view=face`. The RGBA masks, rest-space flow and
strand density maps are available for the fur renderer.

## UV registration and normals

Body UV v increases down the PNG; three.js uses `flipY=false`. Hidden seams,
anatomical chart labels, densities and final atlas hashes come from the master
mesh notes. Final facial sculpting preserves the generated paint through the
exact rest-surface transfer described in `REGISTRATION.md`. `painted-v1/`
retains the original registered coat bitmaps and native generation hashes.
The final transfer report records source/target identities and measured errors.
Semantic masks are regenerated from the final rest-position and normal guides.

Three-pixel nearest-surface bleed stays inside the six-pixel atlas gutters.
Non-fur texels are white, preserving anatomical material/vertex tints when the
lower LOD merges skin, nose, pads and mouth regions into its body draw.
Iris UVs use a centered radial front cap, limbus radius 0.42, with dark bleed.
Each eye is separate spherical geometry behind the open eyelid aperture; cornea
geometry supplies highlights. The images contain no painted corneal glints.

Albedo and iris maps are sRGB. Normal, roughness, coat RGBA and strand maps are
linear data. Shared normals are OpenGL tangent-space (+Y), estimated from
band-limited generated microstructure, with flat normals outside fur charts.
They describe microstructure only; exported geometric normals, tangents and
morph normal deltas remain authoritative. Roughness is also estimated, not a
measured scan. Runtime normal strength is deliberately restrained.

## Rendering handoff

`coat.png` channels are R white spotting, G tabby/rosettes, B orange-black split,
A fur length divided by 35 mm. Preserve anatomical fur flow across mirrored limbs
and hidden seams. These masks are available on demand; the current standard
material samples the original generated albedo. The next fur renderer should
sample masks, palette and master flow attributes, add root/tip variation and
clumped shells/cards, and avoid baking lighting into coat color. Duchess needs
her long chest/tail ruff; Pixel needs short glossy strands; Juniper needs subtle
Bengal glitter. Their geometric scale/proportion and eye parameters remain
resident data rather than destructive edits to the shared master rig.

Validate both desktop and Low phone, all eight residents, all three LODs, neutral
and animated faces, blink closure, seam continuity, clay and textured modes.
Behavior, welfare and SFX playback are subsequent work; this asset phase emits
typed animation events silently.
