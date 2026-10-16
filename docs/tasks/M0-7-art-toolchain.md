# M0-7 Reproducible original art toolchain

Role: master
Status: Implemented; review pending
Budget share: Within M0/M1 art allocation; actual usage unavailable in this runtime
Model tier: Session model

## Goal

Supply the Artist with build-time glTF Transform, meshoptimizer and Khronos
validator tools for M0-4 and M1-5. No new runtime dependencies.

Files: package.json, package-lock.json, this task.
Acceptance: npm ci && npm run check

The owner requests both Master and Artist roles and completion of pre-M2 work.
Role branches and independent Engine sign-off preserve AGENTS review boundaries.
