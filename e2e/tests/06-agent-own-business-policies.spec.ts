import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

// Regression: demo agent's own /policies Business tab 500-ed because the seed
// inserted human-readable policy_types ("Cyber Liability", etc.) that the
// PolicyOut validator rejected. This test loads the page and opens each row.
test.describe("Agent's own /policies", () => {
  test('Business tab lists and opens every commercial policy without error', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await loginAsDemo(page);
    await settled(page);

    // Watch for failed API calls — any 5xx from /policies* counts as a regression.
    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      const url = resp.url();
      if (/\/policies(\/|\?|$)/.test(url) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${url}`);
      }
    });

    await page.goto('/policies');
    await settled(page);

    // Switch to the Business scope tab
    const businessTab = page.getByRole('button', { name: /^Business$/i }).first();
    await expect(businessTab).toBeVisible({ timeout: 15_000 });
    await businessTab.click();
    await settled(page);

    // Seed creates 7 commercial policies across 3 businesses. At minimum we
    // expect to see one of the carriers from the seed (Hartford = CGL).
    await expect(page.getByText(/Hartford|Beazley|Hiscox|Travelers|Liberty Mutual|Progressive Commercial/i).first()).toBeVisible({ timeout: 15_000 });

    await snapshot(page, v, 'agent_own_business_tab');

    // Click every visible policy card/row and assert no error banner appears.
    // We use carrier-name text as the click target because each business
    // policy card displays the carrier prominently. After each click we wait
    // a moment for any toast/error to surface, then go back if we navigated.
    const carrierNames = ['Hartford', 'Travelers', 'Progressive Commercial', 'Liberty Mutual', 'Hiscox', 'Beazley'];
    const startUrl = page.url();
    for (const carrier of carrierNames) {
      const card = page.getByText(carrier, { exact: false }).first();
      if (!(await card.isVisible().catch(() => false))) continue;
      await card.click();
      await page.waitForTimeout(800);

      // Pydantic 500 used to surface as a Toast saying "1 validation error..."
      const validationToast = page.getByText(/validation error|Invalid policy_type/i);
      expect(await validationToast.count(), `${carrier} produced a validation-error toast`).toBe(0);

      // If we navigated, go back so the next iteration finds its card.
      if (page.url() !== startUrl) {
        await page.goBack();
        await settled(page);
        // Re-select Business if navigation reset the tab
        const tab = page.getByRole('button', { name: /^Business$/i }).first();
        if (await tab.isVisible().catch(() => false)) {
          await tab.click();
          await settled(page);
        }
      }
    }

    expect(apiFailures, `5xx responses on /policies endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Business tab has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
