# M0-3 Renderer, tiers and landscape guard

Role: engine
Status: Ready
Budget share: 2% of week A
Model tier: GPT-6.1 Sol for the tier benchmark; GPT-6 Sol for the rest
Depends on: M0-1 (merges cleanly with M0-2 in either order)

## Goal

The real renderer setup and the empty café scene, sized per tier, with the landscape guard for phones. The M0 exit criterion: the empty café at 60 fps on desktop and phone, checked on the live Pages build.

## Read

- AGENTS.md (golden rules 1 and 11)
- README: Platforms and tiers, Technical decisions (D1, D2, D9), Rendering spec (café lighting), Performance budgets, Playtest builds and CI/CD

## Files to touch

- `src/render/renderer.ts`: `WebGLRenderer` setup per tier: render scale, MSAA, pixel ratio, tone mapping, resize, and a dynamic-resolution hook.
- `src/core/tiers.ts`: probe WebGL 2, MSAA samples, `deviceMemory` (Chromium only) and `hardwareConcurrency`, then run a 2-second benchmark scene and pick the highest tier that holds its frame target. `?tier=` overrides it.
- `src/scenes/cafe.ts`: the empty café, moved from `src/scenes/placeholder-cafe.ts`, which is then deleted. Use the README palette and soft key and hemisphere light; no shadow maps on phone tiers.
- `src/input/orientation.ts`: after the first tap on a phone, request fullscreen and `screen.orientation.lock('landscape')` where supported. In portrait on any platform, pause and show a "rotate your device" overlay.
- `index.html`: the rotate overlay markup and styles.
- `tests/unit/tiers.test.ts`: tier choice from probe and benchmark results.
- `tests/e2e/smoke.spec.ts`: a phone-portrait project that expects the overlay, and a `?tier=low` run.

## Done when

- [ ] The pull request lists frame times on desktop and on a phone in landscape, measured on the live build after merge
- [ ] Draw calls stay within the phone budget (80) in the empty café
- [ ] The "Baseline build" line in the HUD reads "Empty café" instead
- [ ] No console errors; the smoke tests stay green, including under CI's software WebGL

## Acceptance

```bash
npm run check && npm run build && npm run test:e2e
```
