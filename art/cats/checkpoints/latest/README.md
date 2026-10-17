# Cat asset checkpoint

This archive preserves the actual exported meshes, all 67 clips, expressions, UV guides and current comparison images before review. It is a draft and does not certify final anatomy or motion quality. Source identities and exact SHA256 hashes are in `manifest.json`.

Run `node tools/art/restore-cat-archive.ts art/cats/checkpoints/latest/manifest.json` from the repo root to restore the exact files without CI. The original seventeen texture images have their own archive at `art/cats/textures/originals/manifest.json`. Prepared runtime textures decode with `node art/cats/textures/generate.ts`.

The archive uses text-encoded asset sources, consistent with ADR 0002, so GitHub stores every byte without requiring a separate binary upload or LFS fetch. These authoring files do not ship to players.
