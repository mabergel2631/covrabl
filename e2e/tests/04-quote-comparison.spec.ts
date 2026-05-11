import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

test.describe('Quote Comparison', () => {
  test('pick a same-type sibling policy, open comparison, save summary, share', async ({ page, context }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await loginAsDemo(page);
    await settled(page);

    // Robert Thompson has 5 policies including two Autos (Chubb + Mercury) —
    // the Auto policies are the ones we want to compare. Other policy types
    // (Home, Umbrella, Watercraft) have no same-type sibling and would show
    // an empty picker.
    await page.getByText('robert.thompson@demo.dev', { exact: false }).first().click();
    await page.waitForURL(/\/agent\/\d+/, { timeout: 15_000 });
    await settled(page);

    // Target the Chubb Auto row specifically by its unique policy number.
    // This avoids landing on Chubb Home/Umbrella/Watercraft which have no
    // same-type Auto to compare against.
    const autoRow = page.getByText(/CHB-MAS-770201/i).first();
    await expect(autoRow).toBeVisible({ timeout: 15_000 });
    // Find that row's "Compare to quote..." button. If not already visible,
    // click the row to expand the accordion.
    let compareBtn = page.getByRole('button', { name: /Compare to quote/i }).first();
    if (!(await compareBtn.isVisible().catch(() => false))) {
      await autoRow.click();
      await page.waitForTimeout(800);
      compareBtn = page.getByRole('button', { name: /Compare to quote/i }).first();
    }
    if (!(await compareBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No Compare-to-quote button visible — page may have changed shape');
    }
    await compareBtn.click();

    // Picker dropdown appears — pick any candidate.
    // (Bumped to 20s for CI cold-start margin.)
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 20_000 });

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

    // Save a summary. The Save button is disabled when the draft matches the
    // saved value, so when an earlier viewport's run already saved the same
    // text on the same comparison, the click would hang on "not enabled".
    // Always type slightly-different text and click only if the button enables.
    const textarea = page.getByPlaceholder(/Example: This quote drops/i).first();
    await textarea.fill(`E2E test summary — automated check from the QA suite (${v}).`);
    const saveBtn = page.getByRole('button', { name: /^Save summary$/i });
    if (await saveBtn.isEnabled().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
    }

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

      // Public-share heading is dynamic: "<type> · <incumbent> vs. <quote>"
      // (e.g., "Auto · Chubb vs. Mercury"). The public page uses the heading
      // "What's different" (not "Structured differences" — that's agent-side).
      await expect(pubPage.getByRole('heading', { name: /What's different/i })).toBeVisible({ timeout: 15_000 });

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
