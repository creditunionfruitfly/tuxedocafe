import { expect, test } from '@playwright/test';

const expectCommit = process.env.EXPECT_COMMIT;

// Live runs wait until the CDN serves the deployed commit, for up to 5 minutes.
test.beforeAll(async ({ request, baseURL }) => {
  if (!expectCommit) return;
  test.setTimeout(6 * 60_000);
  const deadline = Date.now() + 5 * 60_000;
  let seen = 'nothing yet';
  while (Date.now() < deadline) {
    const response = await request.get(new URL(`version.json?t=${Date.now()}`, baseURL).href);
    if (response.ok()) {
      const info = (await response.json()) as { commit?: string };
      if (info.commit === expectCommit) return;
      seen = info.commit ?? 'no commit field';
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(`The live site still serves ${seen}, not ${expectCommit}, after 5 minutes.`);
});

test('boots the café with no console errors', async ({ page }, testInfo) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));

  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(page.locator('body')).toHaveAttribute('data-live-version', /^(ok|newer)$/);
  await expect(page.locator('#build-stamp')).toHaveText(/\S+ · \S+/);

  await page.screenshot({ path: testInfo.outputPath('cafe.png') });
  expect(problems).toEqual([]);
});

test.describe('site files', () => {
  test.skip(({ isMobile }) => isMobile, 'These checks need no browser emulation.');

  test('serves version.json under the base path', async ({ request, baseURL }) => {
    const response = await request.get(new URL('version.json', baseURL).href);
    expect(response.ok()).toBe(true);
    const info = (await response.json()) as Record<string, unknown>;
    expect(info).toMatchObject({ version: expect.any(String), commit: expect.any(String), channel: expect.any(String) });
    if (expectCommit) expect(info.commit).toBe(expectCommit);
  });

  test('unknown paths are 404s, as on Pages', async ({ request, baseURL }) => {
    const response = await request.get(new URL('no-such-room/', baseURL).href);
    expect(response.status()).toBe(404);
  });
});
