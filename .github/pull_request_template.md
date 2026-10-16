<!-- Generated from AGENTS.md by .github/scripts/gen-pr-template.mjs. Edit AGENTS.md, then rerun the script. -->

## Role

<!-- One of: master, engine, artist, composer -->

## Task

<!-- docs/tasks/M<n>-<k>.md -->

## What changed

## Budget impact

<!-- Phone tier: frame time (ms) and download or memory (MB). "None" if nothing at runtime changed. -->

## Flags

<!-- Flags added to or removed from data/flags.json, or "none". -->

## Evidence

<!-- Screenshots and test output. CI keeps the smoke-test screenshots as a run artifact. -->

## Sign-off

The role that owns each touched path ticks its box. Agents share one GitHub account, so GitHub reviews can't do this.

- [ ] **master**: `/*`, `.github/**`, `data/**`, `docs/*.md`, `docs/tasks/**`, `tools/provenance/**`
- [ ] **engine**: `index.html`, `src/**`, `tests/**`, `tools/engine/**`, `docs/decisions/**`
- [ ] **artist**: `art/**`, `public/assets/art/**`, `tools/art/**`
- [ ] **composer**: `audio/**`, `public/assets/audio/**`, `tools/audio/**`
- [ ] **engine + artist** (shared): `src/render/shaders/**`
- [ ] **engine + composer** (shared): `src/audio/**`
- [ ] **composer + engine** (shared): `audio/cues.json`

## Definition of done

- [ ] The task's acceptance command passes and CI is green
- [ ] Owners of every touched path signed off
- [ ] Phone tier budgets hold, with numbers in the pull request
- [ ] Works under `/tuxedocafe/` in `npm run preview`; unfinished work sits behind a flag
- [ ] Data, docs or an ADR updated wherever behavior or a decision changed
- [ ] New assets have provenance; no secrets and no borrowed IP
