import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

// Phase 7 — "This Week" outreach feed. Sits above My Clients on the agent
// dashboard; surfaces upcoming renewals, recent uploads, share-link views,
// and stalled-extraction signals from real activity. Empty after a clean
// reseed isn't a bug — the test asserts the section header is present and
// the page doesn't 500.
test.describe("This Week outreach feed", () => {
  test('renders the section heading on the agent dashboard', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (/\/(agent|outreach|this[-_]?week)/i.test(resp.url()) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsDemo(page);
    await settled(page);

    // The This Week section sits above the client list; assert it's present.
    // Heading text has varied between iterations — accept several phrasings.
    await expect(
      page.getByText(/this week|outreach|to[- ]do|action items/i).first()
    ).toBeVisible({ timeout: 15_000 });

    await snapshot(page, v, 'this_week_feed');

    expect(apiFailures, `5xx on agent endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Agent dashboard has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
