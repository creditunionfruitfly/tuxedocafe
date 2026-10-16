import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

/** The live Pages build, unless LIVE_URL points elsewhere. */
export const DEFAULT_LIVE_URL = 'https://creditunionfruitfly.github.io/tuxedocafe/';

const PREVIEW_PORT = 4173;

/**
 * Shared Playwright setup for the local smoke test (`npm run test:e2e`, against
 * `vite preview`) and the live one (`npm run test:live`).
 */
export function makeConfig(options: { live: boolean }): PlaywrightTestConfig {
  const base = process.env.VITE_BASE ?? '/tuxedocafe/';
  const baseURL = options.live
    ? (process.env.LIVE_URL ?? DEFAULT_LIVE_URL)
    : `http://127.0.0.1:${PREVIEW_PORT}${base}`;

  // Paths resolve from the repository root, where both config files live.
  return defineConfig({
    testDir: 'tests/e2e',
    testMatch: '*.spec.ts',
    outputDir: 'test-results',
    timeout: 60_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
    use: {
      baseURL,
      screenshot: 'only-on-failure',
      trace: 'retain-on-failure',
      launchOptions: {
        // GitHub's runners have no GPU and Chrome is dropping its automatic
        // software-WebGL fallback. These flags stay here, never in the game.
        args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
        // Lets machines with a preinstalled Chromium skip `playwright install`.
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      },
    },
    projects: [
      { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
      { name: 'phone-landscape', use: { ...devices['Pixel 7 landscape'] } },
    ],
    ...(options.live
      ? {}
      : {
          webServer: {
            command: `npm run preview -- --host 127.0.0.1 --port ${PREVIEW_PORT}`,
            url: baseURL,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
        }),
  });
}
