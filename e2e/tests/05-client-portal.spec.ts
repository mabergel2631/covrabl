import { test, expect } from '@playwright/test';
import { detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo, loginAs } from './helpers';

test.describe('Client portal (consumer side)', () => {
  test('client login lands on /policies and shows their seeded policies', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    // Log in as Sarah Westlake — one of the seeded client users (password: Covrabl)
    await loginAs(page, 'sarah.westlake@demo.dev', 'Covrabl');

    // Client role lands at /policies, not /agent
    await page.waitForURL(/\/(policies|onboard|tour)/, { timeout: 15_000 });
    await settled(page);

    // If we landed on onboarding, skip it to /policies
    if (page.url().includes('/onboard') || page.url().includes('/tour')) {
      await page.goto('/policies');
      await settled(page);
    }

    // Sarah has 3 policies: Auto, Home, Umbrella with Allstate carrier
    await expect(page.getByText(/Allstate/i).first()).toBeVisible({ timeout: 15_000 });

    await snapshot(page, v, 'client_portal_policies');

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Client portal has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
