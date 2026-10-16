# M1-2 Movement and camera

Role: engine
Status: Waiting on M1-1
Budget share: 2.5% of week A
Model tier: GPT-6 Sol
Depends on: M1-1

## Goal

First-person movement through the café: drag to move, walk to a point, WASD, look and lean, kept inside the room and out of the furniture.

## Read

- AGENTS.md (golden rules 1 and 5)
- README: Hand and controls spec (the gesture table), Technical decisions (D4, D13, D18)

## Files to touch

- `src/scenes/player.ts`: eye height of 1.6 m; a walk speed of about 1.4 m/s with smoothed starts and stops on the fixed 30 Hz step; look limited to ±80° pitch; lean as a small forward and back offset.
- `src/scenes/collision.ts`: a circle against the room walls and the furniture's boxes, sliding along edges. The navmesh is M2.
- Walk to point: a quick click or tap on the floor eases the player there and stops short of furniture.
- Reduced motion (an accessibility setting): no head bob, and slower camera turns.
- `tests/unit/player.test.ts`: speed, collision sliding and walk-to-point arrival, all on the fixed step.

## Done when

- [ ] Smoke test: a scripted drag moves the camera, and the player can't leave the room
- [ ] Movement depends only on fixed steps and input, not frame rate (a test runs it at 30 and 144 fps renders)
- [ ] Frame time on the phone tier is unchanged within 0.5 ms, with numbers in the pull request

## Acceptance

```bash
npm run check && npm run build && npm run test:e2e
```
