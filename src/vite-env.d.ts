declare module 'virtual:build-info' {
  import type { BuildInfo } from './core/build-info.ts';
  const info: BuildInfo;
  export default info;
}

declare module 'virtual:asset-manifest' {
  import type { AssetManifest } from './core/asset-url.ts';
  const manifest: AssetManifest;
  export default manifest;
}
