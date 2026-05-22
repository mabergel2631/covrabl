import { test, expect } from '@playwright/test';
import { loginAsDemo, DEMO_EMAIL, DEMO_PASSWORD, detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

// API base mirrors the resolveApiBase() in global-setup.ts. The web and
// API run on different origins; request.* calls must target the API.
function apiBase(): string {
  const explicit = process.env.E2E_API_BASE;
  if (explicit) return explicit.replace(/\/$/, '');
  const web = (process.env.E2E_BASE_URL || 'https://covrabl.com').replace(/\/$/, '');
  if (web.startsWith('http://localhost')) return 'http://localhost:8000';
  if (/covrabl\.com$/.test(new URL(web).host)) return 'https://covrabl-api.up.railway.app';
  return 'https://covrabl-api.up.railway.app';
}

// Auth helper for direct API calls. The cookie-based session set by the
// UI login flow isn't shared with the request fixture across origins —
// hit /auth/login directly to get a token, then attach it as a Bearer.
async function apiLogin(request: any): Promise<string> {
  const resp = await request.post(`${apiBase()}/auth/login`, {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (!resp.ok()) throw new Error(`API login failed: ${resp.status()}`);
  const body = await resp.json();
  if (!body.access_token) throw new Error('No access_token in login response');
  return body.access_token;
}

// Mirror of apps/web/src/app/renewal_constants.ts — the four stage hex colors.
// If these diverge between client constants and server STAGE_COLORS in
// apps/api/app/renewal_config.py, this test fails and forces a sync.
const STAGE_COLORS = {
  upcoming_review: '#a7c4a0',   // muted green
  client_discussion: '#e8b86d', // amber
  market_active: '#e08d52',     // orange
  finalization: '#d97366',      // soft red
} as const;

const STAGE_LABELS = {
  upcoming_review: 'Upcoming Review',
  client_discussion: 'Client Discussion',
  market_active: 'Market Active',
  finalization: 'Finalization',
} as const;

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// Phase 7 — "This Week" outreach feed. Sits above My Clients on the agent
// dashboard; surfaces upcoming renewals (now with 120-day visibility and
// per-stage workflow labels), recent uploads, share-link views, and
// stalled-extraction signals from real activity.
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

    await expect(
      page.getByText(/this week|outreach|to[- ]do|action items/i).first()
    ).toBeVisible({ timeout: 15_000 });

    await snapshot(page, v, 'this_week_feed');

    expect(apiFailures, `5xx on agent endpoints: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Agent dashboard has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });

  // Phase 1 of the renewal-workflow feature. Demo seed places policies at
  // each of the four stages so this spec can lock the structure across
  // every viewport — if a future edit silently drops the stage labels,
  // collapses the color gradient, or breaks scaling, these fail.
  test('renders all four renewal stages with locked labels and colors', async ({ page }) => {
    await loginAsDemo(page);
    await settled(page);

    const feed = page.getByTestId('this-week-feed');
    await expect(feed).toBeVisible({ timeout: 15_000 });

    // Demo seed guarantees one row per stage. Find each by data-stage attr
    // and verify (a) the locked label is present and (b) the left-edge
    // color band uses the exact hex from renewal_constants.
    for (const [stage, label] of Object.entries(STAGE_LABELS)) {
      const row = feed.locator(`[data-stage="${stage}"]`).first();
      await expect(row, `expected a ${stage} row in the feed`).toBeVisible({ timeout: 10_000 });
      await expect(row).toContainText(label);

      // Color band — read the actual computed style on the row's left border.
      const expectedRgb = hexToRgb(STAGE_COLORS[stage as keyof typeof STAGE_COLORS]);
      const borderColor = await row.evaluate(el => getComputedStyle(el).borderLeftColor);
      expect(borderColor, `${stage} row should have left band color ${expectedRgb}`).toBe(expectedRgb);
    }
  });

  test('clicking a renewal row navigates to the client detail page', async ({ page }) => {
    await loginAsDemo(page);
    await settled(page);

    const feed = page.getByTestId('this-week-feed');
    await expect(feed).toBeVisible({ timeout: 15_000 });

    const upcomingRow = feed.locator('[data-stage="upcoming_review"]').first();
    await expect(upcomingRow).toBeVisible({ timeout: 10_000 });

    await upcomingRow.click();
    await page.waitForURL(/\/agent\/\d+/, { timeout: 10_000 });
  });

  test('renewal-thresholds endpoint returns defaults + seeded override', async ({ request }) => {
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };

    const resp = await request.get(`${apiBase()}/agency/renewal-thresholds`, { headers });
    expect(resp.ok(), `GET /agency/renewal-thresholds returned ${resp.status()}`).toBeTruthy();
    const list = await resp.json();
    expect(Array.isArray(list)).toBeTruthy();

    // Demo seed plants an override for "auto" at 75/55/35/17. Everything
    // else should be default (is_override=false).
    const auto = list.find((x: any) => x.policy_type === 'auto');
    expect(auto, 'auto threshold row should exist').toBeTruthy();
    expect(auto.is_override).toBe(true);
    expect(auto.upcoming_days).toBe(75);
    expect(auto.discussion_days).toBe(55);
    expect(auto.market_days).toBe(35);
    expect(auto.finalization_days).toBe(17);

    const cgl = list.find((x: any) => x.policy_type === 'general_liability');
    expect(cgl, 'general_liability threshold row should exist').toBeTruthy();
    expect(cgl.is_override).toBe(false);
    expect(cgl.upcoming_days).toBe(120);
  });

  test('renewal-thresholds PUT round-trips (owner only)', async ({ request }) => {
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };

    const put = await request.put(`${apiBase()}/agency/renewal-thresholds/cyber`, {
      headers,
      data: { upcoming_days: 100, discussion_days: 80, market_days: 50, finalization_days: 25 },
    });
    expect(put.ok(), `PUT returned ${put.status()}`).toBeTruthy();
    const saved = await put.json();
    expect(saved.is_override).toBe(true);
    expect(saved.upcoming_days).toBe(100);

    const get = await request.get(`${apiBase()}/agency/renewal-thresholds`, { headers });
    const cyber = (await get.json()).find((x: any) => x.policy_type === 'cyber');
    expect(cyber.is_override).toBe(true);
    expect(cyber.market_days).toBe(50);

    // Cleanup so re-runs start clean (globalSetup wipes the agency on
    // demo reset, but explicit cleanup keeps the test self-contained).
    const del = await request.delete(`${apiBase()}/agency/renewal-thresholds/cyber`, { headers });
    expect(del.ok()).toBeTruthy();
  });

  test('PUT rejects non-monotonic thresholds with 400', async ({ request }) => {
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };

    // finalization (40) > market (30) is invalid — must 400.
    const resp = await request.put(`${apiBase()}/agency/renewal-thresholds/cyber`, {
      headers,
      data: { upcoming_days: 90, discussion_days: 60, market_days: 30, finalization_days: 40 },
    });
    expect(resp.status()).toBe(400);
  });

  test('feed rows scale cleanly at narrow viewports (no overflow, no wrap break)', async ({ page }, testInfo) => {
    // Mobile-class viewports are where the wider 120-day feed is most
    // likely to overflow — there are now more rows and each row carries
    // a stage label, severity dot, client name, and suggested-action
    // chevron. Lock both no-overflow AND the row's effective right edge
    // staying within the viewport.
    test.skip(
      !['mobile', 'mobile-small'].includes(testInfo.project.name),
      'narrow-viewport-only scaling check',
    );

    await loginAsDemo(page);
    await settled(page);

    const feed = page.getByTestId('this-week-feed');
    await expect(feed).toBeVisible({ timeout: 15_000 });

    // Every row's bounding rect must fit inside the viewport horizontally.
    const overflowsPerRow = await feed.locator('[data-testid="this-week-row"]').evaluateAll(rows => {
      const vw = window.innerWidth;
      return rows.map(el => {
        const r = el.getBoundingClientRect();
        return Math.max(0, r.right - vw);
      });
    });
    const maxOverflow = Math.max(0, ...overflowsPerRow);
    expect(maxOverflow, `widest row overflows viewport by ${maxOverflow}px`).toBeLessThanOrEqual(1);

    // And the page-level overflow check still has to pass.
    const overflow = await detectHorizontalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
