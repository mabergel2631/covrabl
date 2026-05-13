import { test, expect } from '@playwright/test';
import { detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

// /how-it-works is the client-facing orientation page. It serves two
// audiences and must render correctly for both:
//
//   1. Anonymous prospect (no invite token) — gets the "How Covrabl works
//      for you and your agent" framing and a CTA to the public demo.
//   2. Invited client (?invite=<token>) — gets the "Your agent invited
//      you" framing and a CTA that preserves the invite into login.
//
// This spec also covers the wiring from the agent landing page (/)
// into /how-it-works: a hero link and a footer "For clients" link, so
// the new page is actually discoverable.
test.describe('/how-it-works orientation page', () => {
  test('anonymous prospect view renders with no 5xx', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await page.goto('/how-it-works');
    await settled(page);

    // Anonymous hero — agent-and-client framing, not invited-client copy.
    await expect(
      page.getByRole('heading', {
        name: /how Covrabl works for you and your agent/i,
        level: 1,
      })
    ).toBeVisible({ timeout: 15_000 });

    // The "Welcome" eyebrow only appears for invited clients; this must NOT.
    await expect(page.getByText(/Welcome/, { exact: true })).toHaveCount(0);

    // ProductDemo: the 6-scene browser mockup just below the hero. The
    // section is identified by aria-label="Product demo"; we also assert
    // the demo's chrome ("app.covrabl.com" address bar) is present.
    await expect(page.locator('section[aria-label="Product demo"]')).toBeVisible();
    await expect(page.getByText('app.covrabl.com', { exact: true })).toBeVisible();

    // Step section anchor is present.
    await expect(
      page.getByRole('heading', { name: /what you'?ll do here/i })
    ).toBeVisible();

    // "More you can do here" tile section with Compare + Requirement Check.
    await expect(
      page.getByRole('heading', { name: /more you can do here/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /compare policies side-by-side/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /check a lease or requirement/i })
    ).toBeVisible();

    // The four step labels are stable signposts.
    for (const label of ['Step 1', 'Step 2', 'Step 3', 'Step 4']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // FAQ — the three agent-relationship questions are the load-bearing
    // additions that distinguish this page from the old consumer FAQ.
    await expect(page.getByText(/why did my agent invite me here\?/i)).toBeVisible();
    await expect(page.getByText(/what does my agent see\?/i)).toBeVisible();
    await expect(page.getByText(/is this required\? can i leave\?/i)).toBeVisible();

    // Trust section is anchored under id="trust".
    await expect(
      page.getByRole('heading', { name: /built for privacy/i })
    ).toBeVisible();

    await snapshot(page, v, 'how-it-works-anonymous');

    expect(
      apiFailures,
      `5xx loading /how-it-works: ${apiFailures.join(', ')}`
    ).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(
      overflow,
      `/how-it-works has ${overflow}px of horizontal overflow at ${v}`
    ).toBeLessThanOrEqual(1);
  });

  test('invited-client view swaps the hero copy and CTA', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await page.goto('/how-it-works?invite=demo-invite-token');
    await settled(page);

    // Hero copy must reflect the invited-client framing.
    // The headline uses a curly apostrophe (Here’s) — match around it
    // rather than trying to express both code points in the regex.
    await expect(
      page.getByRole('heading', {
        name: /your agent invited you\.\s+here.{1,2}s what happens next/i,
        level: 1,
      })
    ).toBeVisible({ timeout: 15_000 });

    // Primary CTA label swaps from "See the public demo" to "Continue to your account".
    await expect(
      page.getByRole('button', { name: /^continue to your account/i }).first()
    ).toBeVisible();

    // The nav sign-in button also swaps to "Continue" (preserves invite param).
    // Tablet/mobile viewports collapse the desktop nav into a hamburger —
    // only assert on desktop where the nav is unconditionally visible.
    if (testInfo.project.name === 'desktop') {
      await expect(
        page.getByRole('button', { name: /^continue$/i }).first()
      ).toBeVisible();
    }

    await snapshot(page, v, 'how-it-works-invited');

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `/how-it-works (invited) overflow ${overflow}px at ${v}`).toBeLessThanOrEqual(1);
  });

  test('landing page wires clients into /how-it-works', async ({ page }, testInfo) => {
    // Mobile viewports hide the desktop hero link inside a tighter layout;
    // the hero CTA stack still shows it, but the footer link is what we
    // verify on small screens. Keep the spec focused on outcomes (clicking
    // the discoverable entry point lands you on /how-it-works) rather than
    // exact layout assertions per viewport.
    await page.goto('/');
    await settled(page);

    // The "Invited by your agent? See how it works →" link in the hero.
    const heroLink = page.getByText(/invited by your agent\?/i).first();
    await expect(heroLink).toBeVisible({ timeout: 15_000 });

    await heroLink.click();
    await page.waitForURL(/\/how-it-works(\/|$|\?)/, { timeout: 10_000 });

    // And navigating back, the footer "For clients" link should also land here.
    await page.goto('/');
    await settled(page);

    const footerLink = page.getByText(/^for clients$/i).first();
    await expect(footerLink).toBeVisible();
    await footerLink.click();
    await page.waitForURL(/\/how-it-works(\/|$|\?)/, { timeout: 10_000 });

    await expect(
      page.getByRole('heading', { name: /how Covrabl works for you and your agent/i, level: 1 })
    ).toBeVisible({ timeout: 15_000 });
  });
});
