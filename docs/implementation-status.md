# Pre-M2 implementation status · 2026-10-16

Baseline: bf99bd6. The session prepares M0/M1 implementation, the requested
first-visit flow, and a detailed M2 production specification.

## Implemented

- Fixed30Hz core, typed events, tier probe/benchmark, dynamic resolution,
  landscape pause, base-path-safe version/asset handling, channel saves with
  corruption backup/migration, update notices and MSAA tier context selection.
- Original65-bone shared rig and capsule diagnostic, exact IK chain metadata,
  style direction and deterministic meshopt/Khronos-validated art generation.
- Original eight-bar MIDI, compact original SF3 authoring, schema/voice/marker
  checks, six validator tests, all31owner audio prompts/63takes pending.
- M1 candidate: title/splash, patron creation, saved profile/accessibility,
  modern detailed cafe and wrist-skinned hand, walk/look/lean, proxy hover,
  mouse/touch carrying and timed bowl-to-tap-to-mat water prototype.

## Evidence and bounds

The final cafe source has93,920triangles and a626.6KBGLB; hand2,280triangles/
28.9KB; capsule3,900triangles/34.2KB. All validate with zero glTF errors.
Repeat art builds are byte-identical. M0 independent local acceptance passes
38tests, production build, four browser smoke checks (two redundant mobile
site-file checks intentionally skipped). M1 has additional interaction tests
and desktop/Lowphone screenshots in the Engine PR/CI artifacts.

The SF3 is22.9KB, three presets. Real spessasynth offline playback rendered20s
with six peak voices and nonzero finite output. Runtime MIDI and fur are M3.
No owner cat recording was synthesized or replaced.

Software WebGL and phone emulation validate behavior and draw counts; they do
not establish physical-phone frame time, memory use or thermal stability.
Local live-network requests are blocked by DNS; GitHub Pages workflow live-smoke
is the independent online check. No frozen milestone snapshots are claimed.

## Open milestone exit gates

M0/M1 exit task files remain authoritative. Physical-device timing, owner Pages
protection/environment confirmation, and frozen /m0/ then /m1/ snapshots need
verification before their exit tasks can be marked Done. The private knowledge
sheet is not available; no content from it was invented. M1 can be reviewed as
an implementation candidate while these gates are open. M2 remains Planned.

The next cat is specified in docs/tasks/M2-0-cat-production-spec.md: dense source
sculpt,30k/12k/4k runtime LODs, continuous anatomy, expressive face, shared rig,
paw planting IK, locomotion contacts, independent utility AI and welfare gates.
