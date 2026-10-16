import { makeConfig } from './tests/e2e/config.ts';

// `npm run test:live`: the same smoke test against the live Pages build.
// LIVE_URL overrides the URL; EXPECT_COMMIT makes it wait for that deploy.
export default makeConfig({ live: true });
