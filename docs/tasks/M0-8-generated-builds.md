# M0-8 Generated original asset builds

Role: master
Status: Implemented; CI and independent Engine review pending
Budget share: Within the existing M0 allocation; measured allowance unavailable
Model tier: Session model

Files: .github/workflows/{ci,pages,release}.yml, .gitignore,
vitest.config.ts, docs/decisions/0001-generated-original-assets.md.

Build deterministic original art and audio before all CI validation/builds.
Include Composer-owned validator tests in `npm run check`.

Acceptance: npm run assets && npm run check && npm run build
