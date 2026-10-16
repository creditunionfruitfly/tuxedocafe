import { makeConfig } from './tests/e2e/config.ts';

// `npm run test:e2e`: the smoke test against `vite preview` of dist/.
export default makeConfig({ live: false });
