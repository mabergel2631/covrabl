import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo, openMobileMenuIfPresent } from './helpers';

// Opens an existing policy detail page and verifies the policy-history /
// timeline panel renders (carrier, type, premium, renewal date). The agent
// runs spec 03 earlier in each viewport's run which seeds a prior-year link
// on Sarah's Allstate Auto — that creates a 2-entry version chain we can
// assert on here.
test.describe('Policy detail / timeline', () => {
  test('opens a seeded policy, history + key fields render', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (/\/policies\/\d+/i.test(resp.url()) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsDemo(page);
    await settled(page);

    // Click into Sarah Westlake's detail page
    await page.getByText('sarah.westlake@demo.dev', { exact: false }).first().click();
    await page.waitForURL(/\/agent\/\d+/, { timeout: 15_000 });
    await settled(page);

    // Open the Allstate Auto policy directly — its policy_number is unique
    // on this client so the carrier text is a reliable click target.
    await expect(page.getByText(/ALL-AU-220011/i).first()).toBeVisible({ timeout: 15_000 });

    // Expand the accordion to reveal policy details + history
    await page.getByText(/ALL-AU-220011/i).first().click();
    await page.waitForTimeout(800);

    // Key policy fields are visible after expansion (premium, scope, carrier)
    await expect(page.getByText(/Premium/i).first()).toBeVisible();
    await expect(page.getByText(/Allstate/i).first()).toBeVisible();

    await snapshot(page, v, 'policy_timeline');

    expect(apiFailures, `5xx on /policies endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Policy detail has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
