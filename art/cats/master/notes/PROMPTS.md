# Original texture authoring prompts

Use the exact final UV template and position/normal guides. Preserve chart
boundaries and orientation; no lighting, cast shadows, perspective, text,
decorative border or anatomy drawn over empty atlas space. All imagery is
original; do not reference a franchise, brand or named artist.

Body base, per resident: “Flat unlit close-up domestic-cat fur albedo in the
provided anatomical UV atlas. Follow the position and chart guides exactly.
Short, fine overlapping hairs follow nose-to-crown, cheek-to-neck,
shoulder-to-rump, down-limb and base-to-tail-tip growth. Paint this resident's
documented natural coat, soft pigment variation, and clean anatomical marking
transitions. No eyes, highlights, shadows or extra features in the body atlas.”
Repeat for each resident using data/cats.json's breed, colours and markings;
the body atlas is shared but the painted resident maps are distinct.

Coat RGBA, per resident: “Match the approved resident albedo in the exact same
atlas. R is white spotting coverage; G is tabby stripe/rosette coverage; B is
orange versus black pigment partition; A is normalized fur length. Treat these
as independent data channels, with soft antialiased edges and no light/shadow.”
Juniper requires broken natural rosettes; tortie/calico partitions follow the
resident reference; solid coats keep unused pattern channels black.

Eyes, per resident: “One centered original domestic-cat iris seen orthogonally,
no eyelids or surrounding face. Optical centre (.5,.5); circular limbus at .42
of image width, dark clean outer rim, fine radial fibres, subtle pigment flecks,
the documented resident iris colour and an upright narrow dark pupil. No baked
window reflection, catchlight, lettering or asymmetric lighting. 512 square.”

Strand noise: “Seamlessly tiling, neutral scalar fur strand density, fine varied
short hairs with sparse clumps, no visible repeating rosettes or directional
lighting; 256 square.” Flow guidance: derive tangent direction from `_FURFLOW`
and exact chart derivatives rather than hallucinating a colour flow map.

Nose leather: “Unlit cat nose leather microtexture, tiny irregular pores and
subtle creases, neutral grayscale, no nostril drawing or shadow; tileable.”
Paw pads: “Unlit soft feline paw-pad microtexture, fine irregular pebbled skin,
shallow creases, neutral grayscale and restrained roughness variation.”
Inner ear: “Unlit thin feline inner-ear skin with sparse short fine hairs,
delicate muted pink capillary variation, no blood, shine or cast shadows.”

Fur normals/roughness: “Tileable fine short domestic-cat fur microrelief,
restrained strand bundles and broad matte response, no deep rope-like grooves,
no baked light, neutral physically plausible material.” Convert height to
tangent normals in a recorded material-preparation step; preserve alpha/masks.
