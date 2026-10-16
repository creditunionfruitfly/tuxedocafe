# M1-3 Hand, proxies and hover menus

Role: engine
Status: Waiting on M1-1
Budget share: 3% of week A
Model tier: GPT-6 Sol
Depends on: M1-1

## Goal

The hand rides the surface under the pointer, rays hit cheap proxies instead of meshes, and resting on an object opens README's hover menu.

## Read

- AGENTS.md (golden rules 1, 9 and 11)
- README: Hand and controls spec (the hand, hit testing and hover-menu bullets), UI spec (the radial hover menu), Technical decisions (D12)

## Files to touch

- `src/interaction/proxies.ts`: boxes for bowls, the scoop, litter boxes and perch tops, and the floor plane. The bone-attached cat capsules wait for M2's rig. A hit returns `{ target, region, point, normal }`.
- `src/interaction/hand.ts`: a placeholder hand (simple meshes until M1-5's model) whose palm sits on the hit point along the normal, offset slightly toward the camera.
- `src/ui/hover-menu.ts`: a DOM radial menu at the projected hit point, with the actions from README (fill, clean, pick up, place for objects), keys 1–4, and long-press on touch. It stays on screen near the edges and mirrors in the left-handed layout.
- `src/ui/styles.css`: the Frutiger Aero glass panel, the specular strip and the README palette, with the blur off on low phones.
- `tests/unit/proxies.test.ts`: ray hits and misses, and region lookup.

## Done when

- [ ] Smoke test: hovering a bowl for 250 ms shows its menu, and key 1 triggers its first action event
- [ ] No raycasts against render meshes (proxies only)
- [ ] Merged behind flag `hover-menu` until M1-6, if it lands before the actions do anything

## Acceptance

```bash
npm run check && npm run build && npm run test:e2e
```
