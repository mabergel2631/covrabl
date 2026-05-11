import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

test.describe('Renewal Review', () => {
  test('seed prior year, open review, save summary, generate share link', async ({ page, context }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await loginAsDemo(page);
    await settled(page);

    // Open Sarah Westlake's detail page
    await page.getByText('sarah.westlake@demo.dev', { exact: false }).first().click();
    await page.waitForURL(/\/agent\/\d+/, { timeout: 15_000 });
    await settled(page);

    // Use the "+ Add Prior Year (sample)" button on the first policy to seed a year-over-year pair.
    // This is the agent-owner demo shortcut wired into the page.
    const seedButton = page.getByRole('button', { name: /Add Prior Year/i }).first();
    if (await seedButton.isVisible().catch(() => false)) {
      await seedButton.click();
      // The seed call routes straight to the renewal review on success
      await page.waitForURL(/\/renewal/, { timeout: 30_000 });
    } else {
      // Already-linked policies will show "Open Renewal Review" directly
      const openBtn = page.getByRole('button', { name: /Open Renewal Review/i }).first();
      if (await openBtn.isVisible().catch(() => false)) {
        await openBtn.click();
        await page.waitForURL(/\/renewal/, { timeout: 15_000 });
      } else {
        test.skip(true, 'No way to enter renewal review on this client (no Add Prior Year, no existing linkage)');
      }
    }

    await settled(page);

    // Verify the review page rendered the structured changes section
    await expect(page.getByRole('heading', { name: /Renewal Review/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Structured changes/i })).toBeVisible();

    await snapshot(page, v, 'renewal_review_agent');

    // Type a summary and save
    const textarea = page.getByPlaceholder(/Example: Premium increased/i).first();
    await textarea.fill('E2E test summary — automated check from the QA suite.');
    await page.getByRole('button', { name: /Save summary/i }).click();
    // Wait for the saved confirmation OR for the button to re-enable
    await page.waitForTimeout(2000);

    // Generate share link
    const shareBtn = page.getByRole('button', { name: /Generate share link/i });
    if (await shareBtn.isVisible().catch(() => false)) {
      await shareBtn.click();
      await page.waitForTimeout(2000);
    }

    // Find the share URL in the input (readonly)
    const urlInput = page.locator('input[readonly]').first();
    let shareUrl = '';
    if (await urlInput.isVisible().catch(() => false)) {
      shareUrl = await urlInput.inputValue();
    }
    expect(shareUrl, 'Expected a share URL to be present after generating share link').toMatch(/\/renewal-review\//);

    await snapshot(page, v, 'renewal_review_shared');

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Renewal review has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);

    // Open the public share in a fresh incognito context (no auth)
    if (shareUrl) {
      const incognito = await context.browser()!.newContext();
      const pubPage = await incognito.newPage();
      await pubPage.setViewportSize(page.viewportSize()!);
      await pubPage.goto(shareUrl);
      await pubPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

      // Public surface has "What changed" or "Items to discuss" — at minimum the carrier name
      await expect(pubPage.getByText(/Allstate/i).first()).toBeVisible({ timeout: 15_000 });

      const pubOverflow = await pubPage.evaluate(() => {
        const html = document.documentElement;
        return Math.max(html.scrollWidth, document.body.scrollWidth) - Math.max(html.clientWidth, document.body.clientWidth);
      });
      expect(pubOverflow, `Public renewal review has ${pubOverflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);

      await pubPage.screenshot({ path: `screenshots/${v}/renewal_review_public.png`, fullPage: true });
      await incognito.close();
    }
  });
});
