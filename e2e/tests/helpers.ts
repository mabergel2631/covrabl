import { Page, expect } from '@playwright/test';

export const DEMO_EMAIL = 'demo@covrabl.com';
export const DEMO_PASSWORD = 'Covrabl';

/**
 * Log in via the /login form and assert we land on the agent dashboard.
 * The demo account is role=agent, so it should auto-redirect to /agent.
 */
export async function loginAsDemo(page: Page) {
  await loginAs(page, DEMO_EMAIL, DEMO_PASSWORD);
  // After login, agents land directly on /agent (their primary workspace).
  // Consumers go to /policies — see loginAs / test 05 for that case.
  await page.waitForURL(/\/agent(\/|$|\?)/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * On tablet/mobile viewports the sidebar collapses behind a hamburger labeled
 * "Open navigation menu". On desktop the sidebar is always visible. We click
 * the hamburger if it's there; on desktop the button doesn't exist and we
 * fall through silently.
 */
export async function openMobileMenuIfPresent(page: Page) {
  const burger = page.getByRole('button', { name: /Open navigation menu/i }).first();
  if (await burger.isVisible().catch(() => false)) {
    await burger.click();
    await page.waitForTimeout(300); // sidebar slide-in
  }
}

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /^(sign in|log in|login)/i }).click();
}

/**
 * Check the page for horizontal overflow — the single most common scaling bug.
 * Returns the overflow amount in pixels (positive = bug).
 */
export async function detectHorizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(html.scrollWidth, body.scrollWidth);
    const clientWidth = Math.max(html.clientWidth, body.clientWidth);
    return scrollWidth - clientWidth;
  });
}

/**
 * Capture a viewport-sized PNG to e2e/screenshots/{viewport}/{name}.png.
 */
export async function snapshot(page: Page, viewport: string, name: string) {
  const safe = name.replace(/[^a-z0-9_-]/gi, '_');
  await page.screenshot({
    path: `screenshots/${viewport}/${safe}.png`,
    fullPage: true,
  });
}

/**
 * Wait for any pending network and the React app to settle.
 */
export async function settled(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Pick the active project name (viewport) from the page's project metadata.
 * Used to scope screenshots to a per-viewport folder.
 */
export function viewportFromTestInfo(projectName: string): string {
  return projectName.toLowerCase();
}

export type TouchTargetViolation = {
  text: string;
  width: number;
  height: number;
  selector: string;
};

/**
 * Find visible interactive elements smaller than the given pixel threshold.
 * Touch targets below 24×24 are essentially un-tappable on a phone; Apple HIG
 * recommends 44×44 for primary actions. We default to 24 (definite bugs) and
 * let callers tighten where appropriate.
 *
 * Returns a list of violations rather than asserting — lets callers decide
 * what's acceptable per-page (a "× Close" affordance on a card can legitimately
 * be 18×18 if the whole card is the tap target).
 */
export async function detectSmallTouchTargets(
  page: Page,
  minPx = 24,
): Promise<TouchTargetViolation[]> {
  return await page.evaluate((min) => {
    const interactive = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]'
      )
    );
    const violations: TouchTargetViolation[] = [];
    for (const el of interactive) {
      const rect = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue; // off-screen
      if (rect.width < min || rect.height < min) {
        violations.push({
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''),
        });
      }
    }
    return violations;
  }, minPx);
}
