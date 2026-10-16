# src/: Engine Engineer conventions

- Folders follow README's layout: core, input, interaction, cats, anim, render, scenes, economy, audio, ui, save. One concern per module; no barrel files.
- Import with explicit `.ts` extensions, so Node runs `tools/` and `tests/` code without a build step. Keep syntax erasable (no enums, namespaces or parameter properties).
- Runtime URLs only through `assetUrl()` and `siteUrl()` in `core/assets.ts`. ESLint rejects literal paths that start with `/`.
- Randomness only through `core/rng.ts`, with one forked stream per system or cat. ESLint rejects `Math.random`.
- Simulation code (cats, economy, chores) runs on the fixed 30 Hz step and never reads wall-clock time. Rendering and UI may.
- Systems talk through the typed event bus. The DOM UI and audio react to events and never reach into the scene.
- Storage only through `core/storage.ts` (from M0-2): channel-namespaced, in try/catch, with migrations for every format change.
- Unfinished features read their flag through `core/flags.ts` and stay off by default.
- No allocations in per-frame code: reuse vectors, matrices and arrays.
- three.js: import from `three` and `three/addons/…`, and dispose every geometry, material and texture you create.
- Every module gets `tests/unit/<module>.test.ts`; anything visible gets a smoke-test assertion.
