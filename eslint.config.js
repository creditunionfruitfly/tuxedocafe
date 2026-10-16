import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const BASE_URL_RULE = 'Build runtime URLs from import.meta.env.BASE_URL (assetUrl / siteUrl), never a leading "/" (AGENTS rule 11).';

export default defineConfig([
  globalIgnores(['dist/', '_site/', 'node_modules/', 'test-results/', 'playwright-report/', 'art/', 'audio/', 'public/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[value=/^\\/[A-Za-z_]/]', message: BASE_URL_RULE },
        { selector: 'TemplateLiteral > TemplateElement:first-child[value.raw=/^\\/[A-Za-z_]/]', message: BASE_URL_RULE },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in src/core/rng.ts (AGENTS rule 5).' },
      ],
    },
  },
]);
