import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // Demo account is shared state — sequential is safer
  workers: 1,
  retries: 0,
  // Runs once before any tests; wipes + re-seeds the demo account so each
  // run starts from a known-clean state.
  globalSetup: require.resolve('./global-setup'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    // Prod-by-default. The demo account on covrabl.com is a throwaway sandbox
    // that gets reset by globalSetup before each run — no real user data is
    // ever touched. Set E2E_BASE_URL=http://localhost:3000 to point at a
    // local web instance (you'll also need a local API on :8000).
    baseURL: process.env.E2E_BASE_URL || 'https://covrabl.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
  ],
});
