import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo, openMobileMenuIfPresent } from './helpers';

test.describe('Renewals page', () => {
  test('renders upcoming renewals for the demo agent', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (/\/renewal/i.test(resp.url()) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsDemo(page);
    await settled(page);

    await openMobileMenuIfPresent(page);
    await page.getByRole('button', { name: /^🔄?\s*Renewals/i }).first().click();
    await page.waitForURL(/\/renewals/, { timeout: 15_000 });
    await settled(page);

    // Page renders with the h1 "Nothing changes without you knowing".
    await expect(page.getByRole('heading', { name: /Nothing changes without you knowing/i })).toBeVisible({ timeout: 15_000 });

    // At least one renewal row should be visible. We assert on the stable
    // "Renews in N days" / "Renews on" pattern emitted by every row.
    await expect(page.getByText(/Renews (in|on)/i).first()).toBeVisible({ timeout: 15_000 });

    await snapshot(page, v, 'renewals_page');

    expect(apiFailures, `5xx on /renewal*: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Renewals has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
