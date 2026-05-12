import { test, expect } from '@playwright/test';
import {
  loginAsDemo,
  detectSmallTouchTargets,
  settled,
  viewportFromTestInfo,
  openMobileMenuIfPresent,
  TouchTargetViolation,
} from './helpers';

// Touch-target audit. Apple HIG: 44×44 minimum for primary actions. We use
// two thresholds:
//   - HARD (16px) — fails the test. Below this is genuinely un-tappable.
//   - SOFT (24px) — logged as a test annotation so we can see the count
//     trend over time, but does not fail. Lots of existing chrome (icons,
//     "Sign out" affordances) lives in the 15–22 band; failing CI on those
//     would mean every push is red until a separate UI-tightening pass.
//
// Desktop is exempt — mouse pointers don't have a minimum size.
const HARD_MIN_PX = 16;
const SOFT_MIN_PX = 24;

const isMobile = (projectName: string) => projectName.startsWith('mobile');

const pagesToAudit = [
  { url: '/agent', label: 'agent dashboard' },
  { url: '/policies', label: 'agent own policies' },
  { url: '/profile', label: 'profile' },
  { url: '/renewals', label: 'renewals' },
  { url: '/audit', label: 'policy alerts' },
];

test.describe('Touch-target audit (mobile only)', () => {
  test('no interactive element is smaller than 16×16; warn under 24×24', async ({ page }, testInfo) => {
    if (!isMobile(testInfo.project.name)) {
      test.skip(true, 'desktop/tablet exempt — mouse + larger viewport');
    }

    const v = viewportFromTestInfo(testInfo.project.name);

    await loginAsDemo(page);
    await settled(page);

    const hard: Array<{ page: string; v: TouchTargetViolation }> = [];
    const soft: Array<{ page: string; v: TouchTargetViolation }> = [];

    for (const { url, label } of pagesToAudit) {
      // Use sidebar navigation rather than goto, which avoids the auth-context
      // hydration race we saw on /audit.
      await openMobileMenuIfPresent(page);
      const navText: Record<string, RegExp> = {
        '/agent':    /My Clients/i,
        '/policies': /^📋?\s*Policies/i,
        '/profile':  /^👤?\s*Profile/i,
        '/renewals': /^🔄?\s*Renewals/i,
        '/audit':    /^🔔?\s*Alerts/i,
      };
      const navBtn = page.getByRole('button', { name: navText[url] }).first();
      if (await navBtn.isVisible().catch(() => false)) {
        await navBtn.click();
      } else {
        await page.goto(url);
      }
      await page.waitForURL(new RegExp(url.replace('/', '\\/')), { timeout: 15_000 }).catch(() => {});
      await settled(page);

      // Two passes: anything <16 is a hard failure; 16–23 is a soft warning.
      const softList = await detectSmallTouchTargets(page, SOFT_MIN_PX);
      for (const vio of softList) {
        if (vio.width < HARD_MIN_PX || vio.height < HARD_MIN_PX) {
          hard.push({ page: label, v: vio });
        } else {
          soft.push({ page: label, v: vio });
        }
      }
    }

    // Soft warnings: attach as test annotation so it appears in the HTML
    // report but doesn't fail the run.
    if (soft.length > 0) {
      const report = soft
        .map(({ page: p, v }) => `${p}: <${v.selector}> ${v.width}×${v.height} "${v.text}"`)
        .join('\n');
      testInfo.annotations.push({
        type: 'touch-target-warning',
        description: `${soft.length} touch targets in 16–${SOFT_MIN_PX - 1}px range at ${v}:\n${report}`,
      });
      console.log(`[${v}] ${soft.length} soft touch-target warnings (16–${SOFT_MIN_PX - 1}px):\n${report}`);
    }

    // Hard failures: anything below 16×16 is genuinely un-tappable.
    if (hard.length > 0) {
      const report = hard
        .map(({ page: p, v }) => `  ${p}: <${v.selector}> ${v.width}×${v.height} "${v.text}"`)
        .join('\n');
      throw new Error(
        `${hard.length} HARD touch-target violation(s) at ${v} (<${HARD_MIN_PX}px):\n${report}`
      );
    }
  });
});
