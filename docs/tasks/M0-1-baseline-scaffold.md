# M0-1 Baseline scaffold

Role: master
Status: Done (the baseline commit)
Budget share: 0% of week A (made in a Claude session, not Codex)

## Goal

The first commit on `main`: everything every later task builds on, deployable to <https://creditunionfruitfly.github.io/tuxedocafe/> from the start. It lands directly on `main` because an empty repository has nothing to open a pull request against; every later change goes through pull requests.

## What it contains

- **Tooling:** pinned dependencies (three.js r186, Vite 8, TypeScript 6 strict, ESLint 10, Vitest 5, Playwright 1.64), `.nvmrc` (Node 24), Git LFS rules in `.gitattributes`.
- **Build:** `vite.config.ts` with `base` from `VITE_BASE`, `appType: 'mpa'`, a separate three.js chunk, `version.json` and the content-hashed asset manifest (`tools/engine/vite-*.ts`).
- **Lint rules for golden rules 5 and 11:** no `Math.random` in `src/`, and no literal URLs starting with `/`.
- **Placeholder café:** `src/main.ts` and `src/scenes/placeholder-cafe.ts` draw a blocked-out room with the build stamp; M0-2 and M0-3 replace both.
- **Core utilities:** `src/core/rng.ts` (seeded sfc32 with forks), `asset-url.ts` and `assets.ts` (`assetUrl`, `siteUrl`), `build-info.ts`.
- **CI/CD:** `ci.yml` (decoy base), `pages.yml` (deploy, then live smoke test), `release.yml` (milestone snapshots), `assemble-site.mjs`, SHA-pinned actions and Dependabot.
- **GitHub:** the pull request template, generated from AGENTS.md by `gen-pr-template.mjs` and checked by `npm run check`; the playtest issue form.
- **Data:** `data/cats.json` (the README roster), `economy.json`, `chores.json`, `flags.json`.
- **Tools:** provenance checker and allowlist (with `elevenlabs-paid`), the economy simulation (`npm run sim:economy`), and stubs for `npm run assets` and `npm run audio:check`.
- **Tests:** unit tests, the economy pacing test, and the Playwright smoke test (local and live).
- **Docs:** this task list, `docs/budget.md`, and nested `AGENTS.md` files in `src/`, `art/` and `audio/`.

## Verified before commit

`npm run check`, `npm run audio:check`, `npm run build` under `/tuxedocafe/` and the decoy base, the LFS pointer guard, `npm run test:e2e` on SwiftShader (desktop and phone landscape), a site assembly with a fake milestone snapshot, and actionlint on all three workflows.
