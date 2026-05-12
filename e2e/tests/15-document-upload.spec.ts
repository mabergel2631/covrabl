import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

// Verifies the document-upload entry point on the agent's client-detail page.
// Stops at the modal-open stage rather than actually uploading a PDF — the
// upload flow hits R2 + the extraction worker, which is expensive to run on
// every push. The point here is to catch "the upload modal won't open" /
// "the file input is missing" regressions; the full upload+extract is
// implicit in the agent dashboard working at all (seeded policies all have
// uploaded PDFs).
test.describe('Document upload entry point', () => {
  test('opens upload modal with file input on the agent client-detail page', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await loginAsDemo(page);
    await settled(page);

    // Open Sarah Westlake — she has 3 policies, all uploadable targets.
    await page.getByText('sarah.westlake@demo.dev', { exact: false }).first().click();
    await page.waitForURL(/\/agent\/\d+/, { timeout: 15_000 });
    await settled(page);

    const uploadBtn = page.getByRole('button', { name: /Upload to Existing Policy/i });
    await expect(uploadBtn).toBeVisible({ timeout: 15_000 });
    await uploadBtn.click();
    await page.waitForTimeout(500);

    // After click, the page switches to the Documents tab and shows the
    // upload affordance: a file input (visible or hidden) and a policy
    // selector.
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 15_000 });

    await snapshot(page, v, 'document_upload_modal');

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Upload entry point has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
