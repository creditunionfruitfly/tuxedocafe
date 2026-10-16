# M1-4 Hold and drag

Role: engine
Status: Waiting on M1-3
Budget share: 2% of week A
Model tier: GPT-6 Sol
Depends on: M1-3

## Goal

Pick up, carry and place the placeholder objects. This is the gesture under every chore: carry the water bowl to the tap, hold it there for 3 s and bring it back.

## Read

- AGENTS.md (golden rules 6 and 9)
- README: Hand and controls spec, Chores, C$ and perks (the gesture column), `data/chores.json`

## Files to touch

- `src/interaction/hold-drag.ts`: press on an object and drag to carry it at hand height, release on a valid surface to place it, and on an invalid one it eases back. Hold-to-toggle mode works too.
- `src/interaction/tap-fill.ts`: a prototype of the water chore's hold under the tap, with `holdSeconds` from `data/chores.json`. It emits `chore:progress` and `chore:done` events but pays nothing yet; payouts are M4.
- `tests/unit/hold-drag.test.ts`: placement validity and hold timing on the fixed step.

## Done when

- [ ] Smoke test: drag the bowl to the tap, hold, return it, and `chore:done` fires
- [ ] Works with mouse, touch (synthetic) and hold-to-toggle mode
- [ ] Timings come from `data/chores.json`, never from constants in code

## Acceptance

```bash
npm run check && npm run build && npm run test:e2e
```
