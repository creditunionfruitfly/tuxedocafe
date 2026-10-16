# Tasks

The Master writes one file per task (AGENTS.md, Master). Each names its role, budget share, model tier, the README sections to read, the files to touch, what done means and the acceptance command. Status changes ride along with the pull request that finishes a task.

| Task | Role | Status | Share of week A | Depends on |
| --- | --- | --- | --- | --- |
| [M0-1 Baseline scaffold](M0-1-baseline-scaffold.md) | master | Done | 0% (made outside Codex) | — |
| [M0-2 Engine core](M0-2-engine-core.md) | engine | Ready | 2% | M0-1 |
| [M0-3 Renderer, tiers and landscape guard](M0-3-renderer-tiers.md) | engine | Ready | 2% | M0-1 |
| [M0-4 Art style, skeleton and placeholder cat](M0-4-art-style-rig.md) | artist | Ready | 1% | M0-1 |
| [M0-5 Audio style, first cue and manifests](M0-5-audio-style-cue.md) | composer | Ready | 1% | M0-1 |
| [M0-6 M0 exit](M0-6-m0-exit.md) | master | Waiting | 0.5% | M0-2 to M0-5 |
| [M1-1 Input and gestures](M1-1-input-gestures.md) | engine | Waiting | 3% | M0-6 |
| [M1-2 Movement and camera](M1-2-movement-camera.md) | engine | Waiting | 2.5% | M1-1 |
| [M1-3 Hand, proxies and hover menus](M1-3-hand-hover-menus.md) | engine | Waiting | 3% | M1-1 |
| [M1-4 Hold and drag](M1-4-hold-and-drag.md) | engine | Waiting | 2% | M1-3 |
| [M1-5 Café blockout, hand and art pipeline](M1-5-cafe-blockout.md) | artist | Waiting | 1.5% | M0-6 |
| [M1-6 M1 exit](M1-6-m1-exit.md) | master | Waiting | 0.5% | M1-1 to M1-5 |

M0 totals 7% of week A, with 0.5% held back inside the milestone; M1 totals 13%, with 0.5% held back. M0-2 to M0-5 can run in parallel.
