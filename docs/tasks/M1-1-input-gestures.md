# M1-1 Input and gestures

Role: engine
Status: Waiting on M0-6
Budget share: 3% of week A
Model tier: GPT-6 Sol
Depends on: M0-6

## Goal

One input model for mouse, keyboard and touch that turns raw events into README's gestures, so M1-2 to M1-4 consume gestures and never raw events.

## Read

- AGENTS.md (golden rules 1, 9 and 11)
- README: Technical decisions (D12, D13), Hand and controls spec (the state diagram, the gesture table and the accessibility bullet)

## Files to touch

- `src/input/pointer.ts`: Pointer Events for mouse and touch, with pointer capture for drags, `touch-action: none` on the canvas, and safe-area-aware hit areas.
- `src/input/keys.ts`: WASD and the arrow keys, keys 1–4 for hover-menu actions, and focus loss releasing every key.
- `src/input/gestures.ts`: the state machine from README's diagram. Hover; dwell of 250 ms or long-press opens a menu; press-and-move on a cat strokes; press-and-drag on an object holds; press-and-drag on the floor moves; a quick click or tap walks to a point; right-drag or two fingers look; wheel or pinch leans. Every gesture returns to Hover on release.
- `src/input/settings.ts`: adjustable hold time and the hold-to-toggle mode, read from settings storage (M0-2).
- `tests/unit/gestures.test.ts`: table-driven tests that feed synthetic pointer sequences through the state machine.

## Done when

- [ ] Each README gesture is recognized on desktop and in the phone-landscape smoke project (synthetic touch)
- [ ] Hold-to-toggle mode turns every "hold" into tap-to-start and tap-to-stop
- [ ] Merged behind flag `input-v1` if it lands before M1-2 and M1-3 consume it; M1-6 removes the flag

## Acceptance

```bash
npm run check && npm run build && npm run test:e2e
```
