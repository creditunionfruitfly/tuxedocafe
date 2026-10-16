# M2-4 Resident cat models

Role: master
Status: Data in place; instancing lands with M2-3
Budget share: outside the Codex allowance (Claude Code)
Read: README Resident cats; `data/cats.json`; `data/cat-builds.json`

## Result

Every resident cat instances the master mesh with its own build, proportions, static shape
morphs, eye colour, leather colours and a coat description. Once texture generation is back the
Artist paints each cat's RGBA coat mask, base colours and eyes from these descriptions and the
prompts in `art/cats/master/notes/PROMPTS.md`.

| Cat | Build | Distinguishing model data |
| --- | --- | --- |
| Mochi | adult | Reference build; green-gold eyes; tuxedo bib and socks |
| Waffles | chunky | Heavier torso, `bodyFat` 0.85, broader head; pink nose on a white muzzle |
| Pepper | adult, 0.95 | Slightly smaller, taller ears; green eyes; mackerel tabby |
| Biscuit | adult, 1.04 | Larger, `bodyFat` 0.25; amber eyes; orange classic tabby |
| Clementine | kitten | 0.6 scale, `headKitten`, large eyes and ears, short limbs; calico |
| Juniper | lithe | Long legs and spine, `bodyLean` 0.6; rosetted Bengal with glitter |
| Pixel | compact | Round head, very short coat, strong sheen; copper eyes |
| Duchess | senior, 1.02 | Long coat (28–35 mm), ruff and plume; pale blue eyes |
