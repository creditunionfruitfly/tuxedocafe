# M2-0 Cat v1 production specification

Role: master
Status: Planned; starts after verified frozen M1
Budget share: M2, 30% of week A (unchanged)
Model tier: Per AGENTS: architecture/IK/scoring on the designated engineering tier

## Result

One original adult tuxedo cat with convincing volume from every direction,
expressive eyes and ears, anatomical paws, independent needs and accurate
body language. A dense source sculpt feeds three efficient runtime LODs.
No cat directly obeys a patron; needs → utility scorer → behavior tree.

## Model and surfacing contract (Artist)

- Editable source sculpt target 150k–300k triangles, with a clean continuous
  retopology. Source density does not change the runtime budgets.
- Runtime body/eyes/cards combined: LOD0 ≤30k, LOD1 ≤12k, LOD2 ≤4k triangles.
  Include silhouette, ear tips and paw/toe-pad volume at every LOD. Put density
  around eyelid and lip loops, muzzle, shoulder blades and hocks. No intersecting
  capsule body parts in the final model. Hide no eye or mouth defects behind fur.
- Adult standing shoulder height about .30 m; muzzle projects naturally, the
  rib cage is deeper than the waist and the spine flexes without a rigid hinge.
  No human shoulders, pelvis or facial proportions. Four separate toe lobes and
  retractable claws; front dewclaws. Jaw, nose, tongue and eyelids have depth.
- Shared exact 65-bone order/names/rest transforms in art/rig/skeleton.json.
  Four normalized influences maximum; all three LODs share the same bind pose.
  Preserve planted paw pads through shoulder/hip extremes. Changes need an ADR.
- Morphs: blink L/R, squint L/R, mouthOpen, noseWrinkle, cheekPuff,
  whiskerForward/back and earFlatten L/R. Eye rotation remains skeletal;
  pupils react to lighting/arousal without becoming a substitute for behavior.
- Body RGBA mask: white spotting / tabby / orange-black partition / fur length.
  Desktop body 2048², phone 1024², flow 1024², eyes512², strand256²; full mipmaps,
  KTX2 ETC1S color and UASTC normals/masks/flow. Fur runtime is M3; M2 must read
  clearly as a complete cat with its base surface alone. Record all provenance.
- GLB meters, +Y up, +Z forward, root at floor; meshopt compression and zero
  Khronos validator errors. Provide turntable and pose/weight test screenshots.

## Rig and animation contract (Artist + Engine)

The skeleton has pelvis, spine01–05, two neck joints, head/jaw, paired two-joint
 ears, eyes/whiskers, scapula-to-digit fronts, hip-to-digit hinds and tail01–12.
Use the JSON's actual underscore names, never reconstructed aliases.

Leg solve targets are paw-pad contact points with offsets to wrist/hock.
Analytic two-bone solves use the upper/fore/wrist front chain and thigh/shin/hock
hind chain; the distal paw offsets are solved afterward. Derive rest axes and
segment lengths from the bind pose. Pole targets stay outside the body and
joints have anatomical limits; clamping prevents inverted knees/elbows.
Support planes include steps, slopes and perch tops. Lock stance feet, release
on swing, blend reach weight around touchdown and adjust pelvis smoothly.
Never stretch a limb beyond its segment lengths or teleport the body to a foot.

Use AnimationMixer base locomotion/full-body actions, then additive emotion,
look-at, leg IK and secondary springs in that order. CCD spine/neck has per-link
limits and looks toward a hand only when attention scoring permits. The 12-joint
tail uses damped secondary motion with collision limits and no unstable feedback.
Keep a fixed30Hz simulation and interpolate render poses. Distant IK may update
less often without changing deterministic behavior decisions.

Author at30fps against lawful real-cat footage; capture reference source and
permission in provenance. Locomotion is in place and records extras.authoredSpeed
(m/s); jumps retain root motion and have landing/contact markers. Walking uses
staggered four-beat contacts, trot paired diagonals, gallop gathered/extended
phases. Validate gait against reference rather than imposing equal sine waves.
Speeds: walk <~1.1m/s, trot to~2.2m/s, gallop above, tuned to the model scale.

M2 minimum clips: cat.idle, cat.loco.walk, cat.loco.turn_left/right,
cat.rest.sit_down, cat.rest.sit_idle, cat.rest.sleep_curl,
cat.rest.wake_stretch, cat.care.eat, cat.care.drink,
cat.touch.lean_in, cat.touch.slow_blink, cat.touch.tail_lash,
cat.touch.ears_back, cat.touch.swat, cat.loco.walk_away.
Clip names must be catalogued explicitly before export. The full README clip
list remains the eventual delivery checklist; later perks stay M5/M6.

## Autonomous behavior and welfare contract (Engine + Master)

Needs: hunger, thirst, energy, play, social, litter, grooming, all data-driven.
Seed RNG per cat; fixed30Hz; utility reevaluation staggered .5–2s with inertia.
M2 goal trees: rest, eat, drink, explore, watch, seek/avoid patron and groom.
Floor navmesh and jump/perch links reserve slots; retreat is cat-only.
No interaction button orders a cat to sit, approach, jump or accept touch.

Ray proxies bind to head/cheeks/chin/back/flank/belly/tail-base/tail/paws.
Stroke speed, grain and zone feed quality and overstimulation. Default liked:
cheeks/chin/between ears; tail base and belly sensitive. Below .6: relaxed
lean/purr/slow blink; .6–1: lashing tail, back-turned ears, skin twitch/wide pupils;
≥1: swat/leave and temporary avoidance. Stopping at warnings earns trust.
Affinity grows toward a hidden seeded cap, never a visible numeric meter.
Missing owner audio is silent with captions, never generated substitute meows.

## M2 acceptance gate

1. Asset checks validate three LOD budgets, exact joint order, inverse bind
   matrices, normalized ≤4 weights, required clips/morphs, authoredSpeed and
   provenance. Turntable shows a natural side profile and complete geometry.
2. Deterministic tests replay identical seeds/inputs at30/60/144 render fps.
   Verify utility autonomy, cap saturation and all touch warning thresholds.
3. IK tests include reachable/unreachable targets, straight limbs, pole changes,
   step up/down and slopes; no NaNs, flipped joints or skating planted pads.
4. Browser playtests show walk, sit, sleep, eat and zone-sensitive touch, plus
   paw planting on steps and voluntary hand attention. No console/WebGL errors.
5. Desktop default and Low phone screenshots, draw calls ≤150/80, first play
   ≤20MB; actual phone frame/memory measurements are separate from emulation.
6. npm run assets && npm run check && npm run build && npm run test:e2e;
   live smoke and a frozen /m2/ snapshot only after all gates and sign-offs pass.

Master dispatches separate bounded role tasks for asset authoring, animation,
IK/runtime, needs/utility, touch welfare, and the verified live M2 exit.
