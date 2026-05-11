import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo, openMobileMenuIfPresent } from './helpers';

test.describe('Profile page', () => {
  test('renders demo profile, MFA section, data export button', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (/\/(profile|auth\/me|user)/i.test(resp.url()) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsDemo(page);
    await settled(page);

    // Navigate to profile via the sidebar
    await openMobileMenuIfPresent(page);
    await page.getByRole('button', { name: /^👤?\s*Profile/i }).first().click();
    await page.waitForURL(/\/profile/, { timeout: 15_000 });
    await settled(page);

    // Page heading
    await expect(page.getByRole('heading', { name: /^Your Profile$/i })).toBeVisible({ timeout: 15_000 });

    // Two-factor authentication section heading (we use h2s for sections)
    await expect(page.getByRole('heading', { name: /two[- ]?factor authentication/i })).toBeVisible();

    // "Your data" section (this is the data export surface)
    await expect(page.getByRole('heading', { name: /your data/i })).toBeVisible();

    await snapshot(page, v, 'profile_page');

    expect(apiFailures, `5xx responses on profile endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Profile page has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
