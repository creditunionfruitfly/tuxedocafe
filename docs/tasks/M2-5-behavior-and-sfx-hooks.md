# M2-5 Needs, utility AI, touch welfare and SFX hooks (next phase)

Role: engine
Status: Planned; starts after M2-1 to M2-3 merge
Read: README Cats: behavior spec, Audio and music spec; M2-0 (Autonomous behavior and welfare contract)

## Result

Needs, a seeded utility scorer re-thinking every 0.5–2 s, behaviour trees for the M2 goals, the
navmesh with jump links and perch slots, and zone-sensitive touch with the overstimulation meter.
Clip events named `sfx:<event id>` (see `data/animation-catalog.json`) and behaviour-driven sounds
trigger the SFX player through the event ids in `audio/sfx/cat/manifest.json`; a missing file is
silent with its caption, never a substitute sound. The trigger code is complete in this phase even
while owner audio is pending.
