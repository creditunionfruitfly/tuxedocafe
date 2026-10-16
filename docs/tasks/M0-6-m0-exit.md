# M0-6 M0 exit

Role: master
Status: Waiting on M0-2 to M0-5
Budget share: 0.5% of week A
Model tier: GPT-6 Luna

## Goal

Close M0 on the live build and freeze it as the baseline M1 starts from.

## Steps

1. Confirm the owner's one-time setup (README, Owner setup):
   - Pages source is GitHub Actions.
   - The `github-pages` environment is limited to `main`.
   - `main` requires the `ci` check and up-to-date branches.
   - A `playtest` label exists.
2. Check the M0 exit criterion on <https://creditunionfruitfly.github.io/tuxedocafe/>: the empty café at 60 fps on desktop and on a phone in landscape. Note the frame times in the closing pull request.
3. Ask the owner to export the private research doc as Markdown into `docs/knowledge-sheet.md`; agents can't read it.
4. Tag the exit commit `v0.0.0`. Watch `release.yml` attach `site-m0.zip` and redeploy, then open `/tuxedocafe/m0/` and check its build stamp reads `m0`.
5. Mark M0 tasks done in `docs/tasks/README.md`, log the week's spend in `docs/budget.md`, and set M1 tasks to Ready.

## Done when

- [ ] `/tuxedocafe/` and `/tuxedocafe/m0/` both pass `npm run test:live` (`LIVE_URL=…/m0/` for the snapshot)
- [ ] `builds.json` lists both
- [ ] M1 starts from the frozen `/m0/`
