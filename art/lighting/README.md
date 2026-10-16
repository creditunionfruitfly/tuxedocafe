# Cafe lighting

`cafe-daylight.json` is an original Blender Cycles bake: a shared 2048² UV1
atlas, RGBM HDR irradiance PNG, three room probes, and physical bake metadata.
The compressed float32 UV layout lives in the manifest; PNG base64 is split
into `sources/lightmap-*.json` chunks of at most one million characters so
normal builds reproduce the exact authoring result without installing Blender.
`applyCafeLightBake` rejects stale geometry, mean material albedo, or emission.
Movable water/food bowls and the scoop are excluded from the static bake.

## Reproduce

Use official Blender 4.0.2 or a compatible later release with Cycles CPU.
NumPy is included in official Blender distributions. The Ubuntu package build
also works with Python 3.12 NumPy; OpenImageDenoise is not required.

```bash
ART_BAKE_EXPORT=cafe-input.json ART_UNCOMPRESSED=1 node --input-type=module -e "import('./art/env/cafe/generate.ts').then(m => m.makeCafe())"
blender --background --python tools/art/bake-probe-calibration.py
blender --background --python tools/art/bake-cafe.py -- cafe-input.json art/lighting/cafe-daylight.json 2048 96
npm run assets
```

Cycles traces six diffuse bounces at 96 fixed samples, seed 2718, with direct
and indirect diffuse enabled and surface color excluded. Source average PBR
albedos remain in the scene for colored secondary bounces. Soft daylight enters
through the existing window, with an original procedural world, a warm sun and
three pendant emitters. Contact occlusion follows real ray visibility; there
is no painted shadow mask, downloaded HDRI, or extra AO multiplier.

## Runtime contract

- `art/lighting/cafe-daylight.png`: `NoColorSpace`, `flipY=false`, `channel=1`.
  UV1 is exported with glTF's top-left image origin; baked UV0 is untouched.
- `art/lighting/cafe-daylight.json`: `{signature,resolution,exposure,probes,metadata}`.
  `PNG.rgb * PNG.a * exposure` recovers linear irradiance; `metadata.encoding`
  is `rgbm`. This preserves shadow precision despite nearby bright pendants.
  RGBM bilinear/mipmap filtering is approximate; packed margins and 8px bake
  dilation contain cross-island bleeding. Cycles diffuse outgoing
  radiance is multiplied by PI before encoding, matching Three's Lambert BRDF.
- Static primitives carry `extras.bakedDaylight=true`. Their runtime diffuse
  direct, ambient, probe and image-based terms must be suppressed; the atlas
  already includes those sources. Keep direct and environment specular terms.
- Movable props and the arm receive runtime direct light plus room probes.
  Each probe has `{position:[x,y,z],sh:[[r,g,b] × 9]}`. SH9 coefficients are
  linear incident radiance in the exact Three `SphericalHarmonics3` basis,
  +Y up, with no cosine convolution or PI multiplier applied to the coefficients.
- The runtime sun points from `[-1,6,-8]` toward `[0,.7,-1]`. Probe captures
  include its reflected room bounce. There is no camera-visible solar disk,
  so the separate dynamic direct key is not counted twice.

The calibration fixture renders separate RGB emitters at +X, +Y and -Z;
their recovered radiance centroids must match each axis with dot product >.99.
