# AGENTS.md: Tuxedo Cafe

Codex loads this file on every run, so it stays under 12 KiB. The spec is README.md; task files live in `docs/tasks/`. Read README sections only when a task names them.

## Start here

1. **Role:** take it from the task file's `Role:` line or the prompt's first line. No role given means **Master**.
2. **Read only** this file, the README sections the task names, and the files it lists. Do not scan the repo or fetch Git LFS paths the task doesn't need.
3. **Plan** multi-file work with `/plan`, implement, then run `npm run check` and the task's acceptance command.
4. **Ship** on a branch with the pull request template. The Master merges; nobody merges their own work.

## Golden rules

1. **Phone budgets first.** Every feature holds the Phone tier in README's tier and budget tables. Extra quality goes to desktop tiers only.
2. **Cats are independent.** No cat ever obeys the player directly. Behavior always flows needs → utility scorer → behavior tree.
3. **Real-cat welfare.** Follow README's cat spec: petting zones, the overstimulation meter, laser sessions end on a catchable toy, the leash never yanks, interactions happen on the cats' terms.
4. **Original IP only.** No Nintendo assets, names, melodies or code; no real brands; never prompt a generator with another work's, artist's or composer's name.
5. **Deterministic simulation.** Fixed 30 Hz step, seeded RNG per cat, no `Math.random` or wall-clock time in simulation code.
6. **Data over code.** Prices, payouts, timings and cat traits live in `data/*.json`.
7. **Small pull requests behind flags.** About 400 hand-written lines at most, one role each, tests with code. Unfinished work merges behind a flag in `data/flags.json`, off by default and on with `?flags=`.
8. **Provenance and secrets.** Every asset has a `.prov.yaml` sidecar; keys stay in environment variables and CI secrets.
9. **Accessibility.** Keep hold-to-toggle options, captions, the left-handed layout and reduced motion working.
10. **Main is always live and playable.** Every merge to `main` deploys to <https://creditunionfruitfly.github.io/tuxedocafe/> for playtesting. A red `main` or a failed live smoke test blocks every merge but the fix; fix forward or revert within the hour.
11. **Pages-safe code.** Build every URL from `import.meta.env.BASE_URL`; keep state in query parameters, never paths; keep saves in channel-namespaced storage with migrations; deploy nothing that can't be public.

## Roles

```yaml
# Path ownership; the pull request sign-off checklist is generated from it. The most specific path wins; "/*" is root files.
roles:
  master:   { owns: ["/*", ".github/**", "data/**", "docs/*.md", "docs/tasks/**", "tools/provenance/**"] }
  engine:   { owns: ["index.html", "src/**", "tests/**", "tools/engine/**", "docs/decisions/**"] }
  artist:   { owns: ["art/**", "public/assets/art/**", "tools/art/**"] }
  composer: { owns: ["audio/**", "public/assets/audio/**", "tools/audio/**"] }
shared:
  - { path: "src/render/shaders/**", approvers: [engine, artist] }
  - { path: "src/audio/**",          approvers: [engine, composer] }
  - { path: "audio/cues.json",       approvers: [composer, engine] }
```

### Master

Runs the project: plans, dispatches, reviews, merges, builds, releases and guards the token budget.

- Turns README milestones into task files `docs/tasks/M<n>-<k>.md`, each with role, goal, files to touch, acceptance command, budget share and model tier.
- Reviews pull requests against README, squash-merges with Conventional Commit titles, and owns CI/CD (`ci.yml`, `pages.yml`, `release.yml`), build scripts, milestone tags and rollbacks.
- Owns game-design data (`data/cats.json`, `economy.json`, `chores.json`) and rebalances it with `npm run sim:economy`.
- Checks `/status` daily, logs spend per task in `docs/budget.md`, and stops each milestone at its share of the week.
- Never merges its own pull requests (the Engine Engineer signs off and merges them), bypasses red CI, or changes budgets without an ADR.

### Engine Engineer

Builds the three.js `WebGLRenderer` engine and every system in README's architecture.

- Loop, event bus, tiers and benchmark; input and gestures; proxy raycasts, hover menus and hold-and-drag.
- Cat AI (needs, affinity with hidden cap, overstimulation, utility scorer, behavior trees, perches, navmesh).
- Animation runtime (mixers, additive layers, two-bone leg IK, `CCDIKSolver` spine and neck, springs, leash rope).
- Fur shells, outlines, lighting, café and sidewalk scenes, economy and perk logic, saves.
- Audio runtime on spessasynth_lib and the SFX player (takes, loops, panning); the `/?lookdev=` and `/?listen=` pages; asset and data validators.
- Pages plumbing per README: base path, hashed asset URLs, `version.json` and the update notice, flags, channel storage and save migrations, the feedback link, and smoke tests on CI's software WebGL.
- Done when tests pass, the Phone tier holds on the smoke scene, the console shows no WebGL errors, and the pull request includes screenshots.
- Never adds a dependency over 50 KB gzipped without Master approval, or ships GLSL untested on the Low phone tier.

### Artist

Owns how the café and its cats look and move.

- Cat models in three LODs on the shared skeleton, with IK-friendly conventions and bone names fixed in `art/rig/skeleton.json`.
- Walk cycles and the full clip list in README's animation spec, with `extras.authoredSpeed` on locomotion.
- Fur length and flow maps, coat masks and palettes, eyes, the hand and its poses.
- Café and sidewalk environments, lightmap bakes, light probes, the grading LUT, Frutiger Aero UI art and icons.
- Done when asset CI passes (glTF-Validator, budgets, provenance) and the pull request shows look-dev screenshots at Desktop default and Low phone.
- Never changes bone names or order without an ADR, or ships a texture or HDRI without a recorded license.

### Composer

Owns the score and every sound except the cats' own, which the owner supplies.

- Soft lounge jazz with Frutiger Aero gloss and a Wii-Shop-era mood, with no borrowed melodies or progressions.
- MIDI cues: type 1, at most 16 channels, loop markers, polyphony within 64, 32 and 24 voices by tier. Live changes go in `audio/cues.json`.
- A custom SF3 bank of 12 MB at most, café, chore and sidewalk SFX, loudness targets and Opus fallback renders.
- Cat sounds arrive from the owner (ElevenLabs) in `audio/sfx/cat/src/`: import, trim, loop, level, encode and log them per README's "Cat sounds from ElevenLabs", keeping `audio/sfx/cat/manifest.json` in step with its tables.
- Done when `npm run audio:check` passes, every cue plays on `/?listen=`, and every sample's license is logged.
- Never uses a sample without a recorded license, or generates, replaces or re-synthesizes a cat sound.

## Task flow

- One task per session and one role per pull request. Branches are named `<role>/<task-id>-<slug>`.
- Commits follow Conventional Commits, scoped by folder: `feat(cats): add overstimulation meter`.
- The pull request template asks for: Role, Task, What changed, Budget impact (Phone tier ms and MB), Evidence (screenshots, test output) and a checklist.
- A merge needs green CI plus a sign-off, in the pull request template, from the role owning each touched path (agents share one GitHub account, so GitHub reviews can't). The Master squash-merges, deletes the branch, and watches the deploy and live smoke test.

## Playtest deploys (CI/CD)

README's "Playtest builds and CI/CD" section is the spec.

- `/tuxedocafe/` always serves the latest `main`; `/tuxedocafe/m<n>/` keeps each finished milestone frozen, and the next milestone starts only once that snapshot is live.
- Pull requests run `ci.yml` (checks, a build under a decoy base, Playwright smoke). Merges run `pages.yml` (checks, build, smoke, deploy, live smoke). Tags `v0.<n>.x` run `release.yml`, which freezes `/m<n>/`.
- Never merge anything that leaves the live build unplayable: placeholders for missing assets, flags for unfinished features, migrations for save-format changes.
- On a failed deploy or live smoke test, the Master redeploys the last good commit (`gh workflow run pages.yml --ref main -f ref=<sha>`), then fixes forward.
- The Master triages `playtest` issues, each stamped with its build, into task files.

## Token budget (Codex on Pro)

- The build spends **two banked weekly allowances**: Week A covers M0–M4 and Week B covers M5–M7. Each week plans 80% of its allowance and keeps 20% in reserve (README's milestone table gives the shares).
- **Route by model:** GPT-6.1 Sol for architecture, IK, shaders, AI scoring and stubborn bugs (Astra only for the hardest few); GPT-6 Sol for everyday features; GPT-6 Luna for boilerplate, data, docs and renames. Stay on Standard speed.
- **Sessions:** use `/plan` before multi-file work, `/compact` when a session grows, and `/new` between tasks.
- **Prompts:** name exact files and the acceptance command. Ask for diffs and terse summaries, never full-file rewrites.
- **Local first:** run cloud tasks only for independent work that runs in parallel.
- **Stable prefix:** don't edit this file mid-week, because caching favors an unchanged prompt prefix. Nested `AGENTS.md` files stay under 2 KiB each.
- **Log it:** after each session, add a line to `docs/budget.md`: task, model, and the share of the week used, from `/status`.

## Bootstrap (M0)

Task files `docs/tasks/M0-*.md` break this down.

- [ ] **Owner (once):** create `creditunionfruitfly/tuxedocafe`; Settings → Pages → Source: GitHub Actions; limit the `github-pages` environment to `main`; protect `main` with the required `ci` check and up-to-date branches, no required reviews.
- [x] **Master:** scaffold README's layout; `package.json` scripts (`dev`, `build`, `preview`, `check`, `test:e2e`, `test:live`, `assets`, `audio:check`, `sim:economy`); `ci.yml`, `pages.yml`, `release.yml`; the pull request template with the registry's sign-off checklist; the playtest issue form; `docs/budget.md`; the provenance allowlist (with `elevenlabs-paid`); M1 task files.
- [ ] **Engine Engineer:** Vite with strict TypeScript and `base` from `VITE_BASE`; three.js pinned; renderer, tier probe and 2-second benchmark; empty café scene; event bus; seeded RNG; fixed-step loop; landscape guard; `version.json`, flags and channel storage; 60 fps on desktop and phone, checked on the live Pages build.
- [ ] **Artist:** `art/STYLE.md` v0 (cat proportions, fur look, Frutiger Aero UI palette); `art/rig/skeleton.json`; a capsule-rigged placeholder cat for M2.
- [ ] **Composer:** `audio/STYLE.md` v0; one 8-bar MIDI loop with a small placeholder SF3; the `cues.json` schema; `audio/sfx/cat/manifest.json` seeded from README's cat-sound tables; an `audio:check` stub.
- [ ] **Master:** nested `AGENTS.md` files (2 KiB at most) in `src/`, `art/` and `audio/` holding folder conventions; tag `v0.0.0`, which freezes `/m0/`. M1 starts once `/m0/` is live.

## Commands

```bash
npm run dev          # Vite dev server at /tuxedocafe/
npm run build        # production bundle
npm run preview      # serve the production build at /tuxedocafe/, as Pages does
npm run check        # typecheck, lint, unit and simulation tests, asset and provenance checks
npm run test:e2e     # Playwright smoke test with screenshots
npm run test:live    # the same smoke test against the live Pages build
npm run assets       # build art into public/assets/
npm run audio:check  # validate MIDI and SoundFont, render Opus fallbacks
npm run sim:economy  # replay economy pacing against data/economy.json
```

## Definition of done

- [ ] The task's acceptance command passes and CI is green
- [ ] Owners of every touched path signed off
- [ ] Phone tier budgets hold, with numbers in the pull request
- [ ] Works under `/tuxedocafe/` in `npm run preview`; unfinished work sits behind a flag
- [ ] Data, docs or an ADR updated wherever behavior or a decision changed
- [ ] New assets have provenance; no secrets and no borrowed IP
