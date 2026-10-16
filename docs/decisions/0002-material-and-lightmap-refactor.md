# ADR 0002: Original textured cafe and offline baked lighting

Status: Accepted for the owner-requested R1 refactor

The first cafe used flat palette materials and discarded UVs. Playtesting showed
floating structural details and an arm that behaved like a cursor. The owner
requests continuous geometry, proximity controls, photoreal materials and baked
environment lighting before the originally scheduled M3 work.

Retain authored geometry and deterministic exports, with full material UVs and
a separate non-overlapping bake atlas. Generate original texture families with
recorded prompts; reuse maps across compatible tinted materials to hold memory
and draw budgets. Bake indirect daylight offline and preserve its UV layout and
source signature as build inputs. Normal CI rebuilds and validates runtime
assets without requiring Blender. Movable props and the arm use dynamic lighting.

The phone limits remain unchanged. Offline source density and texture generation
do not authorize larger runtime meshes or a heavier first-play payload.

For this revision, generated albedo uses JPEG and data maps use lossless PNG
with ordinary glTF texture slots. This keeps browser decoding native and avoids
adding a runtime transcoder before it is validated. KTX2 remains the longer-term
asset target. Color/data spaces, mipmaps and the same payload/memory limits still
apply. Estimated microheight-derived normals are identified as estimates, never
described as measured scans. Compact encoded source inputs are tracked as text;
the build decodes and derives the real bitmap files before validation/export.
External premium mesh generation is not claimed: the available plugin search
did not expose a dedicated 3D mesh generation service. Artists author the actual
connected geometry and use the available image-generation tool for textures.
