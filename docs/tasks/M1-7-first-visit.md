# M1-7 Title and first visit

Role: engine
Status: In review with M1 input integration
Budget share: Existing M1 allocation; no budget increase
Model tier: Session model

## Goal

Open on a polished, accessible splash over the actual 3D cafe. New visitors
create a patron: display name, pronouns, hand skin tone and sleeve. Returning
visitors can continue; editing a patron never changes the cats' preferences.

Files: index.html, src/ui/{first-visit,settings,styles}.*, src/main.ts,
src/interaction/hand.ts, tests/e2e/first-visit.spec.ts.
Read: README The game, UI spec, Hand and controls, Playtest saves.

## Acceptance

`npm run check && npm run build && npm run test:e2e`

Verify keyboard-only creation, validated name, persisted preferences across
reload, hand appearance, Settings/return, landscape guard, Low phone no blur,
left-handed layout, reduced motion and hold toggle. The patron is never shown
in third person. No cat creator, obedience commands or placeholder M2 promises.
