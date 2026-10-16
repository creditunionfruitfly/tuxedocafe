# M1-6 M1 exit

Role: master
Status: Waiting on M1-1 to M1-5
Budget share: 0.5% of week A
Model tier: GPT-6 Luna

## Goal

Close M1 on the live build: walk, look, hover and hold-and-drag on placeholder objects, with the landscape guard working (README milestone table).

## Steps

1. On <https://creditunionfruitfly.github.io/tuxedocafe/>, run through the exit criteria with a mouse, then on a phone in landscape, then in portrait (expect the rotate overlay).
2. Remove the M1 flags (`input-v1`, `hover-menu`) from `data/flags.json` and the code, in one pull request.
3. Triage open `playtest` issues into M2 task files or the backlog.
4. Tag `v0.1.0`; confirm `/tuxedocafe/m1/` is live and `builds.json` lists `m0` and `m1`.
5. Update `docs/tasks/README.md` and `docs/budget.md`, then write the M2 task files.

## Done when

- [ ] `npm run test:live` passes for `/tuxedocafe/` and `/tuxedocafe/m1/`
- [ ] M1 used at most its 13% of week A, or the overrun is written up in `docs/budget.md`
