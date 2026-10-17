# Painted coat registration

The eight original generated coats were painted against the first verified
42-chart atlas. Final facial sculpting changed UV packing and facial positions.
The original registration atlas is retained in `registration-v1/atlas.json`,
with deterministic gzip/base64 chunks and a verified SHA256 of its source JSON.
The registered painted bitmaps are retained separately in `painted-v1/`.

`reproject.py` rasterizes final fur texels into rest-space positions and projects
each point onto the exact nearest old triangle in the same anatomical chart.
Centroid-sphere bounds include thin triangles omitted by a fixed k-nearest
centroid search. The original paint is sampled with barycentric UV coordinates;
unrelated islands, eye geometry and the mouth cavity cannot enter the transfer.
This is technical registration of the original art, with no new painted detail.

Authoring requires Python with NumPy, SciPy and Pillow. CI decodes the already
prepared runtime bitmaps in Node and requires no Python image dependencies.

```sh
python art/cats/textures/check-registration.py art/cats/textures/registration-v1/atlas.json art/cats/textures/generated/identity-transfer.npz
python art/cats/textures/reproject.py art/cats/textures/registration-v1/atlas.json art/cats/master/notes/atlas.json art/cats/textures/generated/final-transfer.npz
CAT_UV_TRANSFER=art/cats/textures/generated/final-transfer.npz python art/cats/textures/prepare.py
```

The full identity check covered 1,797,948 fur texels with a maximum UV error
below 0.001 pixels and a maximum rest-position error below 0.000000021 metres.
An explicit thin-triangle regression also guards the nearest-face search.
The final transfer JSON records both atlas identities and measured projection
distances. Regenerate the semantic coat masks from final guides before preparing
the final runtime files. JPEG/PNG follow ADR 0002's browser-native baseline.
