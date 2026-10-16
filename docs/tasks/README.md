# Tasks

The Master writes one file per task (AGENTS.md, Master). Each names its role, budget share, model tier, the README sections to read, the files to touch, what done means and the acceptance command. Status changes ride along with the pull request that finishes a task.

| Task | Role | Status | Share of week A | Depends on |
| --- | --- | --- | --- | --- |
| [M0-1 Baseline scaffold](M0-1-baseline-scaffold.md) | master | Done | 0% (made outside Codex) | — |
| [M0-2 Engine core](M0-2-engine-core.md) | engine | Implemented; merged | 2% | M0-1 |
| [M0-3 Renderer, tiers and landscape guard](M0-3-renderer-tiers.md) | engine | Implemented; live/device exit pending | 2% | M0-1 |
| [M0-4 Art style, skeleton and placeholder cat](M0-4-art-style-rig.md) | artist | Implemented; merged | 1% | M0-1 |
| [M0-5 Audio style, first cue and manifests](M0-5-audio-style-cue.md) | composer | Implemented; merged | 1% | M0-1 |
| [M0-6 M0 exit](M0-6-m0-exit.md) | master | Open: live/device/snapshot gate | 0.5% | M0-2 to M0-5 |
| [M1-1 Input and gestures](M1-1-input-gestures.md) | engine | Implemented; candidate review | 3% | M0-6 |
| [M1-2 Movement and camera](M1-2-movement-camera.md) | engine | Implemented; candidate review | 2.5% | M1-1 |
| [M1-3 Hand, proxies and hover menus](M1-3-hand-hover-menus.md) | engine | Implemented; candidate review | 3% | M1-1 |
| [M1-4 Hold and drag](M1-4-hold-and-drag.md) | engine | Implemented; candidate review | 2% | M1-3 |
| [M1-5 Café blockout, hand and art pipeline](M1-5-cafe-blockout.md) | artist | Implemented; candidate review | 1.5% | M0-6 |
| [M1-6 M1 exit](M1-6-m1-exit.md) | master | Open: prerequisite/exit gates | 0.5% | M1-1 to M1-5 |

M0 totals 7% of week A, with 0.5% held back inside the milestone; M1 totals 13%, with 0.5% held back. M0-2 to M0-5 can run in parallel.

Additional owner-requested work: [M1 first visit](M1-7-first-visit.md) and [M2 production specification](M2-0-cat-production-spec.md). Control optimization: [R2 radial look, 360° room and faster touch navigation](R2-0-radial-controls.md).

M2 Cat v1 (Claude Code session; texture generation offline): [M2-1 Master cat mesh, eyes and LODs](M2-1-master-cat-mesh.md) (artist), [M2-2 Cat animation library](M2-2-cat-animation-library.md) (artist), [M2-3 Animation runtime, IK and instancing](M2-3-cat-animation-runtime-ik.md) (engine), [M2-4 Resident cat models](M2-4-resident-cat-models.md) (master, data in place) and, next, [M2-5 Needs, utility AI, touch welfare and SFX hooks](M2-5-behavior-and-sfx-hooks.md) (engine). Contracts: `data/animation-catalog.json`, `data/cat-builds.json` and the `model` block in `data/cats.json`. M2 modeling/behavior implementation has not started.

Implementation preparation for M1 was requested in this session. Milestone acceptance remains open: no frozen snapshot or physical-device performance evidence is inferred from emulator screenshots.
