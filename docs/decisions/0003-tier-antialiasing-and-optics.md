# 0003: Resolve tier antialiasing and optics in one output pass

Desktop Default and High request eight coverage samples per output pixel; Phone
and Low Phone request two. The WebGL 2 canvas itself is single sampled. We use
the largest shared native sample count within the request for the selected color
format and DEPTH_COMPONENT24, also bounded by the context maximum. If the native
count falls short, the scene rasterizes into a finer grid and the output pass
integrates the covered texel area. Four native samples on a grid with twice
the pixel area therefore provide at least eight coverage samples per output
pixel at normal target sizes. This is supersampling plus MSAA, not native 8×
MSAA; the diagnostic attributes report both native count and actual density.
Before allocating, cap output DPR against GPU dimensions and a 320 MiB
desktop / 64 MiB phone target budget. This counts resolved and native color
and depth and keeps coverage density while shrinking unusually large buffers.

The scene is rendered once into linear RGBA16F. The output triangle resolves
coverage, applies Neutral tone mapping, and converts to sRGB. Desktop alone
samples the depth texture, uses a small depth-gated blur around play or close-up
focus, and adds slight color separation only at bright transitions. Desktop
MSAA uses Three r186's explicit matching-depth blit, with its optional
render-to-texture route disabled for that target. Phone tiers never allocate
sampleable depth or run the optics. The output triangle adds one draw to the
existing counters; adaptive resolution still governs target size.

Without renderable half float, use linear RGBA8 and Three r186's
`isXRRenderTarget` output-mode check to apply Neutral in the scene shaders
before quantization. The final pass then applies only the display transfer.
The optional half-float room reflection map is omitted on those devices;
the baked atlas, room probes and key light still run.

Register PBR extensions with `addMaterialPatch(material, { key, apply })`.
Patches run in registration order after the original hook. Use a stable key
that includes structural GLSL variants, and use uniforms for changing values.
The RGBM bake and probe patches both leave three.js's specular lighting in place.
