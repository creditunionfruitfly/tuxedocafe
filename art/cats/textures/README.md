# Resident coat and eye textures

Seventeen original built-in image-generation runs created eight iris maps,
eight coat atlases and one shared fur microstructure source. Exact templates and
resident variables are in `eye-prompts.json`, `body-prompts.json` and
`fur-micro-prompt.json`. The cat identities, colors and lengths follow
`data/cats.json`; no third-party artwork was used.

The tool returned 1254 × 1254 native images. The desktop 2048² body copies are
technical resamples, not native 2K generation. Phone bodies are 1024², irises
512², shared normals 512², roughness and strand reference 256². There are 35
runtime maps including both body tiers and the future linear coat masks.
Encoded source chunks include byte counts, SHA256 hashes and provenance.
`generate.ts` verifies and decodes these files without network or Python in CI.
`prepare.py` is the authoring path; its NumPy/SciPy/Pillow dependencies are not
runtime dependencies. JPEG/PNG follow accepted ADR 0002; GPU-native KTX2 remains
an asset-pipeline follow-up.

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
