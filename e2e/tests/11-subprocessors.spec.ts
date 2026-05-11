import { test, expect } from '@playwright/test';
import { detectHorizontalOverflow, snapshot, settled, viewportFromTestInfo } from './helpers';

// Subprocessors is a public page (no auth required). Doubles as a smoke test
// for the marketing surface — if this 500s, an audit / due-diligence visitor
// sees a broken page on the corp-trust footer.
test.describe('Subprocessors page', () => {
  test('renders the subprocessor list without auth', async ({ page }, testInfo) => {
    const v = viewportFromTestInfo(testInfo.project.name);

    const apiFailures: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 500) {
        apiFailures.push(`${resp.status()} ${resp.url()}`);
      }
    });

    await page.goto('/subprocessors');
    await settled(page);

    await expect(page.getByRole('heading', { name: /subprocessor/i }).first()).toBeVisible({ timeout: 15_000 });

    // The page should list at least the core infra providers we publish
    // (Railway hosts our API, Cloudflare R2 stores documents).
    await expect(page.getByText(/Railway/i).first()).toBeVisible();
    await expect(page.getByText(/Cloudflare|R2/i).first()).toBeVisible();

    await snapshot(page, v, 'subprocessors');

    expect(apiFailures, `5xx loading subprocessors: ${apiFailures.join(', ')}`).toEqual([]);

    const overflow = await detectHorizontalOverflow(page);
    expect(overflow, `Subprocessors has ${overflow}px of horizontal overflow at ${v}`).toBeLessThanOrEqual(1);
  });
});
