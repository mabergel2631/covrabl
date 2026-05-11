import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo, openMobileMenuIfPresent } from './helpers';

// The /audit route is the "Policy Alerts" page — change-tracking deltas
// across the demo agent's policies. (The security audit log proper lives in
// audit_logs but is surfaced via API + profile export, not its own UI page.)
test.describe('Policy Alerts page', () => {
  test('renders without auth redirect', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (/\/(deltas|audit)/i.test(resp.url()) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsDemo(page);
    await settled(page);

    // Click the sidebar "🔔 Alerts" link rather than page.goto — page.goto
    // can race the auth-context hydration and redirect to /login.
    await openMobileMenuIfPresent(page);
    await page.getByRole('button', { name: /^🔔?\s*Alerts/i }).first().click();
    await page.waitForURL(/\/audit/, { timeout: 15_000 });
    await settled(page);

    // Page heading is "Policy Alerts"
    await expect(page.getByRole('heading', { name: /policy alerts/i }).first()).toBeVisible({ timeout: 15_000 });

    await snapshot(page, v, 'policy_alerts');

    expect(apiFailures, `5xx on alerts endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Alerts page has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
