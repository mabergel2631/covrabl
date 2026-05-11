import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo, openMobileMenuIfPresent } from './helpers';

test.describe('Emergency card', () => {
  test('renders the emergency page with key sections', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (/\/(emergency|ice|claims)/i.test(resp.url()) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsDemo(page);
    await settled(page);

    await openMobileMenuIfPresent(page);
    await page.getByRole('button', { name: /^🚨?\s*Emergency/i }).first().click();
    await page.waitForURL(/\/emergency/, { timeout: 15_000 });
    await settled(page);

    // Page heading should be visible
    await expect(page.getByRole('heading', { name: /emergency/i }).first()).toBeVisible({ timeout: 15_000 });

    await snapshot(page, v, 'emergency_card');

    expect(apiFailures, `5xx on emergency endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Emergency page has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
