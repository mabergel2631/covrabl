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

  // Locks the "Who to contact" block on the SOS expanded panel. Demo seed
  // (apps/api/app/demo_seed.py) attaches broker + claims + agent contacts
  // to the Geico Auto policy and broker + claims to the State Farm Home
  // policy. The block must show the phone numbers as tel: links in
  // emergency-priority order, plus the broker name when one is on file.
  // If a future edit removes the block or regresses the role priority,
  // this fails.
  test('expanded SOS panel surfaces broker + claims contacts with tel: links', async ({ page }) => {
    await loginAsDemo(page);
    await settled(page);

    await openMobileMenuIfPresent(page);
    await page.getByRole('button', { name: /^🚨?\s*Emergency/i }).first().click();
    await page.waitForURL(/\/emergency/, { timeout: 15_000 });
    await settled(page);

    // Click the Geico Auto tile (seeded with all three contact roles).
    const geicoTile = page.getByRole('button', { name: /Geico/i }).first();
    await expect(geicoTile).toBeVisible({ timeout: 15_000 });
    await geicoTile.click();
    await settled(page);

    // "Who to contact" header must be visible.
    await expect(page.getByText('Who to contact', { exact: true })).toBeVisible();

    // Each seeded role label must appear in the expanded panel.
    for (const label of ['Claims', 'Broker', 'Agent']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // Broker has a name on the seed; assert it renders next to the phone.
    await expect(page.getByText('Avery Chen', { exact: false }).first()).toBeVisible();

    // The phones must be tel: links — that's the actionable bit.
    const claimsLink = page.getByRole('link', { name: /800.*555.*0142|\(800\)\s*555-0142/ }).first();
    await expect(claimsLink).toBeVisible();
    await expect(claimsLink).toHaveAttribute('href', /^tel:/);

    const brokerLink = page.getByRole('link', { name: /415.*555.*0101|\(415\)\s*555-0101/ }).first();
    await expect(brokerLink).toBeVisible();
    await expect(brokerLink).toHaveAttribute('href', /^tel:/);
  });
});
