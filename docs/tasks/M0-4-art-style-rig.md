# M0-4 Art style, skeleton and placeholder cat

Role: artist
Status: Ready
Budget share: 1% of week A
Model tier: GPT-6 Luna for STYLE.md; GPT-6 Sol for the skeleton and the generator script
Depends on: M0-1

## Goal

The art rules every later asset follows, the shared cat skeleton, and a capsule-rigged placeholder cat that M2's animation runtime can drive before real models exist.

## Read

- AGENTS.md (golden rules 4 and 8) and `art/AGENTS.md`
- README: Technical decisions (D5 to D8, D16), Rendering spec, Animation spec (skeleton), UI spec (style and palette), Asset pipeline spec

## Files to touch

- `art/STYLE.md` v0: cat proportions by age (kitten, adult, chunky, senior), the fur look (shell lengths, flow, the soft toon ramp), coat masks (including Juniper's rosettes and Pixel's glossy Bombay coat), and the Frutiger Aero UI palette and shapes. No references to other artists or works.
- `art/rig/skeleton.json`: every bone's name, parent and rest position for README's skeleton (root, pelvis, 5 spine, 2 neck, head, jaw, 2 per ear, eyes, scapula-to-toe front legs, thigh-to-toe hind legs, a 12-joint tail), plus the IK chain ends.
- `tools/art/make-placeholder-cat.ts`: generates `public/assets/art/cats/cat_placeholder_lod0.glb` from `skeleton.json`, one capsule per bone, skinned, with no Blender needed. Prefer `@gltf-transform/core` as a dev dependency.
- `.prov.yaml` sidecars for every new asset (license `original`, author_role `artist`).

## Done when

- [ ] The placeholder cat passes the Khronos glTF-Validator with zero errors and loads in a three.js test scene (attach a screenshot)
- [ ] Bone names match `skeleton.json` exactly; README's Animation spec and the JSON agree
- [ ] `npm run check` passes, including provenance

## Acceptance

```bash
node tools/art/make-placeholder-cat.ts && npm run check
```
