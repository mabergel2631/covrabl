import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo, openMobileMenuIfPresent } from './helpers';

// Verifies the Compliance Verification page (formerly the lease-compliance
// route, now redirected to /certificates). Heading present, no 5xx on the
// certificates/lease-compliance endpoints. View-only — no file upload,
// since extraction is expensive and isn't the point of this regression
// guard.
test.describe('Compliance Verification page', () => {
  test('renders the compliance hub for the demo agent', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (/\/(certificate|lease|compliance)/i.test(resp.url()) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsDemo(page);
    await settled(page);

    await openMobileMenuIfPresent(page);
    await page.getByRole('button', { name: /^📜?\s*Compliance/i }).first().click();
    await page.waitForURL(/\/certificates/, { timeout: 15_000 });
    await settled(page);

    await expect(page.getByRole('heading', { name: /Compliance Verification/i })).toBeVisible({ timeout: 15_000 });

    await snapshot(page, v, 'compliance_page');

    expect(apiFailures, `5xx on compliance endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Compliance page has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
