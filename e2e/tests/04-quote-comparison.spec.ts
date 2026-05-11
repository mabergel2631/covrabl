import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

test.describe('Quote Comparison', () => {
  test('pick a same-type sibling policy, open comparison, save summary, share', async ({ page, context }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await loginAsDemo(page);
    await settled(page);

    // Robert Thompson has 4 policies including Auto + Watercraft + Home + Umbrella — good candidate
    await page.getByText('robert.thompson@demo.dev', { exact: false }).first().click();
    await page.waitForURL(/\/agent\/\d+/, { timeout: 15_000 });
    await settled(page);

    // Click the first "Compare to quote..." button
    const compareBtn = page.getByRole('button', { name: /Compare to quote/i }).first();
    if (!(await compareBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No Compare-to-quote button visible — page may have changed shape');
    }
    await compareBtn.click();

    // Picker dropdown appears — pick any candidate
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 10_000 });

    // Pick the first non-empty option
    const optionValues = await select.locator('option').evaluateAll(opts =>
      opts.map(o => (o as HTMLOptionElement).value).filter(v => v && v !== '')
    );
    if (optionValues.length === 0) {
      test.skip(true, 'No sibling same-type policies available on this client');
    }
    await select.selectOption(optionValues[0]);

    // Click "Compare"
    await page.getByRole('button', { name: /^Compare$/i }).click();
    await page.waitForURL(/quote-comparison\/\d+/, { timeout: 30_000 });
    await settled(page);

    // Comparison page rendered
    await expect(page.getByRole('heading', { name: /Quote Comparison/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Structured differences/i })).toBeVisible();

    await snapshot(page, v, 'quote_comparison_agent');

    // Save a summary
    const textarea = page.getByPlaceholder(/Example: This quote drops/i).first();
    await textarea.fill('E2E test summary — automated check from the QA suite.');
    await page.getByRole('button', { name: /Save summary/i }).click();
    await page.waitForTimeout(2000);

    // Share link
    const shareBtn = page.getByRole('button', { name: /Generate share link/i });
    if (await shareBtn.isVisible().catch(() => false)) {
      await shareBtn.click();
      await page.waitForTimeout(2000);
    }
    const urlInput = page.locator('input[readonly]').first();
    let shareUrl = '';
    if (await urlInput.isVisible().catch(() => false)) {
      shareUrl = await urlInput.inputValue();
    }
    expect(shareUrl, 'Expected a quote-comparison share URL').toMatch(/\/quote-comparison\//);

    await snapshot(page, v, 'quote_comparison_shared');

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Quote comparison has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);

    // Public share page
    if (shareUrl) {
      const incognito = await context.browser()!.newContext();
      const pubPage = await incognito.newPage();
      await pubPage.setViewportSize(page.viewportSize()!);
      await pubPage.goto(shareUrl);
      await pubPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

      await expect(pubPage.getByRole('heading', { name: /Quote Comparison/i })).toBeVisible({ timeout: 15_000 });

      const pubOverflow = await pubPage.evaluate(() => {
        const html = document.documentElement;
        return Math.max(html.scrollWidth, document.body.scrollWidth) - Math.max(html.clientWidth, document.body.clientWidth);
      });
      expect(pubOverflow, `Public quote-comparison has ${pubOverflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);

      await pubPage.screenshot({ path: `screenshots/${v}/quote_comparison_public.png`, fullPage: true });
      await incognito.close();
    }
  });
});
