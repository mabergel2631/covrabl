import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

test.describe('Agent dashboard', () => {
  test('login + dashboard renders + no horizontal overflow', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await loginAsDemo(page);
    await settled(page);

    // Agent landed on /agent
    expect(page.url()).toMatch(/\/agent(\/|$|\?)/);

    // "My Clients" heading visible
    await expect(page.getByRole('heading', { name: /my clients/i })).toBeVisible();

    // At least 10 clients in the list (we seeded 10)
    const clientEmails = [
      'sarah.westlake', 'michael.chen', 'elena.rodriguez', 'james.obrien',
      'priya.patel', 'robert.thompson', 'anna.kowalski', 'david.nakamura',
      'linda.goldberg', 'marcus.williams',
    ];
    for (const email of clientEmails) {
      await expect(page.getByText(email, { exact: false })).toBeVisible({ timeout: 10_000 });
    }

    await snapshot(page, v, 'agent_dashboard');

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Dashboard has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
