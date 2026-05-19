import { test, expect } from '@playwright/test';
import { detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

// The public landing page (/) is the agency-facing pitch. The "spine" is
// the set of locked positioning choices we don't want a drive-by edit to
// regress:
//
//   1. Headline: "Insurance relationships shouldn't disappear between
//      renewals." — agency-first, post-sale relational framing.
//   2. AI line: agent-amplifier, assistive — never authoritative.
//   3. AMS coexistence: "Sits on top of your AMS and CRM. Doesn't replace
//      them." — kills the #1 agent objection (replacement fear).
//   4. This Week mock above the fold — the relationship-intelligence story
//      made concrete with real-looking rows.
//   5. Two pillars (not three).
//   6. Coverage Review collaborative section — agent note + assistive
//      "Context from Covrabl" + engagement footer feeding This Week.
//   7. "Invited by your agent?" discoverable from the nav (not just the
//      hero), since invited clients land on /  from share links and need
//      a visible client-orientation path at any scroll position.
//
// 19-how-it-works.spec.ts already covers the hero link → /how-it-works
// click trace. This spec covers the nav-level entry that was added later,
// plus locks the Coverage Review mock as a visible artifact.
test.describe('Public landing — locked positioning spine', () => {
  test('hero shows headline, AI line, and AMS coexistence above the fold', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await page.goto('/');
    await settled(page);

    await expect(
      page.getByRole('heading', {
        name: /Insurance relationships shouldn.t disappear between renewals/i,
        level: 1,
      }),
    ).toBeVisible({ timeout: 15_000 });

    // AI framing must be agent-amplifier, never "AI-powered platform" buzz.
    await expect(
      page.getByText(/uses AI to help clients understand their coverage and agents spot/i),
    ).toBeVisible();

    // AMS coexistence subtitle — the agent's #1 objection-killer.
    await expect(
      page.getByText(/Sits on top of your AMS and CRM\.\s*Doesn.t replace them\./i),
    ).toBeVisible();

    await snapshot(page, v, 'landing-hero');

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `landing has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });

  test('This Week mock anchors the headline with 4 realistic rows', async ({ page }) => {
    await page.goto('/');
    await settled(page);

    await expect(page.getByText('4 clients to reach out to')).toBeVisible({ timeout: 15_000 });
    // exact: true distinguishes the This Week row (just the name) from the
    // Coverage Review mock below (which uses "Sarah Westlake · Auto · Allstate").
    for (const who of ['Sarah Westlake', 'Robert Thompson', 'Elena Rodriguez', 'Marcus Williams']) {
      await expect(page.getByText(who, { exact: true })).toBeVisible();
    }
  });

  test('two pillars, not three', async ({ page }) => {
    await page.goto('/');
    await settled(page);

    await expect(
      page.getByRole('heading', { name: /^Two things, done well\.?$/, level: 2 }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: /Identify the conversation worth having/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Have the conversation well/i }),
    ).toBeVisible();
    // Locking the count: a "Pillar 3" eyebrow must not exist.
    await expect(page.getByText(/Pillar 3/i)).toHaveCount(0);
  });

  test('Coverage Review section anchors the "shared workspace" claim', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    await page.goto('/');
    await settled(page);

    const section = page
      .locator('section')
      .filter({ hasText: /Coverage Reviews are a workspace, not a PDF\./ })
      .first();
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Client-named header
    await expect(section.getByText(/Sarah Westlake .* Auto .* Allstate/i)).toBeVisible();

    // Agent voice in the mock — the agent stays the authority.
    await expect(section.getByText(/Mike Johnson .* your agent/i)).toBeVisible();

    // Covrabl context must be labelled as context, not advice. This is
    // load-bearing — re-labelling it "Covrabl recommends" or similar would
    // flip the AI tone from assistive to authoritative.
    await expect(section.getByText('Context from Covrabl')).toBeVisible();
    await expect(section.getByText(/Worth confirming with Mike/i)).toBeVisible();

    // Engagement loop callout — the artifact that explains why "shared"
    // matters (view-tracking feeds the agent's This Week feed).
    await expect(section.getByText(/Appears in This Week/i)).toBeVisible();

    // Caption reinforces the assistive boundary explicitly.
    await expect(
      section.getByText(/Covrabl adds context, never advice .* the agent stays the authority/i),
    ).toBeVisible();

    await snapshot(page, v, 'landing-coverage-review');
  });
});

test.describe('Public landing — "Invited by your agent?" navigation', () => {
  // The hero version is already covered by 19-how-it-works.spec.ts
  // ("landing page wires clients into /how-it-works"). What this suite
  // adds is the nav-level entry, which is the only discoverable path
  // for an invited client who scrolled past the hero.

  test('desktop nav exposes "Invited by your agent?" and routes to /how-it-works', async ({ page }, testInfo) => {
    // The CSS hides .landing-nav-links at viewport ≤768px (tablet width inclusive).
    // Anything ≥769px shows the inline nav: desktop (1440) and mobile-landscape (812).
    test.skip(
      testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile-landscape',
      'inline nav only — tablet and narrower collapse to the hamburger',
    );

    await page.goto('/');
    await settled(page);

    const navLink = page
      .locator('nav.landing-nav-links')
      .getByText(/Invited by your agent\?/i)
      .first();
    await expect(navLink).toBeVisible({ timeout: 15_000 });

    await navLink.click();
    await page.waitForURL(/\/how-it-works(\/|$|\?)/, { timeout: 10_000 });
  });

  test('mobile hamburger menu exposes the same "Invited by your agent?" entry', async ({ page }, testInfo) => {
    // Hamburger shows at viewport ≤768px: tablet + every portrait mobile.
    // (mobile-landscape at 812px stays in the inline-nav test above.)
    test.skip(
      testInfo.project.name === 'desktop' || testInfo.project.name === 'mobile-landscape',
      'tablet + portrait mobiles only — wider viewports show inline nav',
    );

    await page.goto('/');
    await settled(page);

    const hamburger = page.getByRole('button', { name: /Toggle navigation menu/i });
    await expect(hamburger).toBeVisible({ timeout: 15_000 });
    await hamburger.click();

    const mobileLink = page
      .locator('.mobile-menu-dropdown')
      .getByRole('button', { name: /Invited by your agent\?/i });
    await expect(mobileLink).toBeVisible();
    await mobileLink.click();
    await page.waitForURL(/\/how-it-works(\/|$|\?)/, { timeout: 10_000 });
  });
});
