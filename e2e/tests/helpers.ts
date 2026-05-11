import { Page, expect } from '@playwright/test';

export const DEMO_EMAIL = 'demo@covrabl.com';
export const DEMO_PASSWORD = 'Covrabl';

/**
 * Log in via the /login form and assert we land on the agent dashboard.
 * The demo account is role=agent, so it should auto-redirect to /agent.
 */
export async function loginAsDemo(page: Page) {
  await loginAs(page, DEMO_EMAIL, DEMO_PASSWORD);
  // Login redirects to /policies for everyone; agents reach /agent via the
  // sidebar "My Clients" link. Wait for /policies to settle so the auth state
  // is committed, then click into the agent dashboard like a real user would.
  await page.waitForURL(/\/policies/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await openMobileMenuIfPresent(page);
  await page.getByRole('button', { name: /My Clients/i }).first().click();
  await page.waitForURL(/\/agent(\/|$|\?)/, { timeout: 15_000 });
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
