import { test, expect } from '@playwright/test';
import { detectHorizontalOverflow, settled, viewportFromTestInfo } from './helpers';

// Trust-artifact pages live or die on diligence: a brokerage of any size
// will read them looking for specific claims (MFA, subprocessor list,
// SOC 2 posture, vulnerability disclosure). The shipped versions reflect
// real, current capabilities; this spec keeps them that way.
//
// All three pages are public — no E2E reset needed. Run with
// E2E_SKIP_RESET=1 to skip the heavy demo reseed.

test.describe('/security — load-bearing claims', () => {
  test('all seven section titles render', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);
    await page.goto('/security');
    await settled(page);

    const titles = [
      'Encryption in transit and at rest',
      'Multi-factor authentication (MFA)',
      'Your data stays yours',
      'Audit logging',
      'How an agency sees your data',
      'How an agency sees its own clients',
      'Infrastructure and vendors',
    ];
    for (const title of titles) {
      await expect(
        page.getByRole('heading', { name: title, level: 2 }),
      ).toBeVisible({ timeout: 10_000 });
    }

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `/security has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });

  test('MFA section names TOTP and authenticator apps', async ({ page }) => {
    await page.goto('/security');
    await settled(page);

    // The MFA card is the load-bearing capability claim — losing TOTP or
    // recovery-code wording would silently downgrade the security story.
    const mfaCard = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: /Multi-factor authentication/i }) })
      .first();
    await expect(mfaCard).toBeVisible();
    await expect(mfaCard).toContainText(/TOTP/);
    await expect(mfaCard).toContainText(/authenticator app/i);
    await expect(mfaCard).toContainText(/Recovery codes/i);
  });

  test('agency-aware sections cover client + producer access paths', async ({ page }) => {
    await page.goto('/security');
    await settled(page);

    // Client view: their data is theirs, agency sees only what they share, revoke is immediate.
    await expect(page.getByText(/You can revoke an agency.s access/i)).toBeVisible();
    // Producer view: scoped access, cross-agency logging.
    await expect(page.getByText(/cross-agency access is logged/i)).toBeVisible();
  });

  test('compliance posture is honest about SOC 2 status', async ({ page }) => {
    await page.goto('/security');
    await settled(page);

    // The exact framing matters — "not yet SOC 2 audited" reads honest;
    // anything implying audit-in-progress would overstate. Lock the phrasing.
    await expect(page.getByText(/not yet SOC 2 audited/i)).toBeVisible();
    await expect(page.getByText(/working toward Type I/i)).toBeVisible();
  });

  test('security contact + vulnerability disclosure visible with mailto', async ({ page }) => {
    await page.goto('/security');
    await settled(page);

    await expect(page.getByText(/Found something\? Tell us\./)).toBeVisible();
    await expect(page.getByText(/acknowledge reports within two business days/i)).toBeVisible();
    // Safe-harbor language — basic researcher trust signal
    await expect(page.getByText(/do not pursue legal action against researchers/i)).toBeVisible();

    const mailto = page.locator('a[href="mailto:security@covrabl.com"]').first();
    await expect(mailto).toBeVisible();
    await expect(mailto).toHaveAttribute('href', 'mailto:security@covrabl.com');
  });

  test('link from /security to /subprocessors navigates correctly', async ({ page }) => {
    await page.goto('/security');
    await settled(page);

    const link = page.getByRole('link', { name: /View the full subprocessor list/i });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/subprocessors$/, { timeout: 10_000 });
  });
});

test.describe('/subprocessors — vendor list correctness', () => {
  // The list is auditor-readable; any divergence between this list and
  // what the API actually calls is a hard diligence problem. These tests
  // lock the eight current vendors and the Anthropic-before-OpenAI order
  // (Anthropic is the primary AI provider).
  const EXPECTED_VENDORS = [
    'Cloudflare',
    'Railway',
    'Vercel',
    'Anthropic',
    'OpenAI',
    'Stripe',
    'Resend',
    'GitHub',
  ];

  test('all eight expected vendors render with name + outbound privacy link', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);
    await page.goto('/subprocessors');
    await settled(page);

    for (const vendor of EXPECTED_VENDORS) {
      // Vendor name appears as a section title. Use exact: true to avoid
      // matching the same string inside descriptive copy elsewhere.
      const heading = page.getByText(vendor, { exact: true }).first();
      await expect(heading, `vendor "${vendor}" should be listed`).toBeVisible();
    }

    // Every vendor has an outbound "Privacy policy →" link.
    const policyLinks = page.getByRole('link', { name: /Privacy policy/i });
    const count = await policyLinks.count();
    expect(count, 'each vendor row should expose an outbound privacy-policy link').toBeGreaterThanOrEqual(
      EXPECTED_VENDORS.length,
    );

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `/subprocessors has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });

  test('Anthropic is listed as primary AI and appears before OpenAI', async ({ page }) => {
    await page.goto('/subprocessors');
    await settled(page);

    // The category text on the Anthropic row must call it primary.
    await expect(page.getByText(/AI document extraction \(primary\)/i)).toBeVisible();

    // Anthropic must appear above OpenAI in document order — otherwise
    // the page implies OpenAI is the main AI provider, which would
    // contradict the code (LLM_PROVIDER=anthropic by default).
    const anthropicY = await page.getByText('Anthropic', { exact: true }).first().evaluate(
      el => el.getBoundingClientRect().top + window.scrollY,
    );
    const openaiY = await page.getByText('OpenAI', { exact: true }).first().evaluate(
      el => el.getBoundingClientRect().top + window.scrollY,
    );
    expect(
      anthropicY,
      `Anthropic (y=${anthropicY}) must appear above OpenAI (y=${openaiY})`,
    ).toBeLessThan(openaiY);
  });

  test('Stripe is listed for payment processing', async ({ page }) => {
    await page.goto('/subprocessors');
    await settled(page);

    // The privacy page references Stripe by name; the subprocessor page
    // used to be silent on it, which was a diligence inconsistency.
    await expect(page.getByText('Stripe', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Payment processing/i)).toBeVisible();
  });

  test('"What we don\'t do" anti-claims are present', async ({ page }) => {
    await page.goto('/subprocessors');
    await settled(page);

    await expect(page.getByText(/We do not sell, rent, or trade customer data/i)).toBeVisible();
    await expect(page.getByText(/do not use customer data to train AI models/i)).toBeVisible();
  });
});

test.describe('/privacy — effective date and B2B-aware claims', () => {
  test('effective date is set and not visibly stale', async ({ page }) => {
    await page.goto('/privacy');
    await settled(page);

    // Don't pin the literal date — that would fail every time we refresh.
    // Just assert (a) a date is shown and (b) it's not the original
    // Feb 12 2026 placeholder that the old page kept stale for months.
    const dateLine = page.getByText(/Effective date:/);
    await expect(dateLine).toBeVisible();
    await expect(dateLine).not.toContainText('February 12, 2026');
  });

  test('audit-logging claim names specific events (no overstated blanket claim)', async ({ page }) => {
    await page.goto('/privacy');
    await settled(page);

    // The old copy said "All significant actions are logged so you can
    // review access and changes to your data" — overstated relative to
    // current coverage. The new copy must enumerate which events.
    await expect(page.getByText(/sign-ins, document downloads/i)).toBeVisible();
    await expect(page.getByText(/Coverage is expanding/i)).toBeVisible();
  });

  test('link from /privacy to /subprocessors navigates correctly', async ({ page }) => {
    await page.goto('/privacy');
    await settled(page);

    // /privacy mentions the subprocessor list in two places; clicking
    // either should land on /subprocessors. Target the explicit
    // "complete list" link in the Third-party services section.
    const link = page.getByRole('link', { name: '/subprocessors' });
    await expect(link.first()).toBeVisible();
    await link.first().click();
    await page.waitForURL(/\/subprocessors$/, { timeout: 10_000 });
  });

  test('no horizontal overflow at any width', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);
    await page.goto('/privacy');
    await settled(page);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `/privacy has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
