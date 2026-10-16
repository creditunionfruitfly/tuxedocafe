# Tuxedo Cafe · art direction v0

The room feels like a small neighborhood conservatory: warm oak, cream plaster,
deep lagoon upholstery, brushed brass and terracotta. Rounded furniture and
generous clear paths make it inviting at standing eye height. Botanical forms,
fluted joinery, ceramic cups and repeated ceiling details give the room density
without visual noise. Keep counter and cat facilities recognizable silhouettes.

## Shape and scale

Meters, +Y up, +Z forward. Adult cats stand about 0.30 m at the shoulder with a
0.45–0.55 m trunk. The skull is rounded but the muzzle projects, the rib cage is
deeper than the abdomen, and shoulder blades slide independently. Paws are small,
oval and grounded; the hind leg has a visible hock. No human facial proportions.
Kittens use larger skull/eye ratios and short limbs; chunky adults add torso
volume without shortening the skeleton; seniors retain adult proportions.

The M0 capsule cat is a rig diagnostic, never the final character. M2's surface
must be anatomically continuous, dense around eyelids, lips, ears and toe pads,
and retain its silhouette across 30k/12k/4k triangle LODs on the shared skeleton.

## Surface

Fur grows from nose to crown, down cheeks, back along the trunk and toward each
paw. Short coats use 3–8 mm shells, chest/cheeks 10–18 mm, long hair up to 35 mm;
authored length masks control transitions. Darker roots and restrained warm tips
sit under a soft wrap ramp. Tufts belong at ears, cheek ruffs, chest and tail tip.
Desktop sheen follows flow rather than making the whole animal metallic.

Coat masks: R white spotting, G stripes/rosettes, B orange/black partition,
A length. Tabby markings follow anatomy, never ruler-straight stripes.
Juniper has broken rosettes and subtle warm sheen. Pixel has a very short coat
and broad glossy highlights, with enough fill to separate the black silhouette.
Eyes use independent cornea domes and fine eyelid rings, not painted circles.

## Interface

Sky #6EC6FF, Aqua #3DDBD9, Leaf #8BD450, Cream #FFF8EC,
Cocoa #5B3A29, Tuxedo #1E1E24. Glossy glass, rounded corners and a narrow
specular strip support the main 3D scene. Blur is disabled on Low phone.
Use a system humanist sans fallback until an OFL font is packaged. Text and
focus indicators retain strong contrast; actions never rely on color alone.

## Delivery

Procedural geometry is original source. Merge static geometry by material to
keep the cafe below 80 phone draw calls. Moving objects keep named nodes and
contact-point pivots. M1 uses vertex geometry and material colors; lightmap
bakes and fur are M3. No HDRI, texture or font is shipped without its license.
