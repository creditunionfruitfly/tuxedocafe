import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/unit/**/*.test.ts', 'tests/sim/**/*.test.ts', 'tools/audio/**/*.test.ts'],
      environment: 'node',
    },
  }),
);
