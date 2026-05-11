import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

test.describe('Client detail', () => {
  test('opens a client and shows their policies + action buttons', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await loginAsDemo(page);
    await settled(page);

    // Click into Sarah Westlake (3 policies: auto, home, umbrella)
    await page.getByText('sarah.westlake@demo.dev', { exact: false }).first().click();
    await page.waitForURL(/\/agent\/\d+/, { timeout: 15_000 });
    await settled(page);

    // Policies are visible (carrier names from the seed)
    await expect(page.getByText(/Allstate/i).first()).toBeVisible();

    // Expand the first policy row to reveal the action buttons
    await page.getByText(/Allstate/i).first().click();
    await page.waitForTimeout(500);

    // Key entry points are present once expanded
    await expect(page.getByRole('button', { name: /Mark as renewal of/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Compare to quote/i }).first()).toBeVisible();

    await snapshot(page, v, 'client_detail_sarah');

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Client detail has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
