# Mesh and rendering contract

The base surface is complete before fur. Fur shells use the skinned body,
`_FURFLOW` and `_FURLENGTH`; length is shortest around nose/pads and longer on
trunk, cheeks and tail. Shell offsets must use deformed normals and normalized
flow. Ear/cheek/chest/tail cards are a later M3 asset, not hidden repairs.

LOD0 partitions body faces into cat_fur, cat_nose_leather, cat_paw_pads,
cat_inner_ear and cat_mouth. LOD1/2 batch them into one body primitive, preserving
the neutral surface tints in COLOR_0 and integer IDs in `_SURFACE` (0–4). LOD0
also carries COLOR_0: its neutral nose, pads and inner-ear colours are blended
over several millimetres at the vertices, while separate material partitions
retain their roughness and surface identity. The nose, lid and lip geometry is locally
faired after atlas generation, without moving atlas UVs or changing chart IDs.
The runtime changes resident nose/pad tints using that ID rather than recolouring
the whole animal. UV0 remains identical at surviving vertices across LODs.

Each LOD has the same 65 joints in skeleton.json order, parent-local rest
transforms and inverse bind matrices. Up to four normalized influences blend
the torso and limb roots; plantar pads are rigid to the paw so they retain
their contact plane. Named blink/squint morphs move the existing lid surface
around the globe, keeping a positive globe clearance. Eye rotation is skeletal.

The jaw joint owns hinge rotation. The mouthOpen morph adds lip roll and corner
stretch; it does not repeat the jaw rotation. A full yawn therefore combines
the jaw track with that morph. Teeth, gums and tongue follow jaw/head weights.
Whiskers follow their paired whisker joints; ear flattening supports the two
ear morphs and skeletal ear articulation.

Separate eye spheres and cornea domes on LOD0/1 support iris maps, sharp
highlights and later parallax/eye shine. LOD2 keeps both UV-mapped eye spheres
batched in one cat_eyes primitive with separate eye-joint weights, drops the
cornea and tiny oral/claw/whisker parts, and needs two base draw calls total.

Soft wrap/rim/sheens may use the smooth deformed surface normals and flow.
Actual thin ear shells support backlighting; a later thickness map can modulate
it. Outlines can use the body surface; exclude clear cornea from inverted hulls.
Contact shadows use the paw bones and body footprint, never baked black patches
in the albedo. The cat remains a dynamic object under café probes and key light.
