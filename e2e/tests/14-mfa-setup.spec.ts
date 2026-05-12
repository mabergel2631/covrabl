import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo, openMobileMenuIfPresent } from './helpers';

// MFA / 2FA setup flow up to the QR-display stage.
// We deliberately do NOT submit a verification code — that would actually
// enroll the demo account and lock subsequent logins. Verifying that the
// secret + QR + recovery codes render correctly is enough to catch the
// "MFA setup page is broken" class of regression.
test.describe('MFA setup', () => {
  test('opens 2FA enrollment, QR and secret are visible', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (/\/auth\/mfa\//i.test(resp.url()) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsDemo(page);
    await settled(page);

    await openMobileMenuIfPresent(page);
    await page.getByRole('button', { name: /^👤?\s*Profile/i }).first().click();
    await page.waitForURL(/\/profile/, { timeout: 15_000 });
    await settled(page);

    await expect(page.getByRole('heading', { name: /two[- ]?factor authentication/i })).toBeVisible({ timeout: 15_000 });

    // Demo account always starts un-enrolled (reset endpoint creates a fresh
    // user). If for some reason it shows "Enabled", skip rather than fail —
    // we don't want to call Disable on the demo account mid-suite.
    const setupBtn = page.getByRole('button', { name: /Set up 2FA/i });
    if (!(await setupBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Demo account is already enrolled — skip enrollment-start test');
    }

    await setupBtn.click();

    // The enrollment UI shows a QR image + the secret text + recovery codes.
    // Wait for the QR image to be present (rendered from base64 dataURL).
    await expect(page.getByAltText(/2FA QR code/i)).toBeVisible({ timeout: 15_000 });

    // Secret text block should be visible (formatted in monospace)
    await expect(page.getByText(/Or enter this secret manually/i)).toBeVisible();

    await snapshot(page, v, 'mfa_setup');

    expect(apiFailures, `5xx on MFA endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `MFA setup has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
