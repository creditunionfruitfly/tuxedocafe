# M0-2 Engine core

Role: engine
Status: Ready
Budget share: 2% of week A
Model tier: GPT-6 Sol
Depends on: M0-1

## Goal

The core every later system plugs into: a fixed-step loop, a typed event bus, flags, channel-namespaced saves and the update notice. The placeholder café stays on screen and every smoke test stays green.

## Read

- AGENTS.md (golden rules 5, 7, 10 and 11)
- README: Technical decisions (D4, D17), Architecture, Hand and controls spec (the touch-hygiene bullet), Playtest builds and CI/CD (Rules that keep every build playable)

## Files to touch

- `src/core/loop.ts`: simulation at a fixed 30 Hz with an interpolation alpha for rendering; at most 5 catch-up steps a frame; paused on `visibilitychange`.
- `src/core/events.ts`: a typed event bus (an event map type, `on`, `off`, `emit`), with no stray listeners after `off`.
- `src/core/flags.ts`: flag ids from `data/flags.json`, turned on with `?flags=a,b`. An unknown id logs a warning, never an error.
- `src/core/storage.ts`: IndexedDB database `tuxedocafe-<channel>` and localStorage keys `tuxedocafe:<channel>:…`, every call in try/catch. Saves carry `schemaVersion` with a registry of forward migrations. A save that can't be read is kept as a backup and replaced with a fresh one, with a notice, never a crash.
- `src/core/update-check.ts`: fetch `siteUrl('version.json')` with `cache: 'no-store'` every 5 minutes and offer a reload toast when `isNewerBuild` says so. On `vite:preloadError` or a failed asset load, save and reload at most once per build, remembered in sessionStorage.
- `src/main.ts`: wire the above into the boot; keep `body[data-ready]`, `body[data-live-version]` and `#build-stamp` working.
- `tests/unit/`: loop accumulator, event bus, flags parsing, storage namespacing and migrations (with an in-memory fake), and update-check decisions.
- `tests/e2e/smoke.spec.ts`: `?flags=` reaches `body[data-flags]`.

## Done when

- [ ] `src/core/rng.ts` from M0-1 is reviewed and used for any randomness
- [ ] A corrupt save fixture in `tests/fixtures/saves/` recovers with a backup instead of throwing
- [ ] No console errors on desktop or phone landscape; the smoke test stays green
- [ ] Under about 400 hand-written lines; anything bigger splits into two pull requests

## Acceptance

```bash
npm run check && npm run build && npm run test:e2e
```
