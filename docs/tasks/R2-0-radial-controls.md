# R2 Radial look, 360° room and faster touch navigation

Role: master
Status: In progress (owner-requested control optimization; Claude Code maintenance session, not Codex)

## Result

A patron can look up and down, turn a full 360° and walk to every reachable corner of the café
using only taps and drags on a phone, or the mouse and keyboard on desktop. Turning around always
shows café geometry, never empty background. Budgets: unchanged Phone limits (150k café triangles,
80 draws); controls add no per-frame allocations.

## Controls contract (values live in `data/interaction.json`)

- **Radial drag (one finger, or the left mouse button)** on anything except a reachable object or a cat:
  the offset from the press point is a look joystick. Horizontal offset turns yaw, vertical offset
  turns pitch, and the offset's magnitude sets the angular speed (dead zone `dragThresholdPx`, full
  speed at `radialFullPxTouch` / `radialFullPxMouse`, shaped by `radialCurve`, capped by
  `radialMaxRadPerSecondTouch` / `radialMaxRadPerSecondMouse`). Holding the drag keeps turning, so one
  drag can turn a full circle. Orientation is composed as a world-yaw × local-pitch quaternion: no
  roll, pitch limited to ±80°, yaw unbounded and wrapped to ±180° for the public `data-look` stamp.
- **Direct look (two fingers, or the right mouse button)** follows the drag: `lookTouchRadPerPx` is
  twice `lookMouseRadPerPx`. Pinch and the wheel still lean.
- **Tap the floor** anywhere in view, up to `floorTapMaxMeters`, to walk there along the room route at
  `walkMetersPerSecond`. Double-tap still jumps up to `jumpMaxMeters`. While carrying, a reachable
  floor or table tap still opens Place; a distant floor tap walks there without dropping the prop.
- **Keyboard**: W/A/S/D walk; ←/→ turn and ↑/↓ look up and down at `keyLookRadPerSecond`.
- **Reduced motion** scales every look rate by `reducedMotionLookScale`.
- The camera stays at least 10 cm inside the room shell, even when leaning.

## Role tasks

- Artist: close the z = 3 side behind the entry with an entry wall; `assertEnclosed` geometry QA
  rejects any standing eye ray that finds open space instead of café geometry or the glazed window.
  The new wall stays out of the static bake until the next Cycles rebake.
- Engine: radial look, direct look sensitivity, floor tap-to-walk, arrow-key look, camera inset;
  unit tests for every changed module and e2e coverage for touch radial turning and tap-to-walk.
- Master: this contract and its tuning values.

## Acceptance

```bash
npm run assets && npm run check && npm run test:e2e
```

Plus a green `pages` live smoke test on `main` after the last merge.

## Budget share

Outside the Codex allowance: done in a Claude Code session and logged in `docs/budget.md`.
