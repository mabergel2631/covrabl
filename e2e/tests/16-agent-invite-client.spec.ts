import { test, expect } from '@playwright/test';
import { loginAsDemo, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

// Opens the "Invite Client" modal on the agent dashboard and submits a
// one-off invite. globalSetup wipes the demo account on every suite run, so
// invites created here are cleaned up before the next run; within a run,
// using a per-viewport email avoids cross-viewport state collisions.
test.describe('Agent invite-client flow', () => {
  test('opens invite modal, submits email, shows success', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (/\/agent\/clients/i.test(resp.url()) && resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await loginAsDemo(page);
    await settled(page);

    const inviteBtn = page.getByRole('button', { name: /\+\s*Invite Client/i });
    await expect(inviteBtn).toBeVisible({ timeout: 15_000 });
    await inviteBtn.click();

    // The "Invite a Client" label inside the modal is a styled <div>, not a
    // heading — assert on the text directly.
    await expect(page.getByText(/Invite a Client/i).first()).toBeVisible({ timeout: 10_000 });

    // Per-viewport unique email so each viewport's run doesn't collide on
    // the same pending invite within a single suite invocation.
    const emailInput = page.locator('input[type="email"]').first();
    await emailInput.fill(`e2e-invite-${v}@demo.dev`);

    // Submit. Button label is "Send Invite" while idle, "Sending..." while
    // in flight. Use the exact idle text.
    await page.getByRole('button', { name: /^Send Invite$/i }).click();

    // Success message — copy varies ("Invite sent!" / "Client added!" /
    // "Failed to send" if the API rejects). Accept any of the success
    // wordings; failure surfaces as the absence of any of these.
    await expect(page.getByText(/Invite sent|Client added/i).first()).toBeVisible({ timeout: 15_000 });

    await snapshot(page, v, 'invite_client_success');

    expect(apiFailures, `5xx on agent client endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Invite modal has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
