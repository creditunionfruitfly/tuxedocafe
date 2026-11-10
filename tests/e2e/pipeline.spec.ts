import { expect, test } from '@playwright/test';
import { STARTUP_TIMEOUT } from './config.ts';

test('resolves tier AA and compiles optics only on desktop', async ({ page, isMobile }, testInfo) => {
  const problems: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || /WebGL: INVALID|Framebuffer is incomplete/i.test(msg.text())) problems.push(msg.text());
  });
  page.on('pageerror', error => problems.push(String(error)));
  const desktop = !isMobile, requested = desktop ? 8 : 2;
  for (const tier of desktop ? ['desktop', 'high'] : ['phone', 'low']) {
    await page.goto(`./?lookdev=cafe&tier=${tier}`);
    const body = page.locator('body');
    await expect(body).toHaveAttribute('data-ready', 'true', { timeout: STARTUP_TIMEOUT });
    await expect(body).toHaveAttribute('data-tier', tier);
    await expect(body).toHaveAttribute('data-aa-requested', String(requested));
    await expect(body).toHaveAttribute('data-optics', desktop ? 'depth-and-highlight' : 'off');
    const native = Number(await body.getAttribute('data-aa-native'));
    expect(native).toBeLessThanOrEqual(requested);
    await expect(body).toHaveAttribute('data-aa-resolve', native === requested ? 'native' : 'supersample');
    expect(Number(await body.getAttribute('data-aa-density'))).toBeGreaterThanOrEqual(requested);
    if (isMobile) expect(Number(await body.getAttribute('data-draw-calls'))).toBeLessThanOrEqual(80);
    await page.screenshot({ path: testInfo.outputPath(`cafe-${tier}.png`) });
  }
  expect(problems).toEqual([]);
});
